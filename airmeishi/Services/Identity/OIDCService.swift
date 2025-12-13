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
    let presentationDefinition: PresentationDefinition

    struct PresentationDefinition: Equatable {
      let id: String
      let inputDescriptors: [InputDescriptor]

      struct InputDescriptor: Equatable {
        let id: String
        let name: String?
        let purpose: String?
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
    redirectUri: String = "airmeishi://oidc-callback",
    claims: [String: Any]? = nil
  ) -> CardResult<URL> {
    // 1. Get the current DID to use as client_id
    let descriptorResult = didService.currentDescriptor()
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
      URLQueryItem(name: "response_type", value: "id_token"),  // For SIOPv2. Add "vp_token" for OIDC4VP if needed.
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
    // Default claims for business card exchange
    let claims: [String: Any] = [
      "id_token": [
        "verifiable_credentials": [
          "essential": true,
          "purpose": "To exchange business cards",
          "credential_type": "BusinessCardCredential",
        ]
      ]
    ]

    switch generateRequest(claims: claims) {
    case .success(let url):
      // In a real implementation, we would register this request with the coordinator
      // to track state. For now, we just return the QR string.
      let request = PresentationRequest(
        id: UUID().uuidString,
        state: UUID().uuidString,  // Should match state in URL
        nonce: UUID().uuidString,  // Should match nonce in URL
        clientId: "did:example:123",  // Placeholder
        redirectUri: "airmeishi://oidc-callback",
        presentationDefinition: PresentationRequest.PresentationDefinition(
          id: "business-card-request",
          inputDescriptors: []
        )
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

    // Simplified parsing for compatibility
    return .success(
      PresentationRequest(
        id: UUID().uuidString,
        state: state,
        nonce: nonce,
        clientId: clientId,
        redirectUri: redirectUri,
        presentationDefinition: PresentationRequest.PresentationDefinition(
          id: "business-card-request",
          inputDescriptors: [
            PresentationRequest.PresentationDefinition.InputDescriptor(
              id: "business-card",
              name: "Business Card",
              purpose: "Exchange contact info"
            )
          ]
        )
      )
    )
  }

  func handleResponse(url: URL, vcService: VCService) -> CardResult<VCService.ImportedCredential> {
    // Mock implementation for handling OIDC response
    // In a real scenario, this would exchange the code for tokens or parse the id_token/vp_token directly
    return .failure(.configurationError("OIDC response handling not fully implemented"))
  }

  func buildResponseURL(for request: PresentationRequest, vpToken: String) -> CardResult<URL> {
    guard var components = URLComponents(string: request.redirectUri) else {
      return .failure(.invalidData("Invalid redirect URI"))
    }

    // Construct the response parameters (id_token or vp_token)
    // For SIOPv2, we typically return an id_token. For OIDC4VP, a vp_token.
    // Simplified implementation:

    var queryItems = components.queryItems ?? []
    queryItems.append(URLQueryItem(name: "state", value: request.state))
    queryItems.append(URLQueryItem(name: "id_token", value: vpToken))  // Using id_token for compatibility

    components.queryItems = queryItems

    guard let url = components.url else {
      return .failure(.invalidData("Failed to build response URL"))
    }

    return .success(url)
  }
}
