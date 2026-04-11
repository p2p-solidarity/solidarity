import CryptoKit
import Foundation

extension ProofVerifierService {

  // MARK: - VP Envelope Verification

  func verifyVPEnvelope(_ vp: [String: Any]) -> VpTokenVerificationResult {
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

  func verifyEmbeddedJWT(_ jwt: String) -> VpTokenVerificationResult {
    let segments = jwt.split(separator: ".")
    guard segments.count == 3 else {
      return VpTokenVerificationResult(
        isValid: false, status: .failed,
        title: "Invalid JWT", reason: "Embedded credential is not a valid 3-segment JWT.",
        details: []
      )
    }

    guard let decoded = decodeCompactJWT(jwt)
    else {
      return VpTokenVerificationResult(
        isValid: false, status: .failed,
        title: "Decode failed", reason: "Unable to decode embedded JWT payload.",
        details: []
      )
    }

    let payload = decoded.payload
    let header = decoded.header
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

    switch verifyJWTSignature(jwt: jwt, header: header, payload: payload) {
    case .failure(let reason):
      return VpTokenVerificationResult(
        isValid: false, status: .failed,
        title: "Invalid signature", reason: reason,
        details: details
      )
    case .success(let signatureDetail):
      details.append(signatureDetail)
    }

    if payload["vc"] != nil {
      details.append("type: VerifiableCredential")
    }

    return VpTokenVerificationResult(
      isValid: true, status: .verified,
      title: "JWT valid", reason: "Signature, structure, and expiry checks passed.",
      details: details
    )
  }

  // MARK: - Semaphore Proof Verification

  // swiftlint:disable:next function_body_length
  func verifySemaphoreProof(_ proofPayload: String) -> VpTokenVerificationResult {
    let data = Data(proofPayload.utf8)
    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
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

    let parsedContext = SemaphoreIdentityManager.shared.bindingContext(from: semaphoreProofString)
    let expectedRoot = json["group_root"] as? String
    let expectedSignal = json["signal"] as? String
    let expectedScope = json["scope"] as? String

    guard let expectedRoot, let expectedSignal, let expectedScope else {
      return VpTokenVerificationResult(
        isValid: false,
        status: .failed,
        title: "Missing Semaphore binding context",
        reason: "Semaphore proof payload must explicitly include root/signal/scope.",
        details: details
      )
    }

    if let parsedContext {
      if parsedContext.groupRoot != expectedRoot
        || parsedContext.signal != SemaphoreIdentityManager.clampForBinding(expectedSignal)
        || parsedContext.scope != SemaphoreIdentityManager.clampForBinding(expectedScope)
      {
        return VpTokenVerificationResult(
          isValid: false,
          status: .failed,
          title: "Invalid binding context",
          reason: "Provided root/signal/scope does not match proof envelope context.",
          details: details
        )
      }
      if parsedContext.commitments.count <= 1 {
        return VpTokenVerificationResult(
          isValid: false,
          status: .failed,
          title: "Insufficient group context",
          reason: "Semaphore verification requires at least 2 group commitments.",
          details: details
        )
      }
      let calculatedRoot = SemaphoreIdentityManager.bindingRoot(for: parsedContext.commitments)
      if parsedContext.groupRoot != calculatedRoot {
        return VpTokenVerificationResult(
          isValid: false,
          status: .failed,
          title: "Invalid group root binding",
          reason: "group_root does not match commitments encoded in proof context.",
          details: details
        )
      }
      if !parsedContext.commitments.isEmpty {
        details.append("members: \(parsedContext.commitments.count)")
      }
    }

    do {
      let isValid = try SemaphoreIdentityManager.shared.verifyProof(
        semaphoreProofString,
        expectedRoot: expectedRoot,
        expectedSignal: expectedSignal,
        expectedScope: expectedScope
      )
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
