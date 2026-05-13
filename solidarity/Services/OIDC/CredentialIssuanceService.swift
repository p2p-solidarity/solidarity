//
//  CredentialIssuanceService.swift
//  solidarity
//
//  OID4VCI (OpenID for Verifiable Credential Issuance) client.
//  Handles pre-authorized code flow: credential offer → token → credential.
//

import Foundation
import os

/// OID4VCI client implementing the pre-authorized code flow.
final class CredentialIssuanceService {
  static let shared = CredentialIssuanceService()
  static let logger = Logger(subsystem: AppBranding.currentLoggerSubsystem, category: "OID4VCI")

  let keychain = KeychainService.shared
  let didService = DIDService()
  let session: URLSession

  private init() {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 30
    self.session = URLSession(configuration: config)
  }

  // MARK: - Parse Credential Offer

  func parseOffer(from urlString: String) -> CardResult<CredentialOffer> {
    guard let url = URL(string: urlString),
          let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    else {
      return .failure(.invalidData("Invalid credential offer URL"))
    }

    let queryItems = components.queryItems ?? []

    if let offerJson = queryItems.first(where: { $0.name == "credential_offer" })?.value,
       let data = offerJson.data(using: .utf8)
    {
      return decodeOffer(from: data)
    }

    if let offerUri = queryItems.first(where: { $0.name == "credential_offer_uri" })?.value {
      return .failure(.configurationError("credential_offer_uri requires async fetch. URI: \(offerUri)"))
    }

    return .failure(.invalidData("No credential_offer or credential_offer_uri found in URL"))
  }

  func parseOfferAsync(from urlString: String) async -> CardResult<CredentialOffer> {
    guard let url = URL(string: urlString),
          let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    else {
      return .failure(.invalidData("Invalid credential offer URL"))
    }

    let queryItems = components.queryItems ?? []

    if let offerJson = queryItems.first(where: { $0.name == "credential_offer" })?.value,
       let data = offerJson.data(using: .utf8)
    {
      return decodeOffer(from: data)
    }

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

  // MARK: - Issuer Metadata

  /// Fetch `/.well-known/openid-credential-issuer` and optionally chain into
  /// the authorization server metadata (for the real token endpoint).
  /// Returns nil on failure so callers fall back to guessed endpoints.
  func fetchIssuerMetadata(for offer: CredentialOffer) async -> IssuerMetadata? {
    guard let metadataURL = offer.metadataURL else { return nil }

    do {
      let (data, response) = try await session.data(from: metadataURL)
      guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
      else {
        Self.logger.info("Issuer metadata not available at \(metadataURL.absoluteString)")
        return nil
      }

      guard let credentialEndpointString = json["credential_endpoint"] as? String,
            let credentialEndpoint = URL(string: credentialEndpointString)
      else {
        return nil
      }

      // OID4VCI final §7.2: `nonce_endpoint` is advertised alongside
      // `credential_endpoint` on issuer metadata. When present, callers
      // SHOULD fetch a fresh c_nonce from it before building the proof of
      // possession — the token-response c_nonce is optional and may be
      // absent for issuers that defer nonce issuance to this endpoint.
      let nonceEndpoint = (json["nonce_endpoint"] as? String).flatMap(URL.init(string:))

      // Token endpoint may be advertised directly on the issuer metadata or
      // delegated to an authorization server.
      if let tokenString = json["token_endpoint"] as? String,
         let tokenEndpoint = URL(string: tokenString) {
        return IssuerMetadata(
          credentialEndpoint: credentialEndpoint,
          tokenEndpoint: tokenEndpoint,
          authorizationServer: nil,
          nonceEndpoint: nonceEndpoint
        )
      }

      if let asString = (json["authorization_servers"] as? [String])?.first
          ?? json["authorization_server"] as? String,
         let asURL = URL(string: asString),
         let tokenEndpoint = await resolveTokenEndpoint(authorizationServer: asURL) {
        return IssuerMetadata(
          credentialEndpoint: credentialEndpoint,
          tokenEndpoint: tokenEndpoint,
          authorizationServer: asURL,
          nonceEndpoint: nonceEndpoint
        )
      }

      return IssuerMetadata(
        credentialEndpoint: credentialEndpoint,
        tokenEndpoint: URL(string: "\(offer.credentialIssuer)/token") ?? credentialEndpoint,
        authorizationServer: nil,
        nonceEndpoint: nonceEndpoint
      )
    } catch {
      Self.logger.info("Issuer metadata fetch failed: \(error.localizedDescription)")
      return nil
    }
  }

  // MARK: - Nonce Endpoint (OID4VCI final §7.2)

  /// Fetches a fresh c_nonce from the issuer's `nonce_endpoint` when
  /// advertised. The endpoint responds with `{c_nonce, c_nonce_expires_in}`
  /// and is called without authorization — it binds nothing until the
  /// nonce is echoed inside a signed proof. Returns nil on any failure so
  /// callers can fall back to the token-response c_nonce.
  func fetchFreshCNonce(from endpoint: URL) async -> String? {
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.httpBody = Data()

    do {
      let (data, response) = try await session.data(for: request)
      guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
        Self.logger.info("nonce_endpoint returned HTTP \((response as? HTTPURLResponse)?.statusCode ?? -1)")
        return nil
      }
      guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let nonce = json["c_nonce"] as? String, !nonce.isEmpty else {
        return nil
      }
      return nonce
    } catch {
      Self.logger.info("nonce_endpoint fetch failed: \(error.localizedDescription)")
      return nil
    }
  }

