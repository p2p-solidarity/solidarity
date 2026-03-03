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
    // Check if the token is a Semaphore proof payload (JSON with semaphore_proof key)
    if let data = token.data(using: .utf8),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      json["semaphore_proof"] != nil
    {
      return verifySemaphoreProof(token)
    }

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

  // MARK: - Semaphore Proof Verification

  func verifySemaphoreProof(_ proofPayload: String) -> VpTokenVerificationResult {
    guard let data = proofPayload.data(using: .utf8),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      return VpTokenVerificationResult(
        isValid: false,
        status: .failed,
        title: "Invalid proof payload",
        reason: "Could not parse Semaphore proof JSON.",
        details: ["Malformed JSON"]
      )
    }

    // Extract the nested semaphore_proof string for verification
    let semaphoreProofString: String
    if let proofObj = json["semaphore_proof"] {
      if let proofStr = proofObj as? String {
        semaphoreProofString = proofStr
      } else if let proofData = try? JSONSerialization.data(withJSONObject: proofObj),
        let proofStr = String(data: proofData, encoding: .utf8)
      {
        semaphoreProofString = proofStr
      } else {
        return VpTokenVerificationResult(
          isValid: false,
          status: .failed,
          title: "Invalid Semaphore proof",
          reason: "semaphore_proof field is not a valid proof string.",
          details: ["Unexpected proof format"]
        )
      }
    } else {
      return VpTokenVerificationResult(
        isValid: false,
        status: .failed,
        title: "Missing Semaphore proof",
        reason: "No semaphore_proof field found in payload.",
        details: ["Key not present"]
      )
    }

    var details: [String] = []
    if let hash = json["passport_hash"] as? String {
      details.append("passport_hash: \(hash.prefix(16))...")
    }

    do {
      let isValid = try SemaphoreIdentityManager.shared.verifyProof(semaphoreProofString)
      if isValid {
        details.append("Semaphore ZKP: verified")
        return VpTokenVerificationResult(
          isValid: true,
          status: .verified,
          title: "ZK Proof verified",
          reason: "Semaphore proof cryptographically verified.",
          details: details
        )
      } else {
        details.append("Semaphore ZKP: invalid")
        return VpTokenVerificationResult(
          isValid: false,
          status: .failed,
          title: "ZK Proof invalid",
          reason: "Semaphore proof verification returned false.",
          details: details
        )
      }
    } catch {
      details.append("Semaphore verify error: \(error.localizedDescription)")
      return VpTokenVerificationResult(
        isValid: false,
        status: .pending,
        title: "ZK Proof unverifiable",
        reason: "Semaphore library unavailable or proof verification failed.",
        details: details
      )
    }
  }
}
