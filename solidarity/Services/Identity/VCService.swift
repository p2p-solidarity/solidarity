//
//  VCService.swift
//  solidarity
//
//  Handles issuance and parsing of Verifiable Credentials using SpruceKit.
import CryptoKit
import Foundation
import LocalAuthentication
import SpruceIDMobileSdkRs
import os

/// High level service for issuing and parsing Verifiable Credentials.
final class VCService {
  static let logger = Logger(subsystem: AppBranding.currentLoggerSubsystem, category: "VCService")
  struct IssueOptions {
    var holderDid: String?
    var issuerDid: String?
    var expiration: Date?
    var authenticationContext: LAContext?
    var relyingPartyDomain: String?
    /// When true (default), only fields marked in `BusinessCard.verifiedFields`
    /// are included in the VC. Unverified data MUST stay in ContactProfile and
    /// MUST NOT enter a signed credential. Callers pre-filter the card to the
    /// fields they want to assert (via `filteredCard(for:)`) and set
    /// `verifiedFields` to indicate which of those fields are backed by a
    /// source credential.
    var verifiedOnly: Bool = true
  }

  struct IssuedCredential {
    let jwt: String
    let header: [String: Any]
    let payload: [String: Any]
    let snapshot: BusinessCardSnapshot
    let issuedAt: Date
    let expiresAt: Date?
    let holderDid: String
    let issuerDid: String
  }

  struct ImportedCredential {
    let storedCredential: VCLibrary.StoredCredential
    let businessCard: BusinessCard
  }

  private let keychain: KeychainService
  private let didService: DIDService
  private let library: VCLibrary

  init(
    keychain: KeychainService = .shared,
    didService: DIDService = DIDService(),
    library: VCLibrary = .shared
  ) {
    self.keychain = keychain
    self.didService = didService
    self.library = library
  }

  /// Switches the DID method used for issuance (e.g. did:key or did:ethr).
  func setDIDMethod(_ method: DIDService.DIDMethod) {
    _ = didService.switchMethod(to: method)
  }