  private func resolveTokenEndpoint(authorizationServer: URL) async -> URL? {
    let discoveryURL = authorizationServer
      .appendingPathComponent(".well-known")
      .appendingPathComponent("openid-configuration")
    do {
      let (data, _) = try await session.data(from: discoveryURL)
      guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let tokenEndpoint = json["token_endpoint"] as? String
      else { return nil }
      return URL(string: tokenEndpoint)
    } catch {
      return nil
    }
  }

  // MARK: - Token Request

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

    // OID4VCI final §6.1 renamed `user_pin` to `tx_code`. We send both
    // during the transition — older draft-13 issuers still look for
    // user_pin, final issuers look for tx_code. Requesting with both is
    // harmless because issuers ignore unknown form parameters.
    if let pin = userPin, offer.txCode != nil {
      bodyItems.append(URLQueryItem(name: "tx_code", value: pin))
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

  func requestCredential(
    offer: CredentialOffer,
    tokenResponse: VCITokenResponse
  ) async -> CardResult<IssuanceResult> {
    guard let credentialURL = offer.credentialEndpoint else {
      return .failure(.invalidData("Cannot derive credential endpoint from issuer: \(offer.credentialIssuer)"))
    }

    Self.logger.info("Requesting credential from \(credentialURL.absoluteString)")

    // OID4VCI final §7.2: when the issuer advertises a nonce_endpoint, a
    // freshly fetched c_nonce takes precedence over the one returned from
    // the token endpoint. Reason: issuers that advertise the endpoint
    // treat the token-response nonce as optional and may omit it.
    var effectiveCNonce = tokenResponse.cNonce
    if let nonceEndpoint = offer.resolvedMetadata?.nonceEndpoint {
      if let fresh = await fetchFreshCNonce(from: nonceEndpoint) {
        effectiveCNonce = fresh
      }
    }

    let proofResult = buildProofJWT(
      issuerURL: offer.credentialIssuer,
      cNonce: effectiveCNonce
    )
    guard case .success(let proofJWT) = proofResult else {
      if case .failure(let error) = proofResult { return .failure(error) }
      return .failure(.cryptographicError("Failed to build proof of possession"))
    }

    let credentialType = offer.credentialConfigurationIds.first ?? "VerifiableCredential"

    // OID4VCI final §6.4: when the token response carries
    // `authorization_details` with `credential_identifiers`, the
    // Credential Request MUST use `credential_identifier` instead of
    // `credential_configuration_id`. The issuer has bound the
    // authorization to a specific issuer-picked identifier — sending the
    // configuration id back would be a spec violation.
    let credentialIdentifiers: [String] = (tokenResponse.authorizationDetails ?? [])
      .flatMap { ($0["credential_identifiers"] as? [String]) ?? [] }

    // OID4VCI final §7.2 replaces the draft-13 request shape:
    //   - `credential_definition` + `format` → `credential_configuration_id`
    //   - `proof` (single) → `proofs` (object keyed by proof_type, array of proofs)
    // We keep `format` + `credential_definition` alongside for issuers that
    // still speak draft-13, so the same request succeeds on both stacks.
    func makeRequestBody(proofJWT: String) -> [String: Any] {
      var body: [String: Any] = [
        "proofs": [
          "jwt": [proofJWT],
        ],
        "format": "jwt_vc_json",
        "credential_definition": [
          "type": ["VerifiableCredential", credentialType]
        ],
        "proof": [
          "proof_type": "jwt",
          "jwt": proofJWT,
        ],
      ]
      if let identifier = credentialIdentifiers.first {
        body["credential_identifier"] = identifier
      } else {
        body["credential_configuration_id"] = credentialType
      }
      return body
    }

    guard let bodyData = try? JSONSerialization.data(withJSONObject: makeRequestBody(proofJWT: proofJWT)) else {
      return .failure(.invalidData("Failed to serialize credential request body"))
    }

    do {
      var request = URLRequest(url: credentialURL)
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.setValue("Bearer \(tokenResponse.accessToken)", forHTTPHeaderField: "Authorization")
      request.httpBody = bodyData

      var (data, response) = try await session.data(for: request)
      var httpResponse = response as? HTTPURLResponse
      var didRetryOnInvalidNonce = false

      if let http = httpResponse, !(200...299).contains(http.statusCode) {
        // OID4VCI draft 13 §7.3.2: on `invalid_nonce`, retry AT MOST ONCE
        // with the fresh c_nonce. The retry is gated by:
        //   1. The original credential URL must be HTTPS — a MITM on
        //      cleartext could otherwise force the wallet to sign any
        //      attacker-supplied c_nonce.
        //   2. The fresh nonce must look like a plausible random token
        //      (>= 16 base64url chars). This is heuristic, not a defence
        //      on its own; it's a tripwire against grossly malformed
        //      nonces injected by a degraded transport.
        //   3. We never retry more than once per credential request — if
        //      the issuer keeps replying invalid_nonce, fail outright
        //      rather than enter a sign loop.
        if let errorJson = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let errorCode = errorJson["error"] as? String,
           errorCode == "invalid_nonce",
           let freshNonce = errorJson["c_nonce"] as? String {
          guard credentialURL.scheme?.lowercased() == "https" else {
            Self.logger.error("Refusing invalid_nonce retry over non-TLS transport: \(credentialURL.absoluteString)")
            return .failure(.networkError("invalid_nonce retry requires TLS transport"))
          }
          guard Self.looksLikeRandomToken(freshNonce) else {
            Self.logger.error("Refusing invalid_nonce retry: c_nonce fails random-token heuristic")
            return .failure(.networkError("invalid_nonce retry rejected: malformed c_nonce"))
          }
          Self.logger.info("Credential endpoint returned invalid_nonce; retrying once with fresh c_nonce")
          let retryProofResult = buildProofJWT(
            issuerURL: offer.credentialIssuer,
            cNonce: freshNonce
          )
          guard case .success(let retryProofJWT) = retryProofResult else {
            if case .failure(let error) = retryProofResult { return .failure(error) }
            return .failure(.cryptographicError("Failed to build proof of possession"))
          }
          guard let retryBodyData = try? JSONSerialization.data(withJSONObject: makeRequestBody(proofJWT: retryProofJWT)) else {
            return .failure(.invalidData("Failed to serialize credential request body"))
          }
          request.httpBody = retryBodyData
          didRetryOnInvalidNonce = true
          (data, response) = try await session.data(for: request)
          httpResponse = response as? HTTPURLResponse

          // Second invalid_nonce → fail outright. Do NOT loop.
          if let retryHttp = httpResponse, !(200...299).contains(retryHttp.statusCode),
             let retryJson = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
             (retryJson["error"] as? String) == "invalid_nonce" {
            Self.logger.error("Credential endpoint returned invalid_nonce on retry; aborting")
            return .failure(.networkError("Credential endpoint returned invalid_nonce on retry"))
          }
        }
      }

      guard let finalResponse = httpResponse,
            (200...299).contains(finalResponse.statusCode) else {
        let code = httpResponse?.statusCode ?? -1
        let body = String(data: data, encoding: .utf8) ?? ""
        Self.logger.error("Credential endpoint returned HTTP \(code)\(didRetryOnInvalidNonce ? " (after invalid_nonce retry)" : ""): \(body)")
        return .failure(.networkError("Credential endpoint returned HTTP \(code)"))
      }

      let credResponse = try JSONDecoder().decode(CredentialResponse.self, from: data)

      guard let jwt = credResponse.primaryCredentialJWT else {
        return .failure(.invalidData("Credential endpoint returned no credential"))
      }

      let format = credResponse.primaryFormat ?? "jwt_vc_json"
      Self.logger.info("Credential received, format: \(format), batch=\(credResponse.credentials?.count ?? 0)")
      return .success(IssuanceResult(
        credentialJWT: jwt,
        format: format,
        issuer: offer.credentialIssuer,
        credentialType: credentialType,
        cNonce: credResponse.cNonce
      ))
    } catch let cardError as CardError {
      return .failure(cardError)
    } catch {
      return .failure(.networkError("Credential request failed: \(error.localizedDescription)"))
    }
  }

  // MARK: - Full Issuance Flow

  func executeIssuance(
    offerURL: String,
    userPin: String? = nil
  ) async -> CardResult<VCLibrary.StoredCredential> {
    let offerResult = await parseOfferAsync(from: offerURL)
    guard case .success(var offer) = offerResult else {
      if case .failure(let error) = offerResult { return .failure(error) }
      return .failure(.invalidData("Failed to parse credential offer"))
    }

    // Discover real endpoints from issuer metadata when available.
    offer.resolvedMetadata = await fetchIssuerMetadata(for: offer)

    let tokenResult = await requestToken(offer: offer, userPin: userPin)
    guard case .success(let tokenResponse) = tokenResult else {
      if case .failure(let error) = tokenResult { return .failure(error) }
      return .failure(.networkError("Failed to obtain token"))
    }

    let credentialResult = await requestCredential(offer: offer, tokenResponse: tokenResponse)
    guard case .success(let issuanceResult) = credentialResult else {
      if case .failure(let error) = credentialResult { return .failure(error) }
      return .failure(.networkError("Failed to obtain credential"))
    }

    return storeCredential(issuanceResult)
  }

  // MARK: - c_nonce sanity heuristic

  /// Returns true if `value` plausibly looks like a server-issued random
  /// nonce: at least 16 characters, each from the unreserved base64url
  /// alphabet (RFC 4648 §5). This is a tripwire — a real defence against
  /// an injected c_nonce relies on TLS authentication of the issuer, not
  /// on the shape of the token.
  static func looksLikeRandomToken(_ value: String) -> Bool {
    guard value.count >= 16 else { return false }
    let allowed = CharacterSet(charactersIn:
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
    return value.unicodeScalars.allSatisfy { allowed.contains($0) }
  }
}
