//
//  CredentialIssuanceService+Proof.swift
//  solidarity
//

import Foundation

// MARK: - Proof JWT & Credential Storage

extension CredentialIssuanceService {

  func decodeOffer(from data: Data) -> CardResult<CredentialOffer> {
    do {
      let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]

      let issuer = json["credential_issuer"] as? String ?? ""
      guard !issuer.isEmpty else {
        return .failure(.invalidData("Missing credential_issuer in offer"))
      }

      let configIds = json["credential_configuration_ids"] as? [String]
        ?? json["credentials"] as? [String]
        ?? []

      var preAuthCode: String?
      var txCode: TxCodeSpec?

      if let grants = json["grants"] as? [String: Any] {
        let preAuthGrant = grants["urn:ietf:params:oauth:grant-type:pre-authorized_code"] as? [String: Any]
        preAuthCode = preAuthGrant?["pre-authorized_code"] as? String
        // OID4VCI final §4.1.1 introduces `tx_code` (object). Older drafts
        // sent `user_pin_required: true`; promote that to a default spec.
        if let txCodeValue = preAuthGrant?["tx_code"] {
          txCode = TxCodeSpec.parse(txCodeValue)
        } else if let legacy = preAuthGrant?["user_pin_required"] as? Bool, legacy {
          txCode = .default
        }
      }

      Self.logger.info("Parsed offer from \(issuer), \(configIds.count) credential(s)")
      return .success(CredentialOffer(
        credentialIssuer: issuer,
        credentialConfigurationIds: configIds,
        preAuthorizedCode: preAuthCode,
        txCode: txCode
      ))
    } catch {
      return .failure(.invalidData("Failed to decode credential offer JSON: \(error.localizedDescription)"))
    }
  }

  func buildProofJWT(issuerURL: String, cNonce: String?) -> CardResult<String> {
    let contextResult = keychain.authenticationContext(reason: "Sign credential request")
    guard case .success(let context) = contextResult else {
      if case .failure(let error) = contextResult { return .failure(error) }
      return .failure(.keyManagementError("Failed to get authentication context"))
    }

    let descriptorResult = didService.currentDescriptor(
      for: URL(string: issuerURL)?.host,
      context: context
    )
    guard case .success(let descriptor) = descriptorResult else {
      if case .failure(let error) = descriptorResult { return .failure(error) }
      return .failure(.keyManagementError("Failed to derive DID for proof"))
    }

    let rpDomain = URL(string: issuerURL)?.host
    let signerResult: CardResult<BiometricSigningKey>
    if let domain = rpDomain {
      signerResult = keychain.pairwiseSigningKey(for: domain, context: context)
    } else {
      signerResult = keychain.signingKey(context: context)
    }
    guard case .success(let signingKey) = signerResult else {
      if case .failure(let error) = signerResult { return .failure(error) }
      return .failure(.keyManagementError("Unable to access signing key"))
    }

    let now = Int(Date().timeIntervalSince1970)
    // OID4VCI §7.2.1 strongly recommends `exp` on proof JWTs so a leaked
    // signed proof has a bounded reuse window. Five minutes covers
    // realistic clock skew + retry latency without giving an attacker
    // meaningful replay reach.
    let proofLifetime = 300 // 5 minutes
    let header: [String: Any] = [
      "alg": "ES256",
      "typ": "openid4vci-proof+jwt",
      "kid": descriptor.verificationMethodId,
    ]

    var payload: [String: Any] = [
      "iss": descriptor.did,
      "aud": issuerURL,
      "iat": now,
      "exp": now + proofLifetime,
    ]
    if let nonce = cNonce {
      payload["nonce"] = nonce
    }

    do {
      let headerData = try JSONSerialization.data(withJSONObject: header, options: [.sortedKeys])
      let payloadData = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])

      let headerB64 = headerData.base64URLEncodedString()
      let payloadB64 = payloadData.base64URLEncodedString()
      let signingInput = "\(headerB64).\(payloadB64)"

      guard let signingInputData = signingInput.data(using: .utf8) else {
        return .failure(.invalidData("Failed to encode proof signing input"))
      }

      let signature = try signingKey.sign(payload: signingInputData).base64URLEncodedString()
      return .success("\(signingInput).\(signature)")
    } catch {
      return .failure(.cryptographicError("Failed to sign proof JWT: \(error.localizedDescription)"))
    }
  }

  func storeCredential(_ result: IssuanceResult) -> CardResult<VCLibrary.StoredCredential> {
    let vcService = VCService()

    switch vcService.importPresentedCredential(jwt: result.credentialJWT) {
    case .success(let imported):
      var stored = imported.storedCredential

      // Real signature verification — previously this method blindly marked
      // every imported credential as `.verified`. Now we only upgrade the
      // status if ProofVerifierService can prove the issuer signature.
      let verifier = ProofVerifierService.shared
      if let decoded = verifier.decodeCompactJWT(result.credentialJWT) {
        switch verifier.verifyJWTSignature(
          jwt: result.credentialJWT,
          header: decoded.header,
          payload: decoded.payload
        ) {
        case .success(let detail):
          stored.status = .verified
          stored.lastVerifiedAt = Date()
          Self.logger.info("Issued credential verified (\(detail))")
        case .failure(let reason):
          stored.status = .unverified
          Self.logger.error("Issued credential signature unverified: \(reason)")
        }
      } else {
        stored.status = .unverified
        Self.logger.error("Issued credential JWT could not be decoded for verification")
      }

      _ = VCLibrary.shared.update(stored)
      return .success(stored)
    case .failure(let error):
      Self.logger.error("Failed to import issued credential: \(error.localizedDescription)")
      return .failure(error)
    }
  }
}