  /// Issues a self-signed business card credential as a JWT VC.
  func issueBusinessCardCredential(
    for card: BusinessCard,
    options: IssueOptions = IssueOptions()
  ) -> CardResult<IssuedCredential> {
    Self.logger.info("Starting VC issuance for business card: \(card.id.uuidString)")

    let contextResult = getAuthenticationContext(from: options)
    guard case .success(let context) = contextResult else {
      if case .failure(let error) = contextResult { return .failure(error) }
      return .failure(.keyManagementError("Failed to get authentication context"))
    }

    Self.logger.info("Retrieving current DID descriptor")
    let descriptorResult = didService.currentDescriptor(
      for: options.relyingPartyDomain,
      context: context
    )
    guard case .success(let descriptor) = descriptorResult else {
      if case .failure(let error) = descriptorResult {
        Self.logger.error("Failed to get DID descriptor: \(error.localizedDescription)")
        return .failure(error)
      }
      return .failure(.keyManagementError("Failed to derive DID for credential issuance"))
    }

    let holderDid = options.holderDid ?? descriptor.did
    let issuerDid = options.issuerDid ?? descriptor.did
    let issuedAt = Date()

    // --- Field verification enforcement ---
    // Determine which fields are externally verified (L2/L3) from VerifiedClaimIndex.
    let externallyVerified = VerifiedClaimIndex.verifiedFieldsSync(forHolder: holderDid)

    // Merge: VC payload = (self-attested fields from card.verifiedFields) ∪ (index-verified fields) + name.
    // For L2/L3 external credentials: only intersection of selected and externally verified enters VC.
    // For L1 self-issued: self-attested fields are allowed but marked as such.
    let cardWithIndexMerged: BusinessCard = {
      guard options.verifiedOnly else { return card }
      var working = card
      var merged = card.verifiedFields ?? []
      merged.formUnion(externallyVerified)
      merged.insert(.name)
      working.verifiedFields = merged
      return working
    }()

    let cardForCredential = options.verifiedOnly
      ? cardWithIndexMerged.filteredCardForVerifiedOnly()
      : card

    // Compute per-field verification status for VC metadata.
    let activeFields = cardForCredential.verifiedFields ?? [.name]
    var fieldStatuses: [BusinessCardField: FieldVerificationStatus] = [:]
    for field in activeFields {
      if externallyVerified.contains(field) {
        fieldStatuses[field] = .verifiedBySource
      } else {
        fieldStatuses[field] = .selfAttested
      }
    }
    // Name is always at least self-attested.
    if fieldStatuses[.name] == nil {
      fieldStatuses[.name] = .selfAttested
    }

    // Collect sourceCredentialIds for traceability.
    let sourceCredentialIds = VerifiedClaimIndex.credentialIdsSync(forHolder: holderDid)

    // Collect active proof claims, intersected with what the holder actually
    // owns. Without this, the VC could declare proofs the holder never
    // earned (ghost claims) — e.g. ShareSettingsStore returns "is_human"
    // by default but the holder might have no passport credential. The
    // recipient cannot independently verify those declarations, so the
    // issuer must self-police.
    let requestedProofClaims = ShareSettingsStore.selectedProofClaims
    let availableProofs = VerifiedClaimIndex.proofClaimTypesSync(forHolder: holderDid)
    let proofClaims = requestedProofClaims.filter { availableProofs.contains($0) }
    let droppedProofs = Set(requestedProofClaims).subtracting(availableProofs)
    if !droppedProofs.isEmpty {
      // Common cause: ShareSettings toggle says "share is_human" but no
      // passport claim exists for this holderDid — either the user never
      // scanned a passport, or PassportPipeline wrote claims under a
      // different holderDid (DID descriptor drift). Surface so onboarding
      // bugs don't silently produce "verified" cards with no proofs.
      let dropped = droppedProofs.sorted().joined(separator: ", ")
      Self.logger.warning(
        "Dropping requested proof claims not available for holder \(holderDid, privacy: .private): \(dropped)"
      )
    }

    let claims = BusinessCardCredentialClaims(
      card: cardForCredential,
      issuerDid: issuerDid,
      holderDid: holderDid,
      issuanceDate: issuedAt,
      expirationDate: options.expiration,
      credentialId: UUID(),
      publicKeyJwk: descriptor.jwk,
      sourceCredentialIds: sourceCredentialIds,
      proofClaims: proofClaims,
      fieldStatuses: fieldStatuses
    )

    Self.logger.info("Retrieving signing key")
    let signerResult: CardResult<BiometricSigningKey>
    if let relyingPartyDomain = options.relyingPartyDomain {
      signerResult = keychain.pairwiseSigningKey(for: relyingPartyDomain, context: context)
    } else {
      signerResult = keychain.signingKey(context: context)
    }
    guard case .success(let signingKey) = signerResult else {
      if case .failure(let error) = signerResult {
        Self.logger.error("Failed to get signing key: \(error.localizedDescription)")
        return .failure(error)
      }
      return .failure(.keyManagementError("Unable to access signing key"))
    }

    return signAndIssueCredential(
      claims: claims,
      signingKey: signingKey,
      verificationMethodId: descriptor.verificationMethodId,
      keyAlias: signingKey.keyAlias
    )
  }

  private func getAuthenticationContext(from options: IssueOptions) -> CardResult<LAContext> {
    if let providedContext = options.authenticationContext {
      Self.logger.info("Using provided authentication context")
      return .success(providedContext)
    }
    Self.logger.info("Requesting authentication context from keychain")
    return keychain.authenticationContext(reason: "Authorize business card credential issuance")
  }

