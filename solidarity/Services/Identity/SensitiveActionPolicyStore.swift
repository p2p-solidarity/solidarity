import Foundation
import Security

/// Persists per-action biometric requirement flags. Stored in the Keychain
/// (local-only, non-synchronizable) so the policy cannot be flipped by anyone
/// who can write to `UserDefaults` (e.g. via plist edits or an attacker who
/// has app-data access but not Keychain access).
final class SensitiveActionPolicyStore: ObservableObject {
  static let shared = SensitiveActionPolicyStore()

  @Published private(set) var requirements: [String: Bool] = [:]

  private static let service = "solidarity.security.policy"

  private init() {
    SensitiveAction.allCases.forEach { action in
      migrateLegacyDefaultIfNeeded(for: action)

      if let stored = readKeychain(account: action.rawValue) {
        requirements[action.rawValue] = stored
      } else {
        // Default: require biometrics for every sensitive action.
        writeKeychain(account: action.rawValue, value: true)
        requirements[action.rawValue] = true
      }
    }
  }

  func requiresBiometric(_ action: SensitiveAction) -> Bool {
    requirements[action.rawValue] ?? true
  }

  func setRequirement(_ enabled: Bool, for action: SensitiveAction) {
    requirements[action.rawValue] = enabled
    writeKeychain(account: action.rawValue, value: enabled)
  }

  // MARK: - Migration

  /// One-time migration: if Keychain has no entry but `UserDefaults` does
  /// (legacy storage), copy the value into the Keychain and remove the
  /// `UserDefaults` entry so it cannot be flipped from outside.
  private func migrateLegacyDefaultIfNeeded(for action: SensitiveAction) {
    let legacyKey = "solidarity.security.faceid.\(action.rawValue)"
    let defaults = UserDefaults.standard
    guard defaults.object(forKey: legacyKey) != nil else { return }

    if readKeychain(account: action.rawValue) == nil {
      let legacyValue = defaults.bool(forKey: legacyKey)
      writeKeychain(account: action.rawValue, value: legacyValue)
      print("[SensitiveActionPolicyStore] Migrated \(action.rawValue) (\(legacyValue)) from UserDefaults to Keychain")
    }
    defaults.removeObject(forKey: legacyKey)
  }

  // MARK: - Keychain helpers

  private func readKeychain(account: String) -> Bool? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: Self.service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data, let byte = data.first else {
      return nil
    }
    return byte != 0
  }

  private func writeKeychain(account: String, value: Bool) {
    let data = Data([value ? 0x01 : 0x00])

    let deleteQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: Self.service,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(deleteQuery as CFDictionary)

    let addQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: Self.service,
      kSecAttrAccount as String: account,
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
    ]
    let status = SecItemAdd(addQuery as CFDictionary, nil)
    if status != errSecSuccess {
      print("[SensitiveActionPolicyStore] Failed to persist policy for \(account): \(status)")
    }
  }
}
