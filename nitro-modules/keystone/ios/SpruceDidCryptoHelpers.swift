//
//  SpruceDidCryptoHelpers.swift
//  @solidarity/nitro-spruce-did (iOS)
//
//  Crypto + encoding helpers extracted from HybridSpruceDid.swift to keep
//  the main class under the 500-line CLAUDE.md ceiling. Pure functions:
//  no state, no Keychain access — they're shared between the EC code path
//  and the JWS verifier path.
//

import CryptoKit
import CryptoTokenKit
import Foundation
import LocalAuthentication
import Security

// MARK: - Error type

internal enum SpruceDidError: Error, LocalizedError {
  case unsupportedKeyType(String)
  case keychainFailure(OSStatus, String)
  case biometricCancelled(String)
  case biometricFailed(String)
  case keyNotFound(String)
  case signFailed(String)
  case verifyFailed(String)
  case invalidInput(String)

  var errorDescription: String? {
    switch self {
    case .unsupportedKeyType(let t): return "Unsupported keyType: \(t)"
    case .keychainFailure(let status, let msg):
      return "Keychain error (status=\(status)): \(msg)"
    // Carries the attempt label + `domain:code` chain (never key material):
    // nothing subscribes to the cancel EVENT, so the thrown error is the only
    // place a js-gated software key that unexpectedly prompted (a phantom
    // Secure-Enclave key under the tag) can ever surface.
    case .biometricCancelled(let m): return "Biometric prompt cancelled (\(m))"
    case .biometricFailed(let m): return "Biometric failed: \(m)"
    case .keyNotFound(let alias): return "No key found for alias=\(alias)"
    case .signFailed(let m): return "Sign failed: \(m)"
    case .verifyFailed(let m): return "Verify failed: \(m)"
    case .invalidInput(let m): return "Invalid input: \(m)"
    }
  }
}

// MARK: - Base64URL

internal enum Base64Url {
  static func encode(_ data: Data) -> String {
    let s = data.base64EncodedString()
    return s
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  static func decode(_ s: String) -> Data? {
    var padded = s
      .replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    while padded.count % 4 != 0 { padded.append("=") }
    return Data(base64Encoded: padded)
  }
}

// MARK: - JWK helpers

internal enum JwkUtils {
  /// Encode a 65-byte uncompressed P-256 point (0x04 || X(32) || Y(32)) as a
  /// canonical sorted JWK JSON string.
  static func p256JwkJsonString(uncompressedPoint: Data) throws -> String {
    guard uncompressedPoint.count == 65, uncompressedPoint[0] == 0x04 else {
      throw SpruceDidError.signFailed(
        "expected 65-byte uncompressed P-256 point (got \(uncompressedPoint.count))")
    }
    let x = uncompressedPoint.subdata(in: 1..<33)
    let y = uncompressedPoint.subdata(in: 33..<65)
    let dict: [String: Any] = [
      "kty": "EC",
      "crv": "P-256",
      "alg": "ES256",
      "x": Base64Url.encode(x),
      "y": Base64Url.encode(y),
    ]
    return try jsonString(dict)
  }

  /// Encode a 32-byte raw Curve25519 public key as a canonical OKP JWK.
  static func ed25519JwkJsonString(rawPublic: Data) throws -> String {
    let dict: [String: Any] = [
      "kty": "OKP",
      "crv": "Ed25519",
      "alg": "EdDSA",
      "x": Base64Url.encode(rawPublic),
    ]
    return try jsonString(dict)
  }

  /// Re-hydrate a P-256 verifying key from a parsed JWK dictionary.
  static func p256PublicKeyFromJwk(_ jwk: [String: Any]) throws -> P256.Signing.PublicKey {
    guard let xB64 = jwk["x"] as? String,
      let yB64 = jwk["y"] as? String,
      let x = Base64Url.decode(xB64),
      let y = Base64Url.decode(yB64),
      x.count == 32, y.count == 32
    else {
      throw SpruceDidError.verifyFailed("JWK missing/invalid x or y")
    }
    var rep = Data([0x04])
    rep.append(x)
    rep.append(y)
    return try P256.Signing.PublicKey(x963Representation: rep)
  }

  private static func jsonString(_ dict: [String: Any]) throws -> String {
    let data = try JSONSerialization.data(
      withJSONObject: dict, options: [.sortedKeys, .withoutEscapingSlashes])
    guard let s = String(data: data, encoding: .utf8) else {
      throw SpruceDidError.signFailed("UTF-8 conversion failed")
    }
    return s
  }
}

// MARK: - ECDSA DER ↔ raw

/// Apple's `ecdsaSignatureMessageX962SHA256` emits a DER SEQUENCE
/// { INTEGER r, INTEGER s }. JWS ES256 requires raw 64-byte `r || s`.
/// `EcdsaCodec` translates between the two. Manual ASN.1 parse avoids
/// pulling in a full ASN.1 library for a 16-line operation.
internal enum EcdsaCodec {
  static func derToRaw(_ der: Data) throws -> Data {
    var i = 0
    guard der.count >= 8, der[i] == 0x30 else {
      throw SpruceDidError.signFailed("DER: missing SEQUENCE")
    }
    i += 1
    _ = Int(der[i])  // sequence length (unused)
    i += 1
    guard der[i] == 0x02 else { throw SpruceDidError.signFailed("DER: missing INTEGER (r)") }
    i += 1
    let rLen = Int(der[i])
    i += 1
    var r = der.subdata(in: i..<(i + rLen))
    i += rLen
    guard der[i] == 0x02 else { throw SpruceDidError.signFailed("DER: missing INTEGER (s)") }
    i += 1
    let sLen = Int(der[i])
    i += 1
    var s = der.subdata(in: i..<(i + sLen))

    // Strip a leading 0x00 sign byte and left-pad to 32 bytes.
    if r.first == 0x00, r.count == 33 { r = r.dropFirst() }
    if s.first == 0x00, s.count == 33 { s = s.dropFirst() }
    while r.count < 32 { r.insert(0x00, at: 0) }
    while s.count < 32 { s.insert(0x00, at: 0) }
    if r.count != 32 || s.count != 32 {
      throw SpruceDidError.signFailed(
        "DER decode: r/s length mismatch (\(r.count),\(s.count))")
    }
    return r + s
  }
}

// MARK: - JWS framing

internal enum JwsFraming {
  /// JWS signing input is the concatenated `header.payload` (b64url) per
  /// RFC 7515. We sign over the UTF-8 bytes of that string.
  static func makeSigningInput(payload: Data) -> Data {
    let header = #"{"alg":"ES256","typ":"JWT"}"#
    let headerB64 = Base64Url.encode(Data(header.utf8))
    let payloadB64 = Base64Url.encode(payload)
    return Data("\(headerB64).\(payloadB64)".utf8)
  }

