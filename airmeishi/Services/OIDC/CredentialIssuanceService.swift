//
//  CredentialIssuanceService.swift
//  airmeishi
//
//  OID4VCI (OpenID for Verifiable Credential Issuance) client.
//  Handles pre-authorized code flow: credential offer → token → credential.
//

import Foundation
import os

/// Parsed credential offer from `openid-credential-offer://` URL.
struct CredentialOffer: Equatable {
  let credentialIssuer: String
  let credentialConfigurationIds: [String]
  let preAuthorizedCode: String?
  let userPinRequired: Bool

  /// Derives the issuer's well-known metadata URL.
  var metadataURL: URL? {
    URL(string: "\(credentialIssuer)/.well-known/openid-credential-issuer")
  }

  var tokenEndpoint: URL? {
    URL(string: "\(credentialIssuer)/token")
  }

  var credentialEndpoint: URL? {
    URL(string: "\(credentialIssuer)/credential")
  }
}

/// Response from the issuer's token endpoint.
struct VCITokenResponse: Decodable {
  let accessToken: String
  let tokenType: String
  let expiresIn: Int?
  let cNonce: String?
  let cNonceExpiresIn: Int?

  enum CodingKeys: String, CodingKey {
    case accessToken = "access_token"
    case tokenType = "token_type"
    case expiresIn = "expires_in"
    case cNonce = "c_nonce"
    case cNonceExpiresIn = "c_nonce_expires_in"
  }
}

/// Response from the issuer's credential endpoint.
struct CredentialResponse: Decodable {
  let credential: String?
  let format: String?
  let cNonce: String?
  let cNonceExpiresIn: Int?
  let notificationId: String?

  enum CodingKeys: String, CodingKey {
    case credential
    case format
    case cNonce = "c_nonce"
    case cNonceExpiresIn = "c_nonce_expires_in"
    case notificationId = "notification_id"
  }
}

/// Aggregated result of a successful credential issuance.
struct IssuanceResult {
  let credentialJWT: String
  let format: String
  let issuer: String
  let credentialType: String
}

/// OID4VCI client implementing the pre-authorized code flow.
final class CredentialIssuanceService {
  static let shared = CredentialIssuanceService()
  private static let logger = Logger(subsystem: "com.kidneyweakx.airmeishi", category: "OID4VCI")

  private let keychain = KeychainService.shared
  private let didService = DIDService()
  private let session: URLSession

  private init() {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 30
    self.session = URLSession(configuration: config)
  }

  // MARK: - Parse Credential Offer

  /// Parses an `openid-credential-offer://` URL into a `CredentialOffer`.
  func parseOffer(from urlString: String) -> CardResult<CredentialOffer> {
    guard let url = URL(string: urlString),
          let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    else {
      return .failure(.invalidData("Invalid credential offer URL"))
    }

    let queryItems = components.queryItems ?? []

    // Try inline credential_offer JSON first
    if let offerJson = queryItems.first(where: { $0.name == "credential_offer" })?.value,
       let data = offerJson.data(using: .utf8)
    {
      return decodeOffer(from: data)
    }

    // Fallback: credential_offer_uri (fetch from server)
    if let offerUri = queryItems.first(where: { $0.name == "credential_offer_uri" })?.value {
      return .failure(.configurationError("credential_offer_uri requires async fetch. URI: \(offerUri)"))
    }

    return .failure(.invalidData("No credential_offer or credential_offer_uri found in URL"))
  }

  /// Async version that handles both inline offers and credential_offer_uri.
  func parseOfferAsync(from urlString: String) async -> CardResult<CredentialOffer> {
    guard let url = URL(string: urlString),
          let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    else {
      return .failure(.invalidData("Invalid credential offer URL"))
    }

    let queryItems = components.queryItems ?? []

    // Inline credential_offer
    if let offerJson = queryItems.first(where: { $0.name == "credential_offer" })?.value,
       let data = offerJson.data(using: .utf8)
    {
      return decodeOffer(from: data)
    }

    // Fetch from credential_offer_uri
    if let offerUriString = queryItems.first(where: { $0.name == "credential_offer_uri" })?.value,
       let offerUri = URL(string: offerUriString)
    {
      do {
        let (data, response) = try await session.data(from: offerUri)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
          let code = (response as? HTTPURLResponse)?.statusCode ?? -1
          return .failure(.networkError("Failed to fetch credential offer: HTTP \(code)"))
        }
        return decodeOffer(from: data)
      } catch {
        return .failure(.networkError("Failed to fetch credential offer: \(error.localizedDescription)"))
      }
    }

