//
//  NullifierStore.swift
//  solidarity
//
//  Persistent (scope, nullifier) tracking to prevent Semaphore proof replay.
//  Backed by the iOS Keychain so the set survives reinstalls and is shielded
//  from unprivileged file access.
//

import Foundation
import Security

final class NullifierStore {
  static let shared = NullifierStore()

  /// Keychain account tag for the persisted nullifier set.
  private let tag = "solidarity.zk.nullifiers"
  private let queue = DispatchQueue(label: "solidarity.zk.nullifiers")

  /// In-memory cache backed by Keychain. Set lookups are O(1); we persist on
  /// every record() so a crash mid-session can't leak a usable nullifier.
  private var seen: Set<String> = []
  private var loaded = false

  private init() {}

  // MARK: - Public API

  func hasSeen(scope: String, nullifier: String) -> Bool {
    queue.sync {
      ensureLoaded()
      return seen.contains(Self.key(scope: scope, nullifier: nullifier))
    }
  }

  func record(scope: String, nullifier: String) {
    queue.sync {
      ensureLoaded()
      let key = Self.key(scope: scope, nullifier: nullifier)
      guard !seen.contains(key) else { return }
      seen.insert(key)
      persist()
    }
  }

  /// Test-only helper.
  func reset() {
    queue.sync {
      seen.removeAll()
      loaded = true
      _ = SecItemDelete(baseQuery() as CFDictionary)
    }
  }

  // MARK: - Persistence

  private static func key(scope: String, nullifier: String) -> String {
    "\(scope)|\(nullifier)"
  }

  private func ensureLoaded() {
    guard !loaded else { return }
    loaded = true
    seen = load()
  }

  private func baseQuery() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: tag,
    ]
  }

  private func load() -> Set<String> {
    var query = baseQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else {
      return []
    }
    guard let decoded = try? JSONDecoder().decode([String].self, from: data) else {
      return []
    }
    return Set(decoded)
  }

  private func persist() {
    let payload: Data
    do {
      payload = try JSONEncoder().encode(Array(seen))
    } catch {
      return
    }

    var addQuery = baseQuery()
    addQuery[kSecValueData as String] = payload
    addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

    SecItemDelete(baseQuery() as CFDictionary)
    SecItemAdd(addQuery as CFDictionary, nil)
  }
}
