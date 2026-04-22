//
//  DIDKeyResolver.swift
//  solidarity
//
//  Local resolver for did:key — extracts the public key material from the
//  DID identifier itself (no network call, no trust anchor required).
//
//  The did:key spec encodes the key bytes directly in the DID:
//    did:key:z<base58btc(multicodec_prefix || public_key_bytes)>
//
//  Supported codecs:
//    - P-256 (secp256r1)      multicodec 0x1200 (varint 0x80 0x24)
//        33-byte compressed SEC1 key: 0x02/0x03 || X(32)
//    - P-256 uncompressed variant (0x1201, 65-byte uncompressed)
//
//  Ed25519 and secp256k1 exist in the spec but we only consume ES256, so
//  this resolver deliberately returns nil for unsupported codecs rather
//  than lying about support.
//

import CryptoKit
import Foundation

enum DIDKeyResolver {
  /// Resolve a did:key into the public JWK it encodes. Returns nil when the
  /// DID is malformed, uses an unsupported key type, or fails to decode.
  static func resolveP256JWK(from did: String) -> PublicKeyJWK? {
    let trimmed = did.trimmingCharacters(in: .whitespaces).lowercased()
    guard trimmed.hasPrefix("did:key:z") else { return nil }

    let base58 = String(did.dropFirst("did:key:z".count))
    guard let decoded = base58Decode(base58), decoded.count >= 3 else { return nil }

    // Parse unsigned varint-encoded multicodec prefix.
    var index = 0
    var codec: UInt64 = 0
    var shift: UInt64 = 0
    while index < decoded.count {
      let byte = decoded[index]
      index += 1
      codec |= UInt64(byte & 0x7F) << shift
      if (byte & 0x80) == 0 { break }
      shift += 7
      if shift >= 63 { return nil }
    }
    let body = decoded.subdata(in: index..<decoded.count)

    switch codec {
    case 0x1200:
      // Compressed P-256 key (33 bytes: 0x02/0x03 + 32-byte X).
      return jwkFromCompressedP256(body)
    case 0x1201:
      // Uncompressed P-256 key (65 bytes: 0x04 + X(32) + Y(32)).
      return jwkFromUncompressedP256(body)
    default:
      return nil
    }
  }

  private static func jwkFromCompressedP256(_ data: Data) -> PublicKeyJWK? {
    guard data.count == 33 else { return nil }
    do {
      let key = try P256.Signing.PublicKey(compressedRepresentation: data)
      let uncompressed = key.x963Representation // 65 bytes: 0x04 || X || Y
      guard uncompressed.count == 65 else { return nil }
      let x = uncompressed.subdata(in: 1..<33)
      let y = uncompressed.subdata(in: 33..<65)
      return PublicKeyJWK(
        kty: "EC",
        crv: "P-256",
        alg: "ES256",
        x: x.base64URLEncodedString(),
        y: y.base64URLEncodedString()
      )
    } catch {
      return nil
    }
  }

  private static func jwkFromUncompressedP256(_ data: Data) -> PublicKeyJWK? {
    guard data.count == 65, data.first == 0x04 else { return nil }
    let x = data.subdata(in: 1..<33)
    let y = data.subdata(in: 33..<65)
    return PublicKeyJWK(
      kty: "EC",
      crv: "P-256",
      alg: "ES256",
      x: x.base64URLEncodedString(),
      y: y.base64URLEncodedString()
    )
  }

  // MARK: - Base58BTC

  // Bitcoin alphabet (no 0, O, I, l).
  private static let alphabet: [Character] = Array(
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
  )
  private static let reverseAlphabet: [Character: UInt8] = {
    var map: [Character: UInt8] = [:]
    for (idx, ch) in alphabet.enumerated() {
      map[ch] = UInt8(idx)
    }
    return map
  }()

  static func base58Decode(_ string: String) -> Data? {
    guard !string.isEmpty else { return Data() }

    // Count leading '1's — each maps to a leading zero byte.
    var zeros = 0
    for char in string {
      if char == "1" {
        zeros += 1
      } else {
        break
      }
    }

    var bytes: [UInt8] = []
    for char in string {
      guard let digit = reverseAlphabet[char] else { return nil }
      var carry = UInt32(digit)
      for i in 0..<bytes.count {
        carry += UInt32(bytes[i]) * 58
        bytes[i] = UInt8(carry & 0xFF)
        carry >>= 8
      }
      while carry > 0 {
        bytes.append(UInt8(carry & 0xFF))
        carry >>= 8
      }
    }

    // Bytes accumulated little-endian; reverse + prepend leading zeros.
    let result = [UInt8](repeating: 0, count: zeros) + bytes.reversed()
    return Data(result)
  }
}