  /// Compact JWS serialisation (`<header>.<payload>.<sig>`) using the
  /// canonical ES256 header.
  static func compactSerialisation(payload: Data, rawSignature: Data) -> String {
    let header = #"{"alg":"ES256","typ":"JWT"}"#
    let headerB64 = Base64Url.encode(Data(header.utf8))
    let payloadB64 = Base64Url.encode(payload)
    let sigB64 = Base64Url.encode(rawSignature)
    return "\(headerB64).\(payloadB64).\(sigB64)"
  }
}

// MARK: - Sign-failure classification (Fix D)

/// Coarse cause of a failed native sign — just enough to drive the recovery
/// policy in `HybridSpruceDid.signSerially`.
internal enum SpruceDidSignFailureKind {
  /// The prompt was dismissed: by the user, or by the system (app sent to
  /// the background mid-prompt, another prompt raced it). Never retried.
  case cancelled
  /// The authentication carried by the attached LAContext was rejected
  /// WITHOUT a usable prompt: the Secure-Enclave token reports
  /// `authenticationFailed` (CryptoTokenKit -5) or `authenticationNeeded`
  /// (-9), the keychain reports `errSecAuthFailed`, or LocalAuthentication
  /// reports the context itself invalid / non-interactive. A stale
  /// process-lifetime LAContext produces exactly this: once its credential
  /// is gone (an earlier evaluation cancelled, the context invalidated, or
  /// coreauthd dropped it) every later sign fails -5 with NO Face ID sheet
  /// until the context is replaced. Recoverable by ONE retry with a fresh
  /// context — never more, so a genuinely broken ACL costs one extra prompt,
  /// not a loop.
  case authRejected
  /// Anything else (algorithm unsupported, keychain I/O, …). Surfaced as-is.
  case other
}

internal enum SpruceDidSignFailure {
  /// Walks the error and its `NSUnderlyingErrorKey` chain: any cancel wins
  /// (a cancelled prompt must never be re-prompted), otherwise any
  /// auth-rejection code anywhere in the chain marks it recoverable.
  static func classify(_ error: CFError?) -> SpruceDidSignFailureKind {
    guard let error else { return .other }
    var sawAuthRejected = false
    for nsError in errorChain(error as Error as NSError) {
      switch kind(of: nsError) {
      case .cancelled: return .cancelled
      case .authRejected: sawAuthRejected = true
      case .other: break
      }
    }
    return sawAuthRejected ? .authRejected : .other
  }

  /// Human-readable message plus the `domain:code` chain — codes only, so
  /// the string is safe to surface and never carries key material or PII.
  static func message(_ error: CFError?) -> String {
    guard let error else { return "unknown" }
    let nsError = error as Error as NSError
    let codes = errorChain(nsError).map { "\($0.domain):\($0.code)" }
      .joined(separator: " <- ")
    return "\(nsError.localizedDescription) [\(codes)]"
  }

  private static func kind(of error: NSError) -> SpruceDidSignFailureKind {
    switch (error.domain, error.code) {
    case (TKErrorDomain, TKError.canceledByUser.rawValue):
      return .cancelled
    case (TKErrorDomain, TKError.authenticationFailed.rawValue),
      (TKErrorDomain, TKError.authenticationNeeded.rawValue):
      return .authRejected
    case (LAErrorDomain, LAError.userCancel.rawValue),
      (LAErrorDomain, LAError.systemCancel.rawValue),
      (LAErrorDomain, LAError.appCancel.rawValue):
      return .cancelled
    case (LAErrorDomain, LAError.invalidContext.rawValue),
      (LAErrorDomain, LAError.notInteractive.rawValue):
      return .authRejected
    case (NSOSStatusErrorDomain, Int(errSecUserCanceled)):
      return .cancelled
    case (NSOSStatusErrorDomain, Int(errSecAuthFailed)),
      (NSOSStatusErrorDomain, Int(errSecInteractionNotAllowed)):
      return .authRejected
    default:
      // Legacy heuristic kept as the last resort for domains not listed.
      return error.localizedDescription.lowercased().contains("cancel")
        ? .cancelled : .other
    }
  }

  /// The error followed by every underlying error beneath it. Bounded so a
  /// malformed self-referencing chain can never spin.
  private static func errorChain(_ root: NSError) -> [NSError] {
    var chain: [NSError] = []
    var current: NSError? = root
    while let error = current, chain.count < 8 {
      chain.append(error)
      current = error.userInfo[NSUnderlyingErrorKey] as? NSError
    }
    return chain
  }
}