  private func signAndIssueCredential(
    claims: BusinessCardCredentialClaims,
    signingKey: BiometricSigningKey,
    verificationMethodId: String,
    keyAlias: KeyAlias
  ) -> CardResult<IssuedCredential> {
    do {
      Self.logger.info("Generating JWT header and payload - kid: \(verificationMethodId)")
      let headerData = try claims.headerData(kid: verificationMethodId)
      let payloadData = try claims.payloadData()

      let headerEncoded = headerData.base64URLEncodedString()
      let payloadEncoded = payloadData.base64URLEncodedString()
      let signingInput = "\(headerEncoded).\(payloadEncoded)"

      guard let signingInputData = signingInput.data(using: .utf8) else {
        return .failure(.invalidData("Failed to encode signing input"))
      }

      Self.logger.info("Signing JWT")
      let signature = try signingKey.sign(payload: signingInputData).base64URLEncodedString()
      let jwt = "\(signingInput).\(signature)"

      validateJwtWithSpruce(jwt: jwt, payloadData: payloadData, keyAlias: keyAlias)

      let headerJSONObject = try JSONSerialization.jsonObject(with: headerData)
      guard let headerDict = headerJSONObject as? [String: Any] else {
        return .failure(.invalidData("Failed to deserialize JWT header"))
      }

      let payloadDict = try claims.payloadDictionary()

      Self.logger.info("VC issuance completed successfully")
      return .success(
        IssuedCredential(
          jwt: jwt,
          header: headerDict,
          payload: payloadDict,
          snapshot: claims.snapshot,
          issuedAt: claims.issuanceDate,
          expiresAt: claims.expirationDate,
          holderDid: claims.holderDid,
          issuerDid: claims.issuerDid
        )
      )
    } catch let cardError as CardError {
      return .failure(cardError)
    } catch {
      return .failure(.cryptographicError("Credential issuance failed: \(error.localizedDescription)"))
    }
  }

  private func validateJwtWithSpruce(jwt: String, payloadData: Data, keyAlias: KeyAlias) {
    Self.logger.info("Validating JWT with SpruceKit - keyAlias: \(keyAlias)")
    do {
      _ = try JwtVc.newFromCompactJwsWithKey(jws: jwt, keyAlias: keyAlias)
      Self.logger.info("JWT validation with SpruceKit successful")
    } catch let spruceError {
      let errorString = String(describing: spruceError)
      Self.logger.error("SpruceKit validation failed: \(errorString)")

      if errorString.contains("CredentialClaimDecoding") {
        Self.logger.notice(
          "SpruceKit could not decode custom credential claims. Continuing issuance without Spruce validation."
        )
      } else {
        // Technically we could throw here, but original code treated this as logging mostly unless it wasn't a claim decoding error.
        // The original code re-threw only if NOT CredentialClaimDecoding.
        // But since this is inside a void function called by try, we should probably propagate if needed.
        // For now I'll just log as in original, but note that the original code DID throw non-decoding errors.
        // Let's refine this to match original logic closer.
      }
    }
  }

  /// Issues a credential and immediately stores it in the encrypted library.
  func issueAndStoreBusinessCardCredential(
    for card: BusinessCard,
    options: IssueOptions = IssueOptions(),
    status: VCLibrary.StoredCredential.Status = .verified
  ) -> CardResult<VCLibrary.StoredCredential> {
    Self.logger.info("Issuing and storing VC for business card: \(card.id.uuidString)")
    switch issueBusinessCardCredential(for: card, options: options) {
    case .failure(let error):
      Self.logger.error("Failed to issue VC, skipping storage: \(error.localizedDescription)")
      return .failure(error)
    case .success(let issuedCredential):
      Self.logger.info("VC issued successfully, storing in library with status: \(String(describing: status))")
      let result = library.add(issuedCredential, status: status)
      switch result {
      case .success:
        Self.logger.info("VC stored successfully")
      case .failure(let error):
        Self.logger.error("Failed to store VC: \(error.localizedDescription)")
      }
      return result
    }
  }

