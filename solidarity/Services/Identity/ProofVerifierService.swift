import CryptoKit
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

    guard let decoded = decodeCompactJWT(token)
    else {
      return VpTokenVerificationResult(
        isValid: false,
        status: .failed,
        title: "Decode failed",
        reason: "Unable to decode vp_token payload.",
        details: ["Payload is not valid base64url JSON"]
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

    switch verifyJWTSignature(jwt: token, header: header, payload: payload) {
    case .failure(let reason):
      return VpTokenVerificationResult(
        isValid: false,
        status: .failed,
        title: "Signature invalid",
        reason: reason,
        details: details
      )
    case .success(let signatureDetail):
      details.append(signatureDetail)
    }

    if payload["vp"] != nil || payload["vc"] != nil {
      return VpTokenVerificationResult(
        isValid: true,
        status: .verified,
        title: "Proof verified",
        reason: "Token signature, structure, and expiry checks passed.",
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

  // MARK: - JWT Helpers

  enum SignatureVerificationOutcome {
    case success(String)
    case failure(String)
  }

  func verifyJWTSignature(
    jwt: String,
    header: [String: Any],
    payload: [String: Any]
  ) -> SignatureVerificationOutcome {
    guard let issuerDid = extractIssuerDid(from: payload) else {
      return .failure("Missing issuer DID for JWT signature verification.")
    }
    let keyId = header["kid"] as? String

    guard let trustedJWK = IssuerTrustAnchorStore.shared.trustedJWK(for: issuerDid, keyId: keyId) else {
      return .failure("Untrusted issuer DID: \(issuerDid)")
    }

    if let embeddedJWK = extractPublicKeyJWK(from: payload), embeddedJWK != trustedJWK {
      return .failure("JWT embedded key does not match trusted issuer anchor.")
    }

    let segments = jwt.split(separator: ".")
    guard segments.count == 3 else {
      return .failure("Malformed JWT signature structure.")
    }

    guard let signatureData = Data(base64URLEncoded: String(segments[2])) else {
      return .failure("Invalid JWT signature encoding.")
    }

    let signingInputData = Data("\(segments[0]).\(segments[1])".utf8)

    do {
      let publicKey = try trustedJWK.toP256PublicKey()
      let signature =
        (try? P256.Signing.ECDSASignature(rawRepresentation: signatureData))
        ?? (try? P256.Signing.ECDSASignature(derRepresentation: signatureData))

      guard let signature else {
        return .failure("Unsupported JWT signature format.")
      }

      guard publicKey.isValidSignature(signature, for: signingInputData) else {
        return .failure("JWT signature verification failed.")
      }

      return .success("sig: valid (\(issuerDid))")
    } catch {
      return .failure("Failed to verify JWT signature: \(error.localizedDescription)")
    }
  }

  struct DecodedCompactJWT {
    let header: [String: Any]
    let payload: [String: Any]
  }

  func decodeCompactJWT(_ jwt: String) -> DecodedCompactJWT? {
    let segments = jwt.split(separator: ".")
    guard segments.count == 3,
      let headerData = Data(base64URLEncoded: String(segments[0])),
      let payloadData = Data(base64URLEncoded: String(segments[1])),
      let header = try? JSONSerialization.jsonObject(with: headerData) as? [String: Any],
      let payload = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any]
    else {
      return nil
    }
    return DecodedCompactJWT(header: header, payload: payload)
  }

  // MARK: - Private Helpers

  private func extractPublicKeyJWK(from payload: [String: Any]) -> PublicKeyJWK? {
    if let credentialSubject = payload["credentialSubject"] as? [String: Any],
      let key = parsePublicKeyJWK(from: credentialSubject["publicKeyJwk"])
    {
      return key
    }

    if let vc = payload["vc"] as? [String: Any],
      let credentialSubject = vc["credentialSubject"] as? [String: Any],
      let key = parsePublicKeyJWK(from: credentialSubject["publicKeyJwk"])
    {
      return key
    }

    return nil
  }

  private func extractIssuerDid(from payload: [String: Any]) -> String? {
    if let iss = payload["iss"] as? String, !iss.isEmpty {
      return iss
    }

    if let vc = payload["vc"] as? [String: Any] {
      if let issuer = vc["issuer"] as? String, !issuer.isEmpty {
        return issuer
      }
      if let issuer = vc["issuer"] as? [String: Any],
         let id = issuer["id"] as? String,
         !id.isEmpty
      {
        return id
      }
    }

    return nil
  }

  private func parsePublicKeyJWK(from value: Any?) -> PublicKeyJWK? {
    guard let dict = value as? [String: Any],
      let kty = dict["kty"] as? String,
      let crv = dict["crv"] as? String,
      let alg = dict["alg"] as? String,
      let x = dict["x"] as? String,
      let y = dict["y"] as? String
    else {
      return nil
    }

    return PublicKeyJWK(kty: kty, crv: crv, alg: alg, x: x, y: y)
  }
}
