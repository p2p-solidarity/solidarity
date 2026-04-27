//
//  ProximityIdentitySigner.swift
//  solidarity
//
//  Bridges proximity exchange signing to the user's DID key (P-256 ECDSA, ES256)
//  rather than the messaging Curve25519 key. Receivers verify against the
//  sender's published JWK, which must match the DID document derived from
//  the sender's `did:key` identifier (see `DIDKeyResolver`).
//

import CryptoKit
import Foundation

/// Sign / verify helpers that anchor proximity exchange signatures in the same
/// P-256 (ES256) DID key used elsewhere in the identity stack.
///
/// Why not Curve25519? `SecureKeyManager` produces messaging signatures, but
/// those keys do not appear in the user's DID document and cannot be checked
/// by a verifier from the DID alone. Anchoring exchange signatures to the
/// DID key makes them verifiable against the sender's `did:key`.
enum ProximityIdentitySigner {
  /// Current canonical-bytes protocol version. v1 is unsigned/Curve25519-based
  /// and is rejected on the receive path.
  static let currentProtocolVersion = 2

  // MARK: - Local identity lookup

  /// Returns the local user's `did:key` identifier (P-256, ES256), or nil if
  /// the keychain is not yet initialised.
  static func localDID() -> String? {
    if let cached = IdentityCacheStore().loadDescriptor() {
      return cached.did
    }
    let result = DIDService().currentDidKey()
    if case .success(let descriptor) = result {
      return descriptor.did
    }
    return nil
  }

  /// Returns the local user's public JWK (P-256), or nil if unavailable.
  static func localPublicJWK() -> PublicKeyJWK? {
    if let cached = IdentityCacheStore().loadDescriptor() {
      return cached.jwk
    }
    let result = KeychainService.shared.publicJwk()
    if case .success(let jwk) = result {
      return jwk
    }
    return nil
  }

  // MARK: - Signing (sender side)

  /// Signs canonical bytes with the local DID signing key (P-256 ECDSA, SHA-256).
  /// Returns the raw fixed-width r||s signature (64 bytes), base64-encoded for
  /// JSON transport. Returns nil if the signing key is unavailable.
  static func signBase64(canonicalBytes: Data) -> String? {
    let signingKeyResult = KeychainService.shared.signingKey()
    guard case .success(let key) = signingKeyResult else {
      return nil
    }
    do {
      let signature = try key.sign(payload: canonicalBytes)
      return signature.base64EncodedString()
    } catch {
      return nil
    }
  }

  // MARK: - Verification (receiver side)

  /// Verifies a base64-encoded ECDSA P-256 signature against the supplied JWK.
  /// Accepts either a raw r||s (64-byte) signature or an ASN.1/DER encoded
  /// signature, since both are valid wire representations.
  static func verify(signatureBase64: String, canonicalBytes: Data, jwk: PublicKeyJWK) -> Bool {
    guard !signatureBase64.isEmpty,
      let sigData = Data(base64Encoded: signatureBase64) else {
      return false
    }
    do {
      let publicKey = try jwk.toP256PublicKey()
      // Try raw r||s first (this is what BiometricSigningKey produces).
      if let rawSig = try? P256.Signing.ECDSASignature(rawRepresentation: sigData),
        publicKey.isValidSignature(rawSig, for: canonicalBytes) {
        return true
      }
      // Fall back to DER encoding for cross-platform interop.
      if let derSig = try? P256.Signing.ECDSASignature(derRepresentation: sigData),
        publicKey.isValidSignature(derSig, for: canonicalBytes) {
        return true
      }
      return false
    } catch {
      return false
    }
  }

  /// Returns true when the supplied JWK is consistent with the JWK encoded
  /// inside `did:key:z…`. Receivers MUST gate trust on this check, otherwise
  /// any peer could claim a foreign DID alongside their own JWK.
  static func jwk(_ jwk: PublicKeyJWK, matchesDID did: String) -> Bool {
    guard did.hasPrefix("did:key:"),
      let resolved = DIDKeyResolver.resolveP256JWK(from: did) else {
      return false
    }
    return resolved.x == jwk.x && resolved.y == jwk.y && resolved.crv == jwk.crv
  }
}
