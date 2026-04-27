//
//  OIDCService.swift
//  solidarity
//
//  Holder-side OIDC/SIOPv2/OID4VP surface. Produces verifier-style
//  Authorization Requests (when the app is asking someone else to present
//  a credential) and parses inbound Authorization Requests (when a remote
//  verifier is asking *us* to present).
//
//  Scheme convention:
//    - `openid4vp://` — OID4VP Authorization Request (current standard)
//    - `openid://`    — SIOPv2 self-issued id_token request (legacy)
//  Both are accepted on parse; the producer emits `openid4vp://`.
//

import CryptoKit
import Foundation
import UIKit
import os

/// Handles OIDC Authentication Request generation and parsing.
final class OIDCService: ObservableObject {
  static let shared = OIDCService()
  static let logger = Logger(subsystem: AppBranding.currentLoggerSubsystem, category: "OIDCService")

  /// Hard byte cap for any OID4VP request/response we accept from the
  /// network (request_uri payloads, JARM responses, etc.). Real flows are
  /// in the low-KB range; 256 KB lets us refuse adversarial blobs early
  /// without breaking realistic verifiers.
  static let maxOIDCResponseBytes = 256 * 1024

  struct PresentationRequest: Equatable {
    let id: String
    let state: String
    let nonce: String
    let clientId: String
    /// Redirect URI used for non-direct_post response modes. Empty when the
    /// request was received in `direct_post*` mode (the spec forbids both
    /// redirect_uri and response_uri in the same request).
    let redirectUri: String
    /// Response URI used for `direct_post` / `direct_post.jwt` response
    /// modes. nil otherwise.
    let responseUri: String?
    let responseType: String
    let responseMode: String
    /// DIF Presentation Exchange definition. For pure SIOPv2 id_token
    /// requests (no VP expected), this is a synthetic empty descriptor
    /// list so callers don't need to special-case the SIOP path.
    let presentationDefinition: PresentationDefinition
    /// OID4VP 1.0 DCQL query (JSON). When present, the verifier expects the
    /// holder to answer with DCQL matching. Stored raw so we can forward it
    /// to VP construction without lossy round-tripping through our model.
    let dcqlQueryJSON: String?

    init(
      id: String,
      state: String,
      nonce: String,
      clientId: String,
      redirectUri: String,
      responseUri: String? = nil,
      responseType: String,
      responseMode: String = "direct_post",
      presentationDefinition: PresentationDefinition,
      dcqlQueryJSON: String? = nil
    ) {
      self.id = id
      self.state = state
      self.nonce = nonce
      self.clientId = clientId
      self.redirectUri = redirectUri
      self.responseUri = responseUri
      self.responseType = responseType
      self.responseMode = responseMode
      self.presentationDefinition = presentationDefinition
      self.dcqlQueryJSON = dcqlQueryJSON
    }

    /// The URI to POST / redirect the response to. direct_post* modes must
    /// use response_uri per OID4VP 1.0 §6.2; other modes must use
    /// redirect_uri. Cross-mode fallback is intentionally absent — the
    /// parser enforces field/mode pairing, so a populated value is always
    /// available on the mode-appropriate field.
    var effectiveResponseTarget: String {
      if responseMode.lowercased().hasPrefix("direct_post") {
        return responseUri ?? ""
      }
      return redirectUri
    }

    /// True when the request is a pure SIOPv2 id_token request — no VP is
    /// expected and the holder should respond with a self-issued id_token.
    var isSIOPIdTokenOnly: Bool {
      let normalized = responseType
        .components(separatedBy: CharacterSet.whitespaces)
        .filter { !$0.isEmpty }
      return normalized == ["id_token"]
    }

    struct PresentationDefinition: Equatable {
      let id: String
      let inputDescriptors: [InputDescriptor]

      struct InputDescriptor: Equatable {
        let id: String
        let name: String?
        let purpose: String?
        let format: [String: Any]?
        let constraints: [String: Any]?

        static func == (lhs: InputDescriptor, rhs: InputDescriptor) -> Bool {
          lhs.id == rhs.id && lhs.name == rhs.name && lhs.purpose == rhs.purpose
        }
      }
    }
  }

  struct PresentationRequestContext: Equatable {
    let request: PresentationRequest
    let qrString: String
    let createdAt: Date
  }

