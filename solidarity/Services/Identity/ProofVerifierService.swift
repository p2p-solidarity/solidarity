import CryptoKit
import Foundation
import SpruceIDMobileSdkRs
import os

struct VpTokenVerificationResult: Equatable {
  let isValid: Bool
  let status: VerificationStatus
  let title: String
  let reason: String
  let details: [String]
}

final class ProofVerifierService {
  static let shared = ProofVerifierService()
  static let logger = Logger(subsystem: AppBranding.currentLoggerSubsystem, category: "ProofVerifier")

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

    // Nonce replay check: a verifier that receives the same nonce twice
    // is being replayed. Register the nonce before signature verification
    // so even a valid signature cannot be reused.
    if let nonce = payload["nonce"] as? String, !nonce.isEmpty {
      if !OIDCService.shared.registerNonce(nonce) {
        return VpTokenVerificationResult(
          isValid: false,
          status: .failed,
          title: "Replay detected",
          reason: "vp_token nonce has already been used.",
          details: details + ["nonce: \(nonce.prefix(16))..."]
        )
      }
      details.append("nonce: \(nonce.prefix(16))...")
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

    // RFC 8725 §3.1: pin alg before signature decode. The resolved
    // issuer key is always P-256 here (did:key + IssuerTrustAnchorStore
    // produce P-256 JWKs and PublicKeyJWK.toP256PublicKey() enforces it),
    // so anything other than ES256 — including `none`, HMAC, RSA or
    // ES384 — must be rejected. Decoding the signature first and then
    // running through ECDSA would otherwise let `alg: none` slip past
    // because the empty signature would just fail crypto and we would
    // log a confusing error instead of a precise one.
    let alg = (header["alg"] as? String)?.uppercased() ?? ""
    guard alg == "ES256" else {
      return .failure("Unsupported JWT alg: \(alg.isEmpty ? "(missing)" : alg). Expected ES256.")
    }

    // Resolution strategy, in order of preference:
    //  1. IssuerTrustAnchorStore — for issuers registered via TLSNotary /
    //     institution proof pipelines.
    //  2. did:key self-resolution — the public key is encoded in the DID
    //     itself; no external trust required for the SIGNATURE part.
    //     (The caller still decides whether to trust this issuer.)
    //  3. Embedded publicKeyJwk in the VC credentialSubject — sanity-checked
    //     against the resolved DID.
    let resolvedKey: PublicKeyJWK
    let source: String

    if let anchor = IssuerTrustAnchorStore.shared.trustedJWK(for: issuerDid, keyId: keyId) {
      resolvedKey = anchor
      source = "anchor"
    } else if let didKeyJWK = DIDKeyResolver.resolveP256JWK(from: issuerDid) {
      resolvedKey = didKeyJWK
      source = "did:key"
    } else if Self.normalizeDid(issuerDid).hasPrefix("did:key:"),
              let embedded = extractPublicKeyJWK(from: payload),
              let derivedDid = selfDerivedDid(from: embedded),
              Self.didSuffixesMatch(derivedDid, issuerDid) {
      // Embedded-JWK fallback: only honoured for did:key issuers, where the
      // DID itself is a deterministic function of the public key. For any
      // other DID method (did:web, did:ethr, …) the JWK could be supplied
      // by the presenter, making this a circular trust path. Reject those.
      resolvedKey = embedded
      source = "embedded-jwk (did:key self-consistent)"
    } else {
      return .failure("Untrusted issuer DID: \(issuerDid)")
    }

    if let embedded = extractPublicKeyJWK(from: payload), embedded != resolvedKey {
      return .failure("JWT embedded key does not match resolved issuer key.")
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
      let publicKey = try resolvedKey.toP256PublicKey()
      let signature =
        (try? P256.Signing.ECDSASignature(rawRepresentation: signatureData))
        ?? (try? P256.Signing.ECDSASignature(derRepresentation: signatureData))

      guard let signature else {
        return .failure("Unsupported JWT signature format.")
      }

      guard publicKey.isValidSignature(signature, for: signingInputData) else {
        return .failure("JWT signature verification failed.")
      }

      return .success("sig: valid (\(issuerDid), via \(source))")
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

  /// Derive a did:key from a JWK via SpruceKit. Used for embedded-key
  /// self-consistency checks when no anchor is registered.
  private func selfDerivedDid(from jwk: PublicKeyJWK) -> String? {
    guard let jwkString = try? jwk.jsonString() else { return nil }
    return try? DidMethodUtils(method: .key).didFromJwk(jwk: jwkString)
  }

  static func normalizeDid(_ did: String) -> String {
    did.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  }

  /// Strict suffix equality for did:key identifiers. The multibase suffix
  /// after `did:key:` is case-sensitive (base58btc), so we deliberately do
  /// NOT lowercase before comparing — only whitespace is trimmed. Both
  /// inputs MUST be did:key.
  static func didSuffixesMatch(_ lhs: String, _ rhs: String) -> Bool {
    let prefix = "did:key:"
    let l = lhs.trimmingCharacters(in: .whitespacesAndNewlines)
    let r = rhs.trimmingCharacters(in: .whitespacesAndNewlines)
    guard l.lowercased().hasPrefix(prefix), r.lowercased().hasPrefix(prefix) else {
      return false
    }
    let lSuffix = l.dropFirst(prefix.count)
    let rSuffix = r.dropFirst(prefix.count)
    return lSuffix == rSuffix
  }
}
