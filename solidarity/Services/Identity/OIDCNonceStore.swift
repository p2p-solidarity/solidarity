//
//  OIDCNonceStore.swift
//  solidarity
//
//  Persistent nonce replay-protection cache backed by the iOS Keychain.
//  Survives process death and reinstall so an attacker cannot replay
//  vp_tokens by force-killing the holder app between requests.
//

import Foundation
import Security

/// Thin Keychain wrapper that stores the OIDC `nonce -> firstSeenAt` map
/// used by `OIDCService.registerNonce(_:)` for replay suppression.
final class OIDCNonceStore {
  static let shared = OIDCNonceStore()

  private let tag = "solidarity.oidc.seenNonces"
  private let queue = DispatchQueue(label: "solidarity.oidc.nonceStore")

  private init() {}

  // MARK: - Public API

  /// Load the persisted nonce map. Caller is expected to expire entries
  /// itself based on its own TTL window.
  func load() -> [String: Date] {
    queue.sync { Self.read(tag: tag) }
  }

  /// Persist `nonces`, keeping only entries newer than `ttl`. Persistence
  /// is best-effort: a Keychain failure must not block the in-memory
  /// replay check that the caller still enforces.
  func save(_ nonces: [String: Date], ttl: TimeInterval, now: Date = Date()) {
    queue.async { [self] in
      let trimmed = nonces.filter { now.timeIntervalSince($0.value) < ttl }
      Self.write(trimmed, tag: self.tag)
    }
  }

  /// Test/diagnostic helper — wipe the persisted set.
  func reset() {
    queue.sync {
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrAccount as String: tag,
      ]
      _ = SecItemDelete(query as CFDictionary)
    }
  }

  // MARK: - Persistence

  private static func read(tag: String) -> [String: Date] {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: tag,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else {
      return [:]
    }
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .secondsSince1970
    guard let decoded = try? decoder.decode([String: Date].self, from: data) else {
      return [:]
    }
    return decoded
  }

  private static func write(_ nonces: [String: Date], tag: String) {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .secondsSince1970
    guard let data = try? encoder.encode(nonces) else { return }

    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: tag,
    ]
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      // Complete file protection: only readable while the device is
      // unlocked and never synced off-device.
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    ]

    let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if updateStatus == errSecItemNotFound {
      var addQuery = query
      for (k, v) in attributes { addQuery[k] = v }
      _ = SecItemAdd(addQuery as CFDictionary, nil)
    }
  }
}
