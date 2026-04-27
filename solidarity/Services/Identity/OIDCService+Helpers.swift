//
//  OIDCService+Helpers.swift
//  solidarity
//
//  Static helpers split out of OIDCService.swift to keep that file under
//  the SwiftLint file_length cap. Covers:
//    - Verifier domain / callback URI canonicalisation
//    - Presentation definition encode / decode / parse
//    - vp_token unwrap to embedded VC JWT
//

import Foundation

extension OIDCService {

  // MARK: - Verifier identification

  /// Extracts the verifier domain from a request payload string.
  static func verifierDomain(from payload: String) -> String? {
    guard let url = URL(string: payload),
          let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    else {
      return URL(string: payload)?.host
    }
    let items = components.queryItems ?? []
    if let responseUri = items.first(where: { $0.name == "response_uri" })?.value,
       let host = URL(string: responseUri)?.host {
      return host
    }
    if let redirectUri = items.first(where: { $0.name == "redirect_uri" })?.value,
       let host = URL(string: redirectUri)?.host {
      return host
    }
    return URL(string: payload)?.host
  }

  // MARK: - Callback URI

  /// Canonical callback URI used by the app when acting as a holder.
  /// Host is `oidc-callback` so URL handlers can match with a simple
  /// `host == "oidc-callback"` check.
  static func defaultCallbackURI() -> String {
    "\(AppBranding.currentScheme)://oidc-callback"
  }

  static func isCallbackHost(_ host: String?) -> Bool {
    switch host?.lowercased() {
    case "oidc-callback", "oidc":
      return true
    default:
      return false
    }
  }

  // MARK: - Presentation definition

  static func defaultBusinessCardDefinition() -> PresentationRequest.PresentationDefinition {
    PresentationRequest.PresentationDefinition(
      id: "default-request",
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

  static func presentationDefinitionJSON(
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

  static func parsePresentationDefinition(
    fromTopLevel items: [URLQueryItem]
  ) -> PresentationRequest.PresentationDefinition? {
    guard let pdString = items.first(where: { $0.name == "presentation_definition" })?.value,
          let pdData = pdString.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: pdData) as? [String: Any]
    else { return nil }
    return Self.decodePresentationDefinition(from: json)
  }

  static func parsePresentationDefinition(
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

  static func decodePresentationDefinition(
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

  // MARK: - vp_token unwrap

  /// Attempts to extract the first embedded VC JWT from a vp_token.
  /// Supports:
  ///   - Signed VP JWT (payload.vp.verifiableCredential[0] is a VC JWT)
  ///   - Raw JSON VP envelope ({type: [VerifiablePresentation], verifiableCredential: [...]})
  ///   - Array of strings
  /// Returns nil when the token itself is already a compact JWT VC.
  static func extractFirstCredentialJWT(fromVPToken token: String) -> String? {
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