    return .failure(.invalidData("No credential_offer or credential_offer_uri found in URL"))
  }

  // MARK: - Token Request

  /// Requests an access token from the issuer's token endpoint using a pre-authorized code.
  func requestToken(offer: CredentialOffer, userPin: String? = nil) async -> CardResult<VCITokenResponse> {
    guard let tokenURL = offer.tokenEndpoint else {
      return .failure(.invalidData("Cannot derive token endpoint from issuer: \(offer.credentialIssuer)"))
    }

    Self.logger.info("Requesting token from \(tokenURL.absoluteString)")

    var bodyItems = [
      URLQueryItem(name: "grant_type", value: "urn:ietf:params:oauth:grant-type:pre-authorized_code"),
    ]

    if let code = offer.preAuthorizedCode {
      bodyItems.append(URLQueryItem(name: "pre-authorized_code", value: code))
    }

    if let pin = userPin, offer.userPinRequired {
      bodyItems.append(URLQueryItem(name: "user_pin", value: pin))
    }

    var bodyComponents = URLComponents()
    bodyComponents.queryItems = bodyItems
    guard let bodyString = bodyComponents.percentEncodedQuery else {
      return .failure(.invalidData("Failed to encode token request body"))
    }

    do {
      var request = URLRequest(url: tokenURL)
      request.httpMethod = "POST"
      request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
      request.httpBody = bodyString.data(using: .utf8)

      let (data, response) = try await session.data(for: request)
      guard let httpResponse = response as? HTTPURLResponse,
            (200...299).contains(httpResponse.statusCode) else {
        let code = (response as? HTTPURLResponse)?.statusCode ?? -1
        let body = String(data: data, encoding: .utf8) ?? ""
        Self.logger.error("Token endpoint returned HTTP \(code): \(body)")
        return .failure(.networkError("Token endpoint returned HTTP \(code)"))
      }

      let tokenResponse = try JSONDecoder().decode(VCITokenResponse.self, from: data)
      Self.logger.info("Token obtained, type: \(tokenResponse.tokenType)")
      return .success(tokenResponse)
    } catch let cardError as CardError {
      return .failure(cardError)
    } catch {
      return .failure(.networkError("Token request failed: \(error.localizedDescription)"))
    }
  }

  // MARK: - Credential Request

  /// Requests a credential from the issuer's credential endpoint.
  func requestCredential(
    offer: CredentialOffer,
    tokenResponse: VCITokenResponse
  ) async -> CardResult<IssuanceResult> {
    guard let credentialURL = offer.credentialEndpoint else {
      return .failure(.invalidData("Cannot derive credential endpoint from issuer: \(offer.credentialIssuer)"))
    }

    Self.logger.info("Requesting credential from \(credentialURL.absoluteString)")

    // Build proof of possession JWT
    let proofResult = buildProofJWT(
      issuerURL: offer.credentialIssuer,
      cNonce: tokenResponse.cNonce
    )
    guard case .success(let proofJWT) = proofResult else {
      if case .failure(let error) = proofResult { return .failure(error) }
      return .failure(.cryptographicError("Failed to build proof of possession"))
    }

    let credentialType = offer.credentialConfigurationIds.first ?? "VerifiableCredential"

    // Build request body
    let requestBody: [String: Any] = [
      "format": "jwt_vc_json",
      "credential_definition": [
        "type": ["VerifiableCredential", credentialType]
      ],
      "proof": [
        "proof_type": "jwt",
        "jwt": proofJWT,
      ],
    ]

    guard let bodyData = try? JSONSerialization.data(withJSONObject: requestBody) else {
      return .failure(.invalidData("Failed to serialize credential request body"))
    }

    do {
      var request = URLRequest(url: credentialURL)
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.setValue("Bearer \(tokenResponse.accessToken)", forHTTPHeaderField: "Authorization")
      request.httpBody = bodyData

      let (data, response) = try await session.data(for: request)
      guard let httpResponse = response as? HTTPURLResponse,
            (200...299).contains(httpResponse.statusCode) else {
        let code = (response as? HTTPURLResponse)?.statusCode ?? -1
        let body = String(data: data, encoding: .utf8) ?? ""
        Self.logger.error("Credential endpoint returned HTTP \(code): \(body)")
        return .failure(.networkError("Credential endpoint returned HTTP \(code)"))
      }

      let credResponse = try JSONDecoder().decode(CredentialResponse.self, from: data)

      guard let jwt = credResponse.credential else {
        return .failure(.invalidData("Credential endpoint returned no credential"))
      }

      Self.logger.info("Credential received, format: \(credResponse.format ?? "jwt_vc_json")")
      return .success(IssuanceResult(
        credentialJWT: jwt,
        format: credResponse.format ?? "jwt_vc_json",
        issuer: offer.credentialIssuer,
        credentialType: credentialType
      ))
    } catch let cardError as CardError {
      return .failure(cardError)
    } catch {
      return .failure(.networkError("Credential request failed: \(error.localizedDescription)"))
    }
  }

  // MARK: - Full Issuance Flow

  /// Runs the complete pre-authorized code flow: parse → token → credential → store.
  func executeIssuance(
    offerURL: String,
    userPin: String? = nil
  ) async -> CardResult<VCLibrary.StoredCredential> {
    // 1. Parse the credential offer
    let offerResult = await parseOfferAsync(from: offerURL)
    guard case .success(let offer) = offerResult else {
      if case .failure(let error) = offerResult { return .failure(error) }
      return .failure(.invalidData("Failed to parse credential offer"))
    }

    // 2. Request token
    let tokenResult = await requestToken(offer: offer, userPin: userPin)
    guard case .success(let tokenResponse) = tokenResult else {
      if case .failure(let error) = tokenResult { return .failure(error) }
      return .failure(.networkError("Failed to obtain token"))
    }

    // 3. Request credential
    let credentialResult = await requestCredential(offer: offer, tokenResponse: tokenResponse)
    guard case .success(let issuanceResult) = credentialResult else {
      if case .failure(let error) = credentialResult { return .failure(error) }
      return .failure(.networkError("Failed to obtain credential"))
    }

    // 4. Store credential
    return storeCredential(issuanceResult)
  }

  // MARK: - Private Helpers

  private func decodeOffer(from data: Data) -> CardResult<CredentialOffer> {
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

  /// Builds a proof-of-possession JWT for the credential endpoint.
  private func buildProofJWT(issuerURL: String, cNonce: String?) -> CardResult<String> {
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

    // Build JWT header + payload
    let now = Int(Date().timeIntervalSince1970)
    var header: [String: Any] = [
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

  /// Stores a received credential in the local vault via VCService import.
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
