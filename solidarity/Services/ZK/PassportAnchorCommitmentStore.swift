//
//  PassportAnchorCommitmentStore.swift
//  solidarity
//
//  Per-install random "passport anchor" used by the Semaphore fallback
//  bootstrap group when the user has not joined any peer group yet.
//
//  Storing a fixed literal across all installs let a passive observer
//  identify any group whose public commitment list contained the well-known
//  literal as a "user on the bootstrap fallback path", leaking the
//  fallback-vs-real-group state. A per-install random value keeps the
//  anchor stable for the lifetime of the device (so proofs can repeat
//  the same group root) while making it indistinguishable from any other
//  commitment to outside observers.
//

import Foundation
import Security

/// Backed by the iOS Keychain so the anchor survives reinstall and is
/// shielded from filesystem snooping.
final class PassportAnchorCommitmentStore {
  static let shared = PassportAnchorCommitmentStore()

  /// Account tag in the Keychain. Distinct from the Semaphore identity tag
  /// so deleting the user's identity doesn't reset the anchor.
  private let tag = "solidarity.zk.passportAnchorCommitment"
  private let lock = NSLock()
  private var cached: String?

  private init() {}

  /// Lazily-derived per-install commitment as a decimal field-element
  /// string suitable for `SemaphoreIdentityManager.commitmentElement(from:)`.
  var value: String {
    lock.lock()
    defer { lock.unlock() }
    if let cached { return cached }
    if let stored = Self.read(tag: tag) {
      cached = stored
      return stored
    }
    let generated = Self.generateRandomCommitmentString()
    Self.write(generated, tag: tag)
    cached = generated
    return generated
  }

  /// Test/diagnostic helper.
  func reset() {
    lock.lock()
    defer { lock.unlock() }
    cached = nil
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: tag,
    ]
    _ = SecItemDelete(query as CFDictionary)
  }

  // MARK: - Generation

  /// Produce a random decimal-string commitment. Field elements consumed
  /// by Semaphore's bn254 commitment encoder must be < the curve order
  /// (~254 bits). Drawing 31 random bytes (248 bits) keeps the value
  /// safely below the field modulus and matches the existing hard-coded
  /// literal's order of magnitude.
  private static func generateRandomCommitmentString() -> String {
    var bytes = [UInt8](repeating: 0, count: 31)
    let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    if status != errSecSuccess {
      // Defensive fallback — never return zero or a predictable value.
      // CryptoKit-derived random keeps us out of the deterministic-anchor
      // regime even when SecRandomCopyBytes is misbehaving.
      bytes = (0..<31).map { _ in UInt8.random(in: 0...255) }
    }
    return decimalString(from: bytes)
  }

  /// Big-endian byte sequence -> decimal-string converter (no leading
  /// zeroes). 31-byte inputs fit comfortably in [0, 2^248) so we never
  /// land outside the bn254 field modulus.
  private static func decimalString(from bytes: [UInt8]) -> String {
    var digits: [UInt8] = [0]
    for byte in bytes {
      var carry = Int(byte)
      for index in 0..<digits.count {
        let total = Int(digits[index]) * 256 + carry
        digits[index] = UInt8(total % 10)
        carry = total / 10
      }
      while carry > 0 {
        digits.append(UInt8(carry % 10))
        carry /= 10
      }
    }
    // Drop leading zeroes; preserve at least one digit.
    while digits.count > 1, digits.last == 0 { digits.removeLast() }
    let result = String(digits.reversed().map { Character(String($0)) })
    return result.isEmpty ? "1" : result
  }

  // MARK: - Persistence

  private static func read(tag: String) -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: tag,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private static func write(_ value: String, tag: String) {
    let data = Data(value.utf8)
    let baseQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: tag,
    ]
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
    if updateStatus == errSecItemNotFound {
      var addQuery = baseQuery
      for (k, v) in attributes { addQuery[k] = v }
      _ = SecItemAdd(addQuery as CFDictionary, nil)
    }
  }
}
