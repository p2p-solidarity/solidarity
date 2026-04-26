//
//  OIDCService+Submit.swift
//  solidarity
//
//  vp_token submission helpers split out of OIDCService.swift to keep
//  that file under the SwiftLint file_length cap. Covers the holder's
//  outbound side of the OID4VP exchange:
//    - Inbound response URL parsing (`handleResponse`)
//    - Building a redirect URL with the token attached
//    - Posting / opening the response in the requested response_mode
//

import Foundation
import UIKit

extension OIDCService {

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
    let target = request.effectiveResponseTarget
    guard var components = URLComponents(string: target) else {
      return .failure(.invalidData("Invalid response target URI"))
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

  /// Submits a vp_token to the verifier's response target.
  /// - `direct_post*` modes: HTTP POST form-encoded to response_uri.
  /// - Fragment / query modes: open the redirect URL via UIApplication.
  func submitVpToken(
    token: String,
    target: String,
    state: String?,
    responseMode: String = "direct_post"
  ) async -> CardResult<Void> {
    guard let components = URLComponents(string: target) else {
      return .failure(.invalidData("Invalid response target URI"))
    }

    let scheme = components.scheme?.lowercased() ?? ""
    let isDirectPost = responseMode.lowercased().hasPrefix("direct_post")

    if scheme == "http" {
      return .failure(.invalidData("vp_token submission requires https"))
    }

    if scheme == "https" {
      guard let postURL = components.url else {
        return .failure(.invalidData("Failed to build POST URL"))
      }

      if !isDirectPost {
        // Non-direct_post HTTPS redirect: append params & open externally.
        var redirectComponents = components
        var queryItems = redirectComponents.queryItems ?? []
        queryItems.append(URLQueryItem(name: "vp_token", value: token))
        if let state { queryItems.append(URLQueryItem(name: "state", value: state)) }
        redirectComponents.queryItems = queryItems
        guard let redirectURL = redirectComponents.url else {
          return .failure(.invalidData("Failed to build redirect URL"))
        }
        let canOpen = await MainActor.run { UIApplication.shared.canOpenURL(redirectURL) }
        guard canOpen else {
          return .failure(.networkError("Unable to open redirect URI: \(target)"))
        }
        await MainActor.run { UIApplication.shared.open(redirectURL) }
        return .success(())
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

        let (_, response) = try await session.data(for: request)
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
      return .failure(.networkError("Unable to open redirect URI: \(target)"))
    }
    await MainActor.run {
      UIApplication.shared.open(redirectURL)
    }
    return .success(())
  }

  /// Back-compat wrapper for callers that only know the legacy redirect_uri
  /// field name. Routes to the response_uri-aware `submitVpToken`.
  func submitVpToken(token: String, redirectURI: String, state: String?) async -> CardResult<Void> {
    await submitVpToken(token: token, target: redirectURI, state: state, responseMode: "direct_post")
  }
}