  private let didService: DIDService
  private weak var coordinator: IdentityCoordinator?
  private let nonceLock = NSLock()
  /// Replay-protection nonce set. Persisted via `OIDCNonceStore` so a
  /// kill/restart cannot reset the in-memory cache and let an attacker
  /// replay a vp_token under a previously-seen nonce.
  private let nonceStore = OIDCNonceStore.shared
  private var seenNonces: [String: Date]
  // Internal so response-signing helpers in OIDCService+Response.swift
  // can reuse the same ephemeral session (matching TLS + timeout config).
  let session: URLSession

  init(didService: DIDService = DIDService()) {
    self.didService = didService
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 20
    self.session = URLSession(configuration: config)
    self.seenNonces = OIDCNonceStore.shared.load()
  }

  func attachIdentityCoordinator(_ coordinator: IdentityCoordinator) {
    self.coordinator = coordinator
  }

  /// Generates an OID4VP Authorization Request URL.
  ///
  /// - Parameters:
  ///   - redirectUri: Legacy redirect URI — used when `responseMode` is NOT
  ///     a direct_post variant.
  ///   - responseUri: URL where a direct_post holder POSTs vp_token. When
  ///     nil and `responseMode` is `direct_post*`, we reuse `redirectUri`
  ///     so callers that only knew about the legacy field keep working.
  ///   - presentationDefinition: DIF Presentation Exchange definition to
  ///     embed (OID4VP 1.0 final accepts either this or `dcqlQueryJSON`).
  ///   - dcqlQueryJSON: OID4VP 1.0 DCQL query as raw JSON. When supplied,
  ///     emitted as `dcql_query` alongside (not replacing) the PD so old
  ///     and new verifiers both parse the request.
  ///   - responseMode: `direct_post` (default), `direct_post.jwt`,
  ///     `fragment`, or `query`. Determines whether response_uri or
  ///     redirect_uri is emitted.
  func generateRequest(
    redirectUri: String = OIDCService.defaultCallbackURI(),
    responseUri: String? = nil,
    presentationDefinition: PresentationRequest.PresentationDefinition? = nil,
    dcqlQueryJSON: String? = nil,
    responseMode: String = "direct_post",
    relyingPartyDomain: String? = nil
  ) -> CardResult<URL> {
    let effectiveResponseUri: String? = {
      if responseUri != nil { return responseUri }
      if responseMode.lowercased().hasPrefix("direct_post") { return redirectUri }
      return nil
    }()
    let rpHost = relyingPartyDomain
      ?? URL(string: effectiveResponseUri ?? redirectUri)?.host
    let descriptorResult = didService.currentDescriptor(for: rpHost)
    guard case .success(let descriptor) = descriptorResult else {
      return .failure(.keyManagementError("No active DID found for OIDC request"))
    }
    let clientId = descriptor.did
    let nonce = UUID().uuidString
    let state = UUID().uuidString

    var components = URLComponents()
    components.scheme = "openid4vp"
    components.host = "authorize"

    var queryItems: [URLQueryItem] = [
      URLQueryItem(name: "client_id", value: clientId),
      URLQueryItem(name: "response_type", value: "vp_token"),
      URLQueryItem(name: "response_mode", value: responseMode),
      URLQueryItem(name: "nonce", value: nonce),
      URLQueryItem(name: "state", value: state),
    ]

    // OID4VP 1.0 §6.2: direct_post modes use response_uri exclusively;
    // redirect_uri MUST NOT be present in the same request. For other
    // response modes (fragment / query / form_post) we stay on redirect_uri.
    if responseMode.lowercased().hasPrefix("direct_post") {
      queryItems.append(URLQueryItem(name: "response_uri", value: effectiveResponseUri ?? redirectUri))
    } else {
      queryItems.append(URLQueryItem(name: "redirect_uri", value: redirectUri))
    }

    let definition = presentationDefinition ?? Self.defaultBusinessCardDefinition()
    if let pdJSON = try? Self.presentationDefinitionJSON(definition),
       let pdString = String(data: pdJSON, encoding: .utf8) {
      queryItems.append(URLQueryItem(name: "presentation_definition", value: pdString))
    }

    if let dcql = dcqlQueryJSON {
      queryItems.append(URLQueryItem(name: "dcql_query", value: dcql))
    }

    components.queryItems = queryItems

    guard let url = components.url else {
      return .failure(.invalidData("Failed to construct OIDC URL"))
    }

    return .success(url)
  }