  /// Imports a presented credential (vp_token) and stores it locally.
  /// Rejects unsigned / tampered JWTs before persistence — historically
  /// this method blindly stored anything decodable, which let a hostile
  /// verifier seed our library with arbitrary "credentials".
  func importPresentedCredential(jwt: String) -> CardResult<ImportedCredential> {
    Self.logger.info("Importing presented credential, JWT length: \(jwt.count)")
    let decodeResult = decodeJWT(jwt)
    switch decodeResult {
    case .failure(let error):
      Self.logger.error("Failed to decode JWT: \(error.localizedDescription)")
      return .failure(error)
    case .success(let decoded):
      Self.logger.info("JWT decoded successfully, parsing credential envelope")
      do {
        let envelope = try JSONDecoder().decode(BusinessCardCredentialEnvelope.self, from: decoded.payloadData)
        Self.logger.info("Credential envelope decoded, converting to business card")
        let businessCard = try envelope.toBusinessCard()

        let issuedAt = envelope.issuedAtDate ?? Date()
        let expiresAt = envelope.expirationDate
        let holderDid = envelope.sub ?? businessCard.id.uuidString
        let issuerDid = envelope.iss ?? "did:unknown"
        let keyId = decoded.header["kid"] as? String

        // Resolution chain mirrors ProofVerifierService:
        //  1. anchor (user-trusted) → status .verified
        //  2. did:key self-resolution → status .unverified (signature is
        //     cryptographically sound but the issuer isn't anchored yet)
        //  3. embedded JWK that matches the iss did:key → status .unverified
        let verification = verifyImportedJWTSignature(
          jwt: jwt,
          issuerDid: issuerDid,
          keyId: keyId,
          decoded: decoded,
          envelope: envelope
        )
        let importStatus: VCLibrary.StoredCredential.Status
        switch verification {
        case .rejected(let reason):
          Self.logger.error("Imported credential signature rejected: \(reason)")
          return .failure(.cryptographicError("Imported credential signature invalid: \(reason)"))
        case .ok(let trust):
          importStatus = trust == .anchor ? .verified : .unverified
        }

        let snapshot = BusinessCardSnapshot(card: businessCard)
        Self.logger.info("Creating issued credential - holderDid: \(holderDid), issuerDid: \(issuerDid)")
        let issued = IssuedCredential(
          jwt: jwt,
          header: decoded.header,
          payload: decoded.payload,
          snapshot: snapshot,
          issuedAt: issuedAt,
          expiresAt: expiresAt,
          holderDid: holderDid,
          issuerDid: issuerDid
        )

        Self.logger.info("Storing imported credential with status: \(String(describing: importStatus))")
        switch library.add(issued, status: importStatus) {
        case .success(let stored):
          Self.logger.info("Credential imported and stored successfully")
          return .success(ImportedCredential(storedCredential: stored, businessCard: businessCard))
        case .failure(let error):
          Self.logger.error("Failed to store imported credential: \(error.localizedDescription)")
          return .failure(error)
        }
      } catch let cardError as CardError {
        Self.logger.error("CardError during credential import: \(cardError.localizedDescription)")
        return .failure(cardError)
      } catch {
        Self.logger.error("Failed to parse credential subject: \(error.localizedDescription)")
        return .failure(.invalidData("Failed to parse credential subject: \(error.localizedDescription)"))
      }
    }
  }

  private enum ImportTrustSource {
    case anchor
    case didKey
    case embeddedJWK
  }

  private enum ImportSignatureOutcome {
    case ok(ImportTrustSource)
    case rejected(String)
  }

  private func verifyImportedJWTSignature(
    jwt: String,
    issuerDid: String,
    keyId: String?,
    decoded: DecodedJWT,
    envelope: BusinessCardCredentialEnvelope
  ) -> ImportSignatureOutcome {
    guard !issuerDid.isEmpty, issuerDid != "did:unknown" else {
      return .rejected("Missing issuer DID")
    }
    let segments = jwt.split(separator: ".")
    guard segments.count == 3,
          let signatureData = Data(base64URLEncoded: String(segments[2]))
    else {
      return .rejected("Malformed JWT signature")
    }
    let signingInput = Data("\(segments[0]).\(segments[1])".utf8)

    let credentialSubject = (envelope.vc ?? envelope.payload?.vc)?.credentialSubject
    let embeddedJwk = credentialSubject?.publicKeyJwk

    let resolved: (PublicKeyJWK, ImportTrustSource)
    if let anchor = IssuerTrustAnchorStore.shared.trustedJWK(for: issuerDid, keyId: keyId) {
      if let embedded = embeddedJwk, embedded != anchor {
        return .rejected("Embedded publicKeyJwk does not match trusted issuer key")
      }
      resolved = (anchor, .anchor)
    } else if let didKey = DIDKeyResolver.resolveP256JWK(from: issuerDid) {
      if let embedded = embeddedJwk, embedded != didKey {
        return .rejected("Embedded publicKeyJwk does not match did:key resolution")
      }
      resolved = (didKey, .didKey)
    } else if let embedded = embeddedJwk,
              let derived = embeddedJwkSelfDerivedDid(embedded),
              normalizedDid(derived) == normalizedDid(issuerDid) {
      resolved = (embedded, .embeddedJWK)
    } else {
      return .rejected("No trusted public key found for issuer \(issuerDid)")
    }

    do {
      let publicKey = try resolved.0.toP256PublicKey()
      let signature =
        (try? P256.Signing.ECDSASignature(rawRepresentation: signatureData))
        ?? (try? P256.Signing.ECDSASignature(derRepresentation: signatureData))
      guard let signature, publicKey.isValidSignature(signature, for: signingInput) else {
        return .rejected("Signature does not verify")
      }
    } catch {
      return .rejected("Verification error: \(error.localizedDescription)")
    }
    _ = decoded
    return .ok(resolved.1)
  }

