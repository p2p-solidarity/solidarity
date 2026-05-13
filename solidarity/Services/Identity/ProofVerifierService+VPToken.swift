import CryptoKit
import Foundation

extension ProofVerifierService {

  // MARK: - VP Envelope Verification

  /// Verifies a Verifiable Presentation envelope. A plain JSON VP without a
  /// holder JWT signature cannot be considered valid even when its embedded
  /// VCs verify — without a holder proof of possession we have no way to
  /// bind the presentation to the alleged holder. Callers wanting holder
  /// binding must pass a signed VP JWT (handled in `verifyVpToken` via
  /// `verifyJWTSignature`).
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
      isValid: false,
      status: .failed,
      title: "VP envelope unsigned",
      reason: "VP envelope is unsigned (no holder proof of possession).",
      details: details + ["Embedded credentials verify, but the JSON VP itself carries no holder JWT signature. Re-issue as a signed VP JWT (typ: vp+jwt)."]
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

    // The envelope is the authoritative binding context — it carries the
    // root/signal/scope the prover actually committed to. Outer top-level
    // fields (when present) are an OPTIONAL consistency assertion: callers
    // that already know the expected context (e.g. an OID4VP request that
    // pinned a specific scope) can repeat it here and we'll require it to
    // match. Self-attested fallbacks (MoproProofService passport proofs)
    // omit them and rely on the envelope alone — that is safe because the
    // cryptographic verifyProof below binds against these exact values.
    guard let parsedContext = SemaphoreIdentityManager.shared.bindingContext(from: semaphoreProofString) else {
      return VpTokenVerificationResult(
        isValid: false,
        status: .failed,
        title: "Invalid Semaphore envelope",
        reason: "Could not parse Semaphore proof envelope.",
        details: details
      )
    }

    let outerRoot = json["group_root"] as? String
    let outerSignal = json["signal"] as? String
    let outerScope = json["scope"] as? String

    if let outerRoot, parsedContext.groupRoot != outerRoot {
      return VpTokenVerificationResult(
        isValid: false,
        status: .failed,
        title: "Invalid binding context",
        reason: "Outer group_root does not match proof envelope.",
        details: details
      )
    }
    if let outerSignal,
       parsedContext.signal != SemaphoreIdentityManager.clampForBinding(outerSignal) {
      return VpTokenVerificationResult(
        isValid: false,
        status: .failed,
        title: "Invalid binding context",
        reason: "Outer signal does not match proof envelope.",
        details: details
      )
    }
    if let outerScope,
       parsedContext.scope != SemaphoreIdentityManager.clampForBinding(outerScope) {
      return VpTokenVerificationResult(
        isValid: false,
        status: .failed,
        title: "Invalid binding context",
        reason: "Outer scope does not match proof envelope.",
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
    // Use the circuit-only variant: if Semaphore is unavailable in this
    // build we skip this binding check rather than substituting a
    // non-circuit deterministic fingerprint that the proof envelope's
    // `groupRoot` will never equal. The internal verifyProof call below
    // also performs the circuit-root match, so skipping here is safe.
    if let calculatedRoot = SemaphoreIdentityManager.bindingRootIfCircuitAvailable(for: parsedContext.commitments) {
      if parsedContext.groupRoot != calculatedRoot {
        return VpTokenVerificationResult(
          isValid: false,
          status: .failed,
          title: "Invalid group root binding",
          reason: "group_root does not match commitments encoded in proof context.",
          details: details
        )
      }
    }
    details.append("members: \(parsedContext.commitments.count)")

    do {
      let isValid = try SemaphoreIdentityManager.shared.verifyProof(
        semaphoreProofString,
        expectedRoot: parsedContext.groupRoot,
        expectedSignal: parsedContext.signal,
        expectedScope: parsedContext.scope
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