  /// Generates a QR Code image from the OIDC Request URL.
  func generateQRCode(from url: URL) -> UIImage? {
    let context = CIContext()
    let filter = CIFilter(name: "CIQRCodeGenerator")

    let data = url.absoluteString.data(using: .utf8)
    filter?.setValue(data, forKey: "inputMessage")
    filter?.setValue("M", forKey: "inputCorrectionLevel")

    guard let outputImage = filter?.outputImage else { return nil }

    let transform = CGAffineTransform(scaleX: 10, y: 10)
    let scaledImage = outputImage.transformed(by: transform)

    if let cgImage = context.createCGImage(scaledImage, from: scaledImage.extent) {
      return UIImage(cgImage: cgImage)
    }
    return nil
  }

  // MARK: - Compatibility Methods

  func createPresentationRequest() -> CardResult<PresentationRequestContext> {
    let descriptorResult = didService.currentDescriptor(for: nil)
    guard case .success(let descriptor) = descriptorResult else {
      return .failure(.keyManagementError("No active DID found for presentation request"))
    }

    let definition = Self.defaultBusinessCardDefinition()
    let callback = Self.defaultCallbackURI()

    switch generateRequest(redirectUri: callback, responseUri: callback, presentationDefinition: definition) {
    case .success(let url):
      guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let queryItems = components.queryItems else {
        return .failure(.invalidData("Generated URL has no query items"))
      }
      let nonce = queryItems.first(where: { $0.name == "nonce" })?.value ?? ""
      let state = queryItems.first(where: { $0.name == "state" })?.value ?? ""

      let request = PresentationRequest(
        id: UUID().uuidString,
        state: state,
        nonce: nonce,
        clientId: descriptor.did,
        redirectUri: "",
        responseUri: callback,
        responseType: "vp_token",
        responseMode: "direct_post",
        presentationDefinition: definition
      )

      return .success(
        PresentationRequestContext(
          request: request,
          qrString: url.absoluteString,
          createdAt: Date()
        )
      )
    case .failure(let error):
      return .failure(error)
    }
  }

  func parseRequest(from string: String) -> CardResult<PresentationRequest> {
    guard let url = URL(string: string),
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    else {
      return .failure(.invalidData("Invalid OIDC request URL"))
    }
    return parseRequest(components: components)
  }

  /// Async parse that honours OID4VP 1.0 `request_uri`: fetches the signed
  /// (or plain JSON) Request Object and parses its body. When a JWT-wrapped
  /// Request Object is present (either via `request` query param or fetched
  /// from `request_uri`), the JWT signature MUST verify against the issuer's
  /// public key — otherwise the request is rejected. We never silently fall
  /// back to plain query-param parsing on JWT failure.
  func parseRequestAsync(from string: String) async -> CardResult<PresentationRequest> {
    guard let url = URL(string: string),
          let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    else {
      return .failure(.invalidData("Invalid OIDC request URL"))
    }

    if let requestUri = components.queryItems?.first(where: { $0.name == "request_uri" })?.value,
       let remote = URL(string: requestUri) {
      return await resolveRequestUri(remote, fallbackComponents: components)
    }

    if let requestJWT = components.queryItems?.first(where: { $0.name == "request" })?.value {
      return resolveRequestJWT(requestJWT, fallbackComponents: components)
    }

    return parseRequest(components: components)
  }