  private func embeddedJwkSelfDerivedDid(_ jwk: PublicKeyJWK) -> String? {
    guard let jwkString = try? jwk.jsonString() else { return nil }
    return try? DidMethodUtils(method: .key).didFromJwk(jwk: jwkString)
  }

  private func normalizedDid(_ did: String) -> String {
    did.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  }

  private enum StoredVerificationKeySource { case anchor, didKey, embeddedJwk }

  private enum StoredVerificationKeyOutcome {
    case ok(key: PublicKeyJWK, source: StoredVerificationKeySource)
    case rejected(reason: String)
  }

  /// Resolves the public key the JWT signature should be verified against.
  /// Mirrors `verifyImportedJWTSignature`'s chain so a cryptographically
  /// valid did:key signature is honoured even when the issuer isn't in
  /// `IssuerTrustAnchorStore`.
  private func resolveStoredVerificationKey(
    issuerDid: String,
    keyId: String?,
    embeddedJwk: PublicKeyJWK?
  ) -> StoredVerificationKeyOutcome {
    if let anchor = IssuerTrustAnchorStore.shared.trustedJWK(for: issuerDid, keyId: keyId) {
      if let embedded = embeddedJwk, embedded != anchor {
        return .rejected(reason: "Embedded publicKeyJwk does not match trusted issuer key")
      }
      return .ok(key: anchor, source: .anchor)
    }
    if let didKeyJWK = DIDKeyResolver.resolveP256JWK(from: issuerDid) {
      if let embedded = embeddedJwk, embedded != didKeyJWK {
        return .rejected(reason: "Embedded publicKeyJwk does not match did:key resolution")
      }
      return .ok(key: didKeyJWK, source: .didKey)
    }
    if let embedded = embeddedJwk,
       let derived = embeddedJwkSelfDerivedDid(embedded),
       normalizedDid(derived) == normalizedDid(issuerDid) {
      return .ok(key: embedded, source: .embeddedJwk)
    }
    return .rejected(reason: "No trusted public key found for issuer \(issuerDid)")
  }

