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
    // 1. Check if this is a JSON payload (VP envelope or Semaphore proof)
    if let data = token.data(using: .utf8),
       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    {
      // Semaphore ZKP
      if json["semaphore_proof"] != nil {
        return verifySemaphoreProof(token)
      }
      // VP envelope (JSON-LD Verifiable Presentation)
      if let types = json["type"] as? [String], types.contains("VerifiablePresentation") {
        return verifyVPEnvelope(json)
      }
    }

    // 2. Compact JWT (3 segments)
    let segments = token.split(separator: ".")
    guard segments.count == 3 else {
      return VpTokenVerificationResult(
        isValid: false,
        status: .failed,
        title: "Invalid vp_token",
        reason: "Token is neither valid JSON nor a 3-segment JWT.",
        details: ["Malformed token"]
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

  // MARK: - VP Envelope Verification

  private func verifyVPEnvelope(_ vp: [String: Any]) -> VpTokenVerificationResult {
    var details: [String] = []

    guard let credentials = vp["verifiableCredential"] as? [Any], !credentials.isEmpty else {
      return VpTokenVerificationResult(
        isValid: false,
        status: .failed,
        title: "Empty VP",
        reason: "VerifiablePresentation contains no credentials.",
        details: ["verifiableCredential array is missing or empty"]
      )
    }

    details.append("credentials: \(credentials.count)")

    if let holder = vp["holder"] as? String {
      details.append("holder: \(holder.prefix(24))...")
    }

    if let nonce = vp["nonce"] as? String {
      details.append("nonce: \(nonce.prefix(16))...")
    }

    // Verify each embedded credential (JWT string)
    for (index, cred) in credentials.enumerated() {
      guard let jwt = cred as? String else {
        details.append("credential[\(index)]: not a JWT string")
        continue
      }

      let credResult = verifyEmbeddedJWT(jwt)
      if !credResult.isValid {
        return VpTokenVerificationResult(
          isValid: false,
          status: credResult.status,
          title: "Credential[\(index)] invalid",
          reason: credResult.reason,
          details: details + credResult.details
        )
      }
      details.append(contentsOf: credResult.details.map { "credential[\(index)]: \($0)" })
    }

    return VpTokenVerificationResult(
      isValid: true,
      status: .verified,
      title: "VP verified",
      reason: "Verifiable Presentation structure and embedded credentials are valid.",
      details: details
    )
  }

  private func verifyEmbeddedJWT(_ jwt: String) -> VpTokenVerificationResult {
    let segments = jwt.split(separator: ".")
    guard segments.count == 3 else {
      return VpTokenVerificationResult(
        isValid: false, status: .failed,
        title: "Invalid JWT", reason: "Embedded credential is not a valid 3-segment JWT.",
        details: []
      )
    }

    guard let payloadData = Data(base64URLEncoded: String(segments[1])),
          let payload = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any]
    else {
      return VpTokenVerificationResult(
        isValid: false, status: .failed,
        title: "Decode failed", reason: "Unable to decode embedded JWT payload.",
        details: []
      )
    }

    var details: [String] = []
    if let exp = payload["exp"] as? TimeInterval {
      let expiry = Date(timeIntervalSince1970: exp)
      details.append("exp: \(expiry.formatted(date: .abbreviated, time: .shortened))")
      if Date() > expiry {
        return VpTokenVerificationResult(
          isValid: false, status: .failed,
          title: "Credential expired", reason: "Embedded JWT has passed expiration.",
          details: details
        )
      }
    }

    if payload["vc"] != nil {
      details.append("type: VerifiableCredential")
    }

    return VpTokenVerificationResult(
      isValid: true, status: .verified,
      title: "JWT valid", reason: "Structure and expiry OK.",
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
