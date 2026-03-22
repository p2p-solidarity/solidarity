//
//  OIDCService.swift
//  airmeishi
//
//  Service for generating and parsing OIDC Authentication Requests (SIOPv2 / OIDC4VP).
//

import Foundation
import UIKit

/// Handles OIDC Authentication Request generation and parsing.
final class OIDCService: ObservableObject {
  static let shared = OIDCService()

  struct PresentationRequest: Equatable {
    let id: String
    let state: String
    let nonce: String
    let clientId: String
    let redirectUri: String
    let responseType: String
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

  init(didService: DIDService = DIDService()) {
    self.didService = didService
  }

  func attachIdentityCoordinator(_ coordinator: IdentityCoordinator) {
    self.coordinator = coordinator
  }

  /// Generates an OIDC Authentication Request URI.
  /// - Parameters:
  ///   - redirectUri: The URI where the response should be sent.
  ///   - claims: Dictionary specifying the requested claims (e.g. for VCs).
  /// - Returns: A `CardResult` containing the generated URL.
  func generateRequest(
    redirectUri: String = "\(AppBranding.currentScheme)://oidc-callback",
    claims: [String: Any]? = nil,
    relyingPartyDomain: String? = nil
  ) -> CardResult<URL> {
    let rpDomain = relyingPartyDomain ?? URL(string: redirectUri)?.host
    let descriptorResult = didService.currentDescriptor(for: rpDomain)
    guard case .success(let descriptor) = descriptorResult else {
      return .failure(.keyManagementError("No active DID found for OIDC request"))
    }
    let clientId = descriptor.did
    let nonce = UUID().uuidString
    let state = UUID().uuidString

    // 2. Construct URL components
    var components = URLComponents()
    components.scheme = "openid"
    components.host = ""  // openid://

    // 3. Build query items
    var queryItems = [
      URLQueryItem(name: "scope", value: "openid"),
      URLQueryItem(name: "response_type", value: "vp_token"),
      URLQueryItem(name: "client_id", value: clientId),
      URLQueryItem(name: "redirect_uri", value: redirectUri),
      URLQueryItem(name: "nonce", value: nonce),
      URLQueryItem(name: "state", value: state),
    ]

    // 4. Add claims if present
    if let claims = claims {
      do {
        let claimsData = try JSONSerialization.data(withJSONObject: claims, options: [.sortedKeys])
        if let claimsString = String(data: claimsData, encoding: .utf8) {
          queryItems.append(URLQueryItem(name: "claims", value: claimsString))
        }
      } catch {
        print("[OIDCService] Failed to serialize claims: \(error)")
      }
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

    // Scale up the image
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

    let nonce = UUID().uuidString
    let state = UUID().uuidString
    let redirectUri = "\(AppBranding.currentScheme)://oidc-callback"

    let presentationDefinition = PresentationRequest.PresentationDefinition(
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

    switch generateRequest(
      redirectUri: redirectUri,
      claims: [
        "vp_token": [
          "presentation_definition": [
            "id": presentationDefinition.id,
            "input_descriptors": presentationDefinition.inputDescriptors.map { [
              "id": $0.id,
              "name": $0.name ?? "",
              "purpose": $0.purpose ?? "",
            ] }
          ]
        ]
      ]
    ) {
    case .success(let url):
      let request = PresentationRequest(
        id: UUID().uuidString,
        state: state,
        nonce: nonce,
        clientId: descriptor.did,
        redirectUri: redirectUri,
        responseType: "vp_token",
        presentationDefinition: presentationDefinition
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

    let clientId = queryItems.first(where: { $0.name == "client_id" })?.value ?? ""
    let nonce = queryItems.first(where: { $0.name == "nonce" })?.value ?? ""
    let state = queryItems.first(where: { $0.name == "state" })?.value ?? ""
    let redirectUri = queryItems.first(where: { $0.name == "redirect_uri" })?.value ?? ""
    let responseType = queryItems.first(where: { $0.name == "response_type" })?.value ?? "vp_token"

    // Parse presentation_definition from query if present
    let presentationDefinition: PresentationRequest.PresentationDefinition
    if let pdString = queryItems.first(where: { $0.name == "presentation_definition" })?.value,
       let pdData = pdString.data(using: .utf8),
       let pdJson = try? JSONSerialization.jsonObject(with: pdData) as? [String: Any]
    {
      let pdId = pdJson["id"] as? String ?? "parsed-request"
      var descriptors: [PresentationRequest.PresentationDefinition.InputDescriptor] = []
      if let inputDescs = pdJson["input_descriptors"] as? [[String: Any]] {
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
      presentationDefinition = PresentationRequest.PresentationDefinition(
        id: pdId, inputDescriptors: descriptors
      )
    } else {
      // Fallback: no presentation_definition in URL — assume business card exchange
      presentationDefinition = PresentationRequest.PresentationDefinition(
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

    return .success(
      PresentationRequest(
        id: UUID().uuidString,
        state: state,
        nonce: nonce,
        clientId: clientId,
        redirectUri: redirectUri,
        responseType: responseType,
        presentationDefinition: presentationDefinition
      )
    )
  }

  func handleResponse(url: URL, vcService: VCService) -> CardResult<VCService.ImportedCredential> {
    // Extract vp_token from response URL and import the credential
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          let vpToken = components.queryItems?.first(where: { $0.name == "vp_token" })?.value
    else {
      return .failure(.invalidData("No vp_token found in response URL"))
    }
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
  /// For HTTPS URIs, performs a form POST. For custom schemes, opens via UIApplication.
  func submitVpToken(token: String, redirectURI: String, state: String?) async -> CardResult<Void> {
    guard let components = URLComponents(string: redirectURI) else {
      return .failure(.invalidData("Invalid redirect URI"))
    }

    let scheme = components.scheme?.lowercased() ?? ""

    // HTTPS → form POST to verifier endpoint (params in body only)
    if scheme == "https" || scheme == "http" {
      guard let postURL = components.url else {
        return .failure(.invalidData("Failed to build POST URL"))
      }

      // Build URL-encoded body via URLComponents for correct percent-encoding
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
}
