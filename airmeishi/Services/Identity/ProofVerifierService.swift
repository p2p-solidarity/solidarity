import Foundation

struct VpTokenVerificationResult: Equatable {
  let isValid: Bool
  let status: VerificationStatus
  let title: String
  let reason: String
  let details: [String]
}

final class ProofVerifierService {
  static let shared = ProofVerifierService()
  private init() {}

  func verifyVpToken(_ token: String) -> VpTokenVerificationResult {
    let segments = token.split(separator: ".")
    guard segments.count == 3 else {
      return VpTokenVerificationResult(
        isValid: false,
        status: .failed,
        title: "Invalid vp_token",
        reason: "Token does not have 3 JWT segments.",
        details: ["Malformed compact JWT"]
      )
    }

    guard let payloadData = Data(base64URLEncoded: String(segments[1])),
      let payload = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any]
    else {
      return VpTokenVerificationResult(
        isValid: false,
        status: .failed,
        title: "Decode failed",
        reason: "Unable to decode vp_token payload.",
        details: ["Payload is not valid base64url JSON"]
      )
    }

    var details: [String] = []

    if let exp = payload["exp"] as? TimeInterval {
      let expiry = Date(timeIntervalSince1970: exp)
      details.append("exp: \(expiry.formatted(date: .abbreviated, time: .shortened))")
      if Date() > expiry {
        return VpTokenVerificationResult(
          isValid: false,
          status: .failed,
          title: "Token expired",
          reason: "vp_token has passed expiration time.",
          details: details
        )
      }
    } else {
      details.append("exp: missing")
    }

    if payload["vp"] != nil || payload["vc"] != nil {
      return VpTokenVerificationResult(
        isValid: true,
        status: .verified,
        title: "Proof verified",
        reason: "Token structure and expiry checks passed.",
        details: details
      )
    }

    return VpTokenVerificationResult(
      isValid: false,
      status: .pending,
      title: "Token incomplete",
      reason: "vp or vc claim is missing.",
      details: details
    )
  }
}