  private func parseRequest(components: URLComponents) -> CardResult<PresentationRequest> {
    let queryItems = components.queryItems ?? []

    guard let clientId = queryItems.first(where: { $0.name == "client_id" })?.value,
      !clientId.isEmpty
    else {
      return .failure(.invalidData("Missing or empty client_id in authorization request"))
    }
    guard let nonce = queryItems.first(where: { $0.name == "nonce" })?.value, !nonce.isEmpty else {
      return .failure(.invalidData("Missing or empty nonce in authorization request"))
    }
    guard let state = queryItems.first(where: { $0.name == "state" })?.value, !state.isEmpty else {
      return .failure(.invalidData("Missing or empty state in authorization request"))
    }

    let redirectUri = queryItems.first(where: { $0.name == "redirect_uri" })?.value ?? ""
    let responseUri = queryItems.first(where: { $0.name == "response_uri" })?.value
    let responseType = queryItems.first(where: { $0.name == "response_type" })?.value ?? "vp_token"

    // OID4VP 1.0 doesn't fix a single default for response_mode. OAuth2's
    // default is `fragment`; the OID4VP profile introduced `direct_post`
    // when `response_uri` is present. We pick the mode that matches the
    // URI field actually supplied when the verifier didn't state one.
    let explicitResponseMode = queryItems.first(where: { $0.name == "response_mode" })?.value
    let responseMode: String
    if let mode = explicitResponseMode, !mode.isEmpty {
      responseMode = mode
    } else if let uri = responseUri, !uri.isEmpty {
      responseMode = "direct_post"
    } else {
      responseMode = "fragment"
    }

    let lowered = responseMode.lowercased()
    let isDirectPost = lowered.hasPrefix("direct_post")

    // §6.2 — direct_post* MUST carry response_uri and MUST NOT include
    // redirect_uri. Other modes MUST use redirect_uri; response_uri is
    // only defined for the direct_post family.
    if isDirectPost {
      if responseUri == nil || responseUri?.isEmpty == true {
        return .failure(.invalidData("direct_post response_mode requires response_uri"))
      }
      if !redirectUri.isEmpty {
        return .failure(.invalidData("response_uri and redirect_uri MUST NOT both be present for direct_post"))
      }
    } else {
      if redirectUri.isEmpty {
        return .failure(.invalidData("Missing redirect_uri for response_mode \(responseMode)"))
      }
      if responseUri != nil {
        return .failure(.invalidData("response_uri is only valid for direct_post response modes"))
      }
    }

    let dcqlQueryJSON = queryItems.first(where: { $0.name == "dcql_query" })?.value

    // PD is optional — OID4VP 1.0 lets verifiers use DCQL OR a scope-based
    // pre-registered query instead. SIOPv2 id_token requests never carry
    // a PD. Use the default descriptor so downstream UI still has a name
    // to show, but don't fail the parse for missing PD.
    let presentationDefinition: PresentationRequest.PresentationDefinition
    if let parsed = Self.parsePresentationDefinition(fromTopLevel: queryItems) {
      presentationDefinition = parsed
    } else if let parsed = Self.parsePresentationDefinition(fromClaims: queryItems) {
      presentationDefinition = parsed
    } else if dcqlQueryJSON == nil,
              responseType.contains("vp_token"),
              queryItems.first(where: { $0.name == "scope" })?.value == nil {
      // OID4VP vp_token requests without PD/DCQL/scope are non-compliant,
      // but historical verifiers have shipped this — we fall back to a
      // default descriptor rather than hard-failing.
      presentationDefinition = Self.defaultBusinessCardDefinition()
    } else {
      presentationDefinition = Self.defaultBusinessCardDefinition()
    }

    return .success(
      PresentationRequest(
        id: UUID().uuidString,
        state: state,
        nonce: nonce,
        clientId: clientId,
        redirectUri: redirectUri,
        responseUri: responseUri,
        responseType: responseType,
        responseMode: responseMode,
        presentationDefinition: presentationDefinition,
        dcqlQueryJSON: dcqlQueryJSON
      )
    )
  }

