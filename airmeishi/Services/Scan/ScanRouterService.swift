import Foundation

enum ScanRoute: Equatable {
  case businessCard
  case oid4vpRequest(String)
  case vpToken(String)
  case credentialOffer(String)
  case siopRequest(String)
  case unknown(String)
}

final class ScanRouterService {
  static let shared = ScanRouterService()
  private init() {}

  func route(for payload: String) -> ScanRoute {
    let trimmed = payload.trimmingCharacters(in: .whitespacesAndNewlines)

    if trimmed.hasPrefix("openid4vp://") || trimmed.hasPrefix("OID4VP://") {
      return .oid4vpRequest(trimmed)
    }

    if trimmed.hasPrefix("openid-credential-offer://") {
      return .credentialOffer(trimmed)
    }

    if trimmed.hasPrefix("openid-connect://") || trimmed.hasPrefix("openid://") {
      return .siopRequest(trimmed)
    }

    if isCompactJWT(trimmed) {
      return .vpToken(trimmed)
    }

    return .unknown(trimmed)
  }

  private func isCompactJWT(_ value: String) -> Bool {
    let segments = value.split(separator: ".")
    return segments.count == 3 && segments.allSatisfy { !$0.isEmpty }
  }
}
