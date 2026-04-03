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
      var pinRequired = false

      if let grants = json["grants"] as? [String: Any] {
        let preAuthGrant = grants["urn:ietf:params:oauth:grant-type:pre-authorized_code"] as? [String: Any]
        preAuthCode = preAuthGrant?["pre-authorized_code"] as? String
        pinRequired = preAuthGrant?["user_pin_required"] as? Bool ?? false
      }

      Self.logger.info("Parsed offer from \(issuer), \(configIds.count) credential(s)")
      return .success(CredentialOffer(
        credentialIssuer: issuer,
        credentialConfigurationIds: configIds,
        preAuthorizedCode: preAuthCode,
        userPinRequired: pinRequired
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
    let header: [String: Any] = [
      "alg": "ES256",
      "typ": "openid4vci-proof+jwt",
      "kid": descriptor.verificationMethodId,
    ]

    var payload: [String: Any] = [
      "iss": descriptor.did,
      "aud": issuerURL,
      "iat": now,
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
      stored.status = .verified
      stored.lastVerifiedAt = Date()
      if case .success = VCLibrary.shared.update(stored) {
        Self.logger.info("Issued credential stored and verified")
      }
      return .success(stored)
    case .failure(let error):
      Self.logger.error("Failed to import issued credential: \(error.localizedDescription)")
      return .failure(error)
    }
  }
}