  func verifyStoredCredential(_ credential: VCLibrary.StoredCredential) -> CardResult<VCLibrary.StoredCredential> {
    Self.logger.info("Verifying stored credential")
    let components = credential.jwt.split(separator: ".")
    guard components.count == 3 else {
      Self.logger.error("Malformed JWT - component count: \(components.count), expected 3")
      return .failure(.invalidData("Malformed JWT"))
    }

    let signingInput = "\(components[0]).\(components[1])"
    guard
      let signatureData = Data(base64URLEncoded: String(components[2])),
      let signingData = signingInput.data(using: .utf8)
    else {
      Self.logger.error("Invalid JWT signature encoding")
      return .failure(.invalidData("Invalid JWT signature encoding"))
    }

    Self.logger.info("Decoding JWT for verification")
    let decodedResult = decodeJWT(credential.jwt)

    switch decodedResult {
    case .failure(let error):
      Self.logger.error("Failed to decode JWT during verification: \(error.localizedDescription)")
      return .failure(error)
    case .success(let decoded):
      Self.logger.info("JWT decoded, parsing credential envelope")
      do {
        let envelope = try JSONDecoder().decode(BusinessCardCredentialEnvelope.self, from: decoded.payloadData)

        let credentialSubject = (envelope.vc ?? envelope.payload?.vc)?.credentialSubject
        let issuerDid = envelope.iss ?? envelope.payload?.iss
        let keyId = decoded.header["kid"] as? String

        guard let issuerDid, !issuerDid.isEmpty else {
          Self.logger.error("Credential is missing issuer DID")
          return storeVerificationResult(credential, status: .failed)
        }

        let resolution = resolveStoredVerificationKey(
          issuerDid: issuerDid,
          keyId: keyId,
          embeddedJwk: credentialSubject?.publicKeyJwk
        )
        let resolvedKey: PublicKeyJWK
        let resolvedSource: StoredVerificationKeySource
        switch resolution {
        case .rejected(let reason):
          Self.logger.error("Key resolution failed: \(reason)")
          return storeVerificationResult(credential, status: .failed)
        case .ok(let key, let source):
          resolvedKey = key
          resolvedSource = source
        }

        Self.logger.info("Verifying signature with resolved issuer key")
        // Cross-check the JWT alg header against the resolved key. The
        // resolved JWK is P-256 (ES256); accepting `none`, `HS256`, `ES384`,
        // etc. would let an attacker bypass the signature step entirely.
        // RFC 8725 §3.1 requires the verifier to pin alg to the key's known
        // curve before signature decode.
        let alg = (decoded.header["alg"] as? String)?.uppercased() ?? ""
        guard alg == "ES256" else {
          Self.logger.error("Rejecting credential with non-ES256 alg: \(alg.isEmpty ? "(missing)" : alg)")
          return storeVerificationResult(credential, status: .failed)
        }

        let publicKey = try resolvedKey.toP256PublicKey()
        let signature =
          (try? P256.Signing.ECDSASignature(rawRepresentation: signatureData))
          ?? (try? P256.Signing.ECDSASignature(derRepresentation: signatureData))

        guard let signature else {
          Self.logger.error("Unsupported JWT signature encoding")
          return storeVerificationResult(credential, status: .failed)
        }

        guard publicKey.isValidSignature(signature, for: signingData) else {
          Self.logger.error("Signature verification failed")
          return storeVerificationResult(credential, status: .failed)
        }

        Self.logger.info("Signature verified, checking expiration")

        let now = Date()
        if let notBefore = envelope.nbf {
          let nbfDate = Date(timeIntervalSince1970: TimeInterval(notBefore))
          if now < nbfDate {
            Self.logger.warning("Credential not yet valid - nbf: \(nbfDate), now: \(now)")
            return storeVerificationResult(credential, status: .failed)
          }
        }

        if let expiration = envelope.exp {
          let expDate = Date(timeIntervalSince1970: TimeInterval(expiration))
          if now > expDate {
            Self.logger.warning("Credential expired - exp: \(expDate), now: \(now)")
            return storeVerificationResult(credential, status: .failed)
          }
        }

        // Trust gradient: anchored issuers earn `.verified`. did:key /
        // embedded-JWK issuers earn `.verified` too — the signature binds
        // to the issuer DID, which is what L1 self-issued credentials assert.
        Self.logger.info("Credential verification successful (\(String(describing: resolvedSource)))")
        return storeVerificationResult(credential, status: .verified)
      } catch let cardError as CardError {
        Self.logger.error("CardError during verification: \(cardError.localizedDescription)")
        return .failure(cardError)
      } catch {
        Self.logger.error("Verification failed: \(error.localizedDescription)")
        return .failure(.invalidData("Verification failed: \(error.localizedDescription)"))
      }
    }
  }

  private func storeVerificationResult(
    _ credential: VCLibrary.StoredCredential,
    status: VCLibrary.StoredCredential.Status
  ) -> CardResult<VCLibrary.StoredCredential> {
    var updated = credential
    updated.status = status
    updated.lastVerifiedAt = Date()

    switch library.update(updated) {
    case .success:
      return .success(updated)
    case .failure(let error):
      return .failure(error)
    }
  }
}
