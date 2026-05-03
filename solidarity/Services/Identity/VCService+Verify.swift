//
//  VCService+Verify.swift
//  solidarity
//
//  Import + verification side of VCService. Lives in its own file so the
//  issuance-heavy main VCService.swift stays under the 600-line lint cap.
//
import CryptoKit
import Foundation
import SpruceIDMobileSdkRs

extension VCService {
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

  fileprivate enum ImportTrustSource {
    case anchor
    case didKey
    case embeddedJWK
  }

  fileprivate enum ImportSignatureOutcome {
    case ok(ImportTrustSource)
    case rejected(String)
  }

  fileprivate func verifyImportedJWTSignature(
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

  fileprivate func embeddedJwkSelfDerivedDid(_ jwk: PublicKeyJWK) -> String? {
    guard let jwkString = try? jwk.jsonString() else { return nil }
    return try? DidMethodUtils(method: .key).didFromJwk(jwk: jwkString)
  }

  fileprivate func normalizedDid(_ did: String) -> String {
    did.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  }

  fileprivate enum StoredVerificationKeySource { case anchor, didKey, embeddedJwk }

  fileprivate enum StoredVerificationKeyOutcome {
    case ok(key: PublicKeyJWK, source: StoredVerificationKeySource)
    case rejected(reason: String)
  }

  /// Resolves the public key the JWT signature should be verified against.
  /// Mirrors `verifyImportedJWTSignature`'s chain so a cryptographically
  /// valid did:key signature is honoured even when the issuer isn't in
  /// `IssuerTrustAnchorStore`.
  fileprivate func resolveStoredVerificationKey(
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

  fileprivate func storeVerificationResult(
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
