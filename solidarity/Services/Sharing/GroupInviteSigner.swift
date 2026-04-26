import CryptoKit
import Foundation

/// Sign / verify helpers for `GroupInvitePayload` and `GroupJoinResponsePayload`.
/// Uses the same Ed25519 identity key (`SecureKeyManager.shared`) that already
/// signs proximity exchange envelopes, so the inviter and the exchange peer
/// authenticate with one consistent identity.
enum GroupInviteSigner {
  /// Signs the canonical bytes of a group invite using the local Ed25519 key.
  /// Returns `nil` only if the underlying CryptoKit signing call fails.
  static func sign(canonicalBytes: Data) -> Data? {
    let signing = SecureKeyManager.shared
    let stringForm = canonicalBytes.base64EncodedString()
    let sigB64 = signing.sign(content: stringForm)
    if sigB64.isEmpty {
      return nil
    }
    return Data(base64Encoded: sigB64)
  }

  /// Verifies a detached Ed25519 signature against the supplied public key bytes.
  static func verify(signature: Data, canonicalBytes: Data, publicKey: Data) -> Bool {
    guard let key = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKey) else {
      return false
    }
    // Match the framing used by `sign(canonicalBytes:)`: signatures are produced over the
    // base64 string of the canonical bytes, so verification must use the same encoding.
    let signedString = canonicalBytes.base64EncodedString()
    guard let signedData = signedString.data(using: .utf8) else {
      return false
    }
    return key.isValidSignature(signature, for: signedData)
  }

  /// Local Ed25519 public key bytes (raw representation) used by `sign(canonicalBytes:)`.
  static var localPublicKey: Data {
    guard let raw = Data(base64Encoded: SecureKeyManager.shared.mySignPubKey) else {
      return Data()
    }
    return raw
  }

  static func isFresh(_ timestamp: Date, maxAge: TimeInterval) -> Bool {
    let age = abs(Date().timeIntervalSince(timestamp))
    return age <= maxAge
  }
}
