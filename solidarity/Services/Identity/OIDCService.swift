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

  struct PresentationRequest: Equatable {
    let id: String
    let state: String
    let nonce: String
    let clientId: String
    let redirectUri: String
    let responseType: String
    let responseMode: String
    let presentationDefinition: PresentationDefinition

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
  private var seenNonces: [String: Date] = [:]

  init(didService: DIDService = DIDService()) {
    self.didService = didService
  }

  func attachIdentityCoordinator(_ coordinator: IdentityCoordinator) {
    self.coordinator = coordinator
  }

  /// Generates an OID4VP Authorization Request URL.
  ///
  /// `clientId` is the *verifier* identifier — for a self-hosted verifier it's
  /// the holder's DID when *we* are acting as verifier asking another device
  /// to present, but for a standard SIOP/OID4VP interaction the client_id is
  /// the relying-party identifier, NOT the holder's key.
  ///
  /// - Parameters:
  ///   - redirectUri: The URI where the verifier response should be posted.
  ///   - presentationDefinition: The DIF Presentation Exchange definition to
  ///     embed directly (preferred — avoids relying on the `claims` parameter
  ///     which has inconsistent deployment).
  ///   - responseMode: `direct_post` (default, current OID4VP 1.0) or
  ///     `fragment`. `direct_post` means the holder POSTs vp_token+state to
  ///     `redirect_uri` form-encoded; `fragment` legacy encodes them in the
  ///     URL fragment.
  func generateRequest(
    redirectUri: String = "\(AppBranding.currentScheme)://oidc-callback",
    presentationDefinition: PresentationRequest.PresentationDefinition? = nil,
    responseMode: String = "direct_post",
    relyingPartyDomain: String? = nil
  ) -> CardResult<URL> {
    let rpDomain = relyingPartyDomain ?? URL(string: redirectUri)?.host
    let descriptorResult = didService.currentDescriptor(for: rpDomain)
    guard case .success(let descriptor) = descriptorResult else {
      return .failure(.keyManagementError("No active DID found for OIDC request"))
    }
    // When we generate a request, WE are the verifier. client_id is the
    // verifier DID (ourselves in this flow), not the holder. The holder
    // identity is asserted in the returned vp_token's `iss` field.
    let clientId = descriptor.did
    let nonce = UUID().uuidString
    let state = UUID().uuidString

    var components = URLComponents()
    components.scheme = "openid4vp"
    components.host = "authorize"

    var queryItems: [URLQueryItem] = [
      URLQueryItem(name: "client_id", value: clientId),
      URLQueryItem(name: "redirect_uri", value: redirectUri),
      URLQueryItem(name: "response_type", value: "vp_token"),
      URLQueryItem(name: "response_mode", value: responseMode),
      URLQueryItem(name: "nonce", value: nonce),
      URLQueryItem(name: "state", value: state),
    ]

    // Embed presentation_definition as a top-level query parameter — this is
    // what OID4VP parsers look for. The old `claims.vp_token` placement is
    // SIOPv2-only and is not interoperable with OID4VP verifiers.
    let definition = presentationDefinition ?? Self.defaultBusinessCardDefinition()
    if let pdJSON = try? Self.presentationDefinitionJSON(definition),
       let pdString = String(data: pdJSON, encoding: .utf8) {
      queryItems.append(URLQueryItem(name: "presentation_definition", value: pdString))
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
    let redirectUri = "\(AppBranding.currentScheme)://oidc-callback"

    switch generateRequest(redirectUri: redirectUri, presentationDefinition: definition) {
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
        redirectUri: redirectUri,
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
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      let queryItems = components.queryItems
    else {
      return .failure(.invalidData("Invalid OIDC request URL"))
    }

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
    guard let redirectUri = queryItems.first(where: { $0.name == "redirect_uri" })?.value,
      !redirectUri.isEmpty
    else {
      return .failure(.invalidData("Missing or empty redirect_uri in authorization request"))
    }
    let responseType = queryItems.first(where: { $0.name == "response_type" })?.value ?? "vp_token"
    let responseMode = queryItems.first(where: { $0.name == "response_mode" })?.value ?? "direct_post"

    // Preferred: top-level presentation_definition (OID4VP 1.0).
    // Fallback: legacy SIOPv2 claims.vp_token.presentation_definition.
    let presentationDefinition: PresentationRequest.PresentationDefinition
    if let parsed = Self.parsePresentationDefinition(fromTopLevel: queryItems) {
      presentationDefinition = parsed
    } else if let parsed = Self.parsePresentationDefinition(fromClaims: queryItems) {
      presentationDefinition = parsed
    } else {
      return .failure(.invalidData("Missing presentation_definition in authorization request"))
    }

    return .success(
      PresentationRequest(
        id: UUID().uuidString,
        state: state,
        nonce: nonce,
        clientId: clientId,
        redirectUri: redirectUri,
        responseType: responseType,
        responseMode: responseMode,
        presentationDefinition: presentationDefinition
      )
    )
  }

  func handleResponse(url: URL, vcService: VCService) -> CardResult<VCService.ImportedCredential> {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
      return .failure(.invalidData("No query items in response URL"))
    }

    // vp_token can appear in the query string (fragment mode) or be
    // URL-encoded as a top-level param. We accept both.
    let queryItems = components.queryItems ?? []
    guard let vpToken = queryItems.first(where: { $0.name == "vp_token" })?.value else {
      return .failure(.invalidData("No vp_token found in response URL"))
    }

    // A VP may wrap one or many VCs. Unwrap to individual VC JWTs before
    // importing; importing the raw VP as a credential loses the signer's
    // holder/issuer binding.
    if let jwt = Self.extractFirstCredentialJWT(fromVPToken: vpToken) {
      return vcService.importPresentedCredential(jwt: jwt)
    }

    // Fallback: treat the token itself as a VC JWT (legacy flows).
    return vcService.importPresentedCredential(jwt: vpToken)
  }

  func buildResponseURL(for request: PresentationRequest, vpToken: String) -> CardResult<URL> {
    guard var components = URLComponents(string: request.redirectUri) else {
      return .failure(.invalidData("Invalid redirect URI"))
    }

    var queryItems = components.queryItems ?? []
    queryItems.append(URLQueryItem(name: "state", value: request.state))
    queryItems.append(URLQueryItem(name: "vp_token", value: vpToken))

    components.queryItems = queryItems

    guard let url = components.url else {
      return .failure(.invalidData("Failed to build response URL"))
    }

    return .success(url)
  }

  // MARK: - VP Token Submission

  /// Submits a vp_token to the verifier's redirect_uri.
  /// - For HTTPS URIs, performs a form POST (OID4VP direct_post mode).
  /// - For custom schemes, opens via UIApplication (fragment mode).
  func submitVpToken(token: String, redirectURI: String, state: String?) async -> CardResult<Void> {
    guard let components = URLComponents(string: redirectURI) else {
      return .failure(.invalidData("Invalid redirect URI"))
    }

    let scheme = components.scheme?.lowercased() ?? ""

    if scheme == "https" || scheme == "http" {
      guard let postURL = components.url else {
        return .failure(.invalidData("Failed to build POST URL"))
      }

      var bodyComponents = URLComponents()
      var bodyItems = [URLQueryItem(name: "vp_token", value: token)]
      if let state { bodyItems.append(URLQueryItem(name: "state", value: state)) }
      bodyComponents.queryItems = bodyItems

      guard let bodyString = bodyComponents.percentEncodedQuery else {
        return .failure(.invalidData("Failed to encode POST body"))
      }

      do {
        var request = URLRequest(url: postURL)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = bodyString.data(using: .utf8)

        let (_, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
          let code = (response as? HTTPURLResponse)?.statusCode ?? -1
          return .failure(.networkError("Verifier returned HTTP \(code)"))
        }
        return .success(())
      } catch {
        return .failure(.networkError("Failed to submit vp_token: \(error.localizedDescription)"))
      }
    }

    // Custom scheme → append params to URL and open via UIApplication
    var redirectComponents = components
    var queryItems = redirectComponents.queryItems ?? []
    queryItems.append(URLQueryItem(name: "vp_token", value: token))
    if let state { queryItems.append(URLQueryItem(name: "state", value: state)) }
    redirectComponents.queryItems = queryItems

    guard let redirectURL = redirectComponents.url else {
      return .failure(.invalidData("Failed to build redirect URL"))
    }

    let canOpen = await MainActor.run {
      UIApplication.shared.canOpenURL(redirectURL)
    }
    guard canOpen else {
      return .failure(.networkError("Unable to open redirect URI: \(redirectURI)"))
    }
    await MainActor.run {
      UIApplication.shared.open(redirectURL)
    }
    return .success(())
  }

  /// Extracts the verifier domain from a request payload string.
  static func verifierDomain(from payload: String) -> String? {
    guard let url = URL(string: payload),
          let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          let redirectUri = components.queryItems?.first(where: { $0.name == "redirect_uri" })?.value
    else {
      return URL(string: payload)?.host
    }
    return URL(string: redirectUri)?.host
  }

  // MARK: - Nonce replay suppression

  /// Records a nonce (from a received vp_token) and returns true if it is
  /// fresh, false if it has been seen within the replay window.
  @discardableResult
  func registerNonce(_ nonce: String, ttl: TimeInterval = 3600) -> Bool {
    guard !nonce.isEmpty else { return true }

    nonceLock.lock()
    defer { nonceLock.unlock() }

    let now = Date()
    // Opportunistic cleanup
    seenNonces = seenNonces.filter { now.timeIntervalSince($0.value) < ttl }

    if seenNonces[nonce] != nil {
      Self.logger.warning("Replay detected: nonce=\(nonce, privacy: .public) already used")
      return false
    }
    seenNonces[nonce] = now
    return true
  }

  // MARK: - Private helpers

  private static func defaultBusinessCardDefinition() -> PresentationRequest.PresentationDefinition {
    PresentationRequest.PresentationDefinition(
      id: "business-card-request",
      inputDescriptors: [
        PresentationRequest.PresentationDefinition.InputDescriptor(
          id: "business-card",
          name: "Business Card",
          purpose: "Exchange contact info",
          format: nil,
          constraints: nil
        )
      ]
    )
  }

  private static func presentationDefinitionJSON(
    _ definition: PresentationRequest.PresentationDefinition
  ) throws -> Data {
    var descriptors: [[String: Any]] = []
    for d in definition.inputDescriptors {
      var descriptor: [String: Any] = ["id": d.id]
      if let name = d.name { descriptor["name"] = name }
      if let purpose = d.purpose { descriptor["purpose"] = purpose }
      if let format = d.format { descriptor["format"] = format }
      if let constraints = d.constraints { descriptor["constraints"] = constraints }
      descriptors.append(descriptor)
    }
    let object: [String: Any] = [
      "id": definition.id,
      "input_descriptors": descriptors,
    ]
    return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
  }

  private static func parsePresentationDefinition(
    fromTopLevel items: [URLQueryItem]
  ) -> PresentationRequest.PresentationDefinition? {
    guard let pdString = items.first(where: { $0.name == "presentation_definition" })?.value,
          let pdData = pdString.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: pdData) as? [String: Any]
    else { return nil }
    return Self.decodePresentationDefinition(from: json)
  }

  private static func parsePresentationDefinition(
    fromClaims items: [URLQueryItem]
  ) -> PresentationRequest.PresentationDefinition? {
    guard let claimsString = items.first(where: { $0.name == "claims" })?.value,
          let claimsData = claimsString.data(using: .utf8),
          let claims = try? JSONSerialization.jsonObject(with: claimsData) as? [String: Any],
          let vpToken = claims["vp_token"] as? [String: Any],
          let pd = vpToken["presentation_definition"] as? [String: Any]
    else { return nil }
    return Self.decodePresentationDefinition(from: pd)
  }

  private static func decodePresentationDefinition(
    from json: [String: Any]
  ) -> PresentationRequest.PresentationDefinition {
    let pdId = json["id"] as? String ?? "parsed-request"
    var descriptors: [PresentationRequest.PresentationDefinition.InputDescriptor] = []
    if let inputDescs = json["input_descriptors"] as? [[String: Any]] {
      descriptors = inputDescs.map { desc in
        PresentationRequest.PresentationDefinition.InputDescriptor(
          id: desc["id"] as? String ?? UUID().uuidString,
          name: desc["name"] as? String,
          purpose: desc["purpose"] as? String,
          format: desc["format"] as? [String: Any],
          constraints: desc["constraints"] as? [String: Any]
        )
      }
    }
    return PresentationRequest.PresentationDefinition(id: pdId, inputDescriptors: descriptors)
  }

  /// Attempts to extract the first embedded VC JWT from a vp_token.
  /// Supports:
  ///   - Signed VP JWT (payload.vp.verifiableCredential[0] is a VC JWT)
  ///   - Raw JSON VP envelope ({type: [VerifiablePresentation], verifiableCredential: [...]})
  ///   - Array of strings
  /// Returns nil when the token itself is already a compact JWT VC.
  private static func extractFirstCredentialJWT(fromVPToken token: String) -> String? {
    // Signed VP (JWT) case — inspect payload.vp.verifiableCredential[0]
    let segments = token.split(separator: ".")
    if segments.count == 3,
       let payloadData = Data(base64URLEncoded: String(segments[1])),
       let payload = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any] {
      if let vp = payload["vp"] as? [String: Any],
         let creds = vp["verifiableCredential"] as? [Any],
         let first = creds.first {
        if let s = first as? String { return s }
        if let obj = first as? [String: Any],
           let s = try? String(data: JSONSerialization.data(withJSONObject: obj), encoding: .utf8) {
          return s
        }
      }
      // A plain VC JWT (no vp wrapper) — return the token as-is.
      if payload["vc"] != nil { return token }
    }

    // Raw JSON VP envelope (unsigned / legacy)
    if let data = token.data(using: .utf8),
       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
       let types = json["type"] as? [String], types.contains("VerifiablePresentation"),
       let creds = json["verifiableCredential"] as? [Any],
       let first = creds.first as? String {
      return first
    }

    return nil
  }
}
