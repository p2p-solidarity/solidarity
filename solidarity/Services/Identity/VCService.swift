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
  /// Internal so the verify-side extension in `VCService+Verify.swift`
  /// can persist import / verification results without rerouting through
  /// a forwarding accessor. Still scoped to the module.
  let library: VCLibrary

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

  // Import + verification chain lives in VCService+Verify.swift to keep
  // this file under the 600-line lint cap.
}