  private func resolveRequestUri(_ remote: URL, fallbackComponents: URLComponents) async -> CardResult<PresentationRequest> {
    // OID4VP 1.0 §5.10 — the verifier may advertise `request_uri_method=post`
    // to signal they expect a POST fetch (optionally with wallet_metadata
    // in the body). Default is GET. We currently don't send wallet_metadata
    // so the POST body is empty, which matches the spec's minimum contract.
    let method = fallbackComponents.queryItems?
      .first(where: { $0.name == "request_uri_method" })?.value?.lowercased() ?? "get"

    var urlRequest = URLRequest(url: remote)
    if method == "post" {
      urlRequest.httpMethod = "POST"
      urlRequest.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
      urlRequest.httpBody = Data()
    }

    do {
      let (data, response) = try await session.data(for: urlRequest)
      guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
        let code = (response as? HTTPURLResponse)?.statusCode ?? -1
        return .failure(.networkError("request_uri fetch returned HTTP \(code)"))
      }
      // Cap inbound Request Object size — even a JWT-shaped Request Object
      // is small (low KB). 256 KB is generous enough for legitimate verifiers
      // while preventing memory-pressure attacks from a hostile request_uri
      // host that streams garbage.
      guard data.count <= Self.maxOIDCResponseBytes else {
        return .failure(.networkError("request_uri payload exceeds size limit"))
      }
      let body = String(data: data, encoding: .utf8) ?? ""
      let trimmedBody = body.trimmingCharacters(in: .whitespacesAndNewlines)
      // A JWT-shaped body MUST verify; we do not fall back to JSON parsing
      // when the response looks like a JWT, because that would let an
      // attacker who controls a JWT-shaped string bypass signature checks.
      if trimmedBody.split(separator: ".").count == 3 {
        return resolveRequestJWT(trimmedBody, fallbackComponents: fallbackComponents)
      }
      if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        return parseRequest(components: componentsFromRequestObject(json, fallback: fallbackComponents))
      }
      return .failure(.invalidData("request_uri payload was neither a JWT nor a JSON request object"))
    } catch {
      return .failure(.networkError("Failed to fetch request_uri: \(error.localizedDescription)"))
    }
  }

  private func resolveRequestJWT(_ token: String, fallbackComponents: URLComponents) -> CardResult<PresentationRequest> {
    let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
    let segments = trimmed.split(separator: ".")
    guard segments.count == 3,
          let headerData = Data(base64URLEncoded: String(segments[0])),
          let payloadData = Data(base64URLEncoded: String(segments[1])),
          let header = try? JSONSerialization.jsonObject(with: headerData) as? [String: Any],
          let json = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any]
    else {
      return .failure(.invalidData("Request Object JWT is malformed"))
    }
    // OID4VP 1.0 §5.10 — the Request Object is signed by the verifier
    // (`iss`/`client_id` claim). Resolve to a public key via did:key when
    // possible, else via the locally-trusted issuer anchor store, and
    // verify ES256 before treating any of the embedded values as trusted.
    let issuer = (json["iss"] as? String) ?? (json["client_id"] as? String) ?? ""
    let keyId = header["kid"] as? String
    guard !issuer.isEmpty else {
      return .failure(.invalidData("Request Object JWT missing iss/client_id"))
    }
    let resolvedKey: PublicKeyJWK
    if let didKey = DIDKeyResolver.resolveP256JWK(from: issuer) {
      resolvedKey = didKey
    } else if let anchor = IssuerTrustAnchorStore.shared.trustedJWK(for: issuer, keyId: keyId) {
      resolvedKey = anchor
    } else {
      return .failure(.invalidData("Request Object issuer is untrusted: \(issuer)"))
    }
    do {
      let publicKey = try resolvedKey.toP256PublicKey()
      let signingInput = Data("\(segments[0]).\(segments[1])".utf8)
      guard let signatureData = Data(base64URLEncoded: String(segments[2])) else {
        return .failure(.invalidData("Request Object JWT has invalid signature encoding"))
      }
      let signature =
        (try? P256.Signing.ECDSASignature(rawRepresentation: signatureData))
        ?? (try? P256.Signing.ECDSASignature(derRepresentation: signatureData))
      guard let signature, publicKey.isValidSignature(signature, for: signingInput) else {
        return .failure(.invalidData("Request Object JWT signature verification failed"))
      }
    } catch {
      return .failure(.cryptographicError("Request Object verification error: \(error.localizedDescription)"))
    }
    return parseRequest(components: componentsFromRequestObject(json, fallback: fallbackComponents))
  }

  private func componentsFromRequestObject(
    _ json: [String: Any],
    fallback: URLComponents
  ) -> URLComponents {
    var components = fallback
    var items: [URLQueryItem] = []

    func flatten(_ value: Any) -> String? {
      if let s = value as? String { return s }
      if let data = try? JSONSerialization.data(withJSONObject: value) {
        return String(data: data, encoding: .utf8)
      }
      return nil
    }

    let passthroughKeys = [
      "client_id", "nonce", "state", "redirect_uri", "response_uri",
      "response_type", "response_mode", "scope", "dcql_query",
      "presentation_definition", "claims", "client_id_scheme",
    ]
    for key in passthroughKeys {
      if let value = json[key], let string = flatten(value) {
        items.append(URLQueryItem(name: key, value: string))
      }
    }

    components.queryItems = items
    return components
  }

  // MARK: - Nonce replay suppression

  /// Records a nonce (from a received vp_token) and returns true if it is
  /// fresh, false if it has been seen within the replay window.
  ///
  /// Both the in-memory cache and the Keychain-backed `OIDCNonceStore` are
  /// updated so a process restart cannot replay a previously-seen nonce.
  @discardableResult
  func registerNonce(_ nonce: String, ttl: TimeInterval = 3600) -> Bool {
    guard !nonce.isEmpty else { return true }

    nonceLock.lock()
    defer { nonceLock.unlock() }

    let now = Date()
    // Opportunistic cleanup of expired entries.
    seenNonces = seenNonces.filter { now.timeIntervalSince($0.value) < ttl }

    if seenNonces[nonce] != nil {
      Self.logger.warning("Replay detected: nonce already used")
      return false
    }
    seenNonces[nonce] = now
    nonceStore.save(seenNonces, ttl: ttl, now: now)
    return true
  }

}
