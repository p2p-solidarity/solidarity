//
//  EncryptionManager.swift
//  solidarity
//
//  AES-256 encryption service with keychain integration for secure local storage
//

import CryptoKit
import Foundation
import Security

/// Manages AES-256 encryption and keychain operations for secure data storage
class EncryptionManager {
  static let shared = EncryptionManager()

  private let keyTag: String
  private let legacyKeyTag: String
  private let service: String
  private let legacyService: String
  private let defaults: UserDefaults

  init(
    keyTag: String = AppBranding.currentEncryptionKeyTag,
    legacyKeyTag: String = AppBranding.legacyEncryptionKeyTag,
    service: String = AppBranding.currentEncryptionService,
    legacyService: String = AppBranding.legacyEncryptionService,
    defaults: UserDefaults = .standard
  ) {
    self.keyTag = keyTag
    self.legacyKeyTag = legacyKeyTag
    self.service = service
    self.legacyService = legacyService
    self.defaults = defaults
  }

  // MARK: - Public Methods

  /// Encrypt data using AES-256-GCM
  func encrypt<T: Codable>(_ data: T) -> CardResult<Data> {
    do {
      // Serialize the data to JSON
      let jsonData = try JSONEncoder().encode(data)

      // Get or create encryption key
      let key = try getOrCreateEncryptionKey()

      // Encrypt using AES-GCM
      let sealedBox = try AES.GCM.seal(jsonData, using: key)

      // Combine nonce and ciphertext
      guard let encryptedData = sealedBox.combined else {
        return .failure(.encryptionError("Failed to create combined encrypted data"))
      }

      return .success(encryptedData)

    } catch {
      return .failure(.encryptionError("Encryption failed: \(error.localizedDescription)"))
    }
  }

  /// Decrypt data using AES-256-GCM
  func decrypt<T: Codable>(_ encryptedData: Data, as type: T.Type) -> CardResult<T> {
    do {
      // Get encryption key
      let key = try getOrCreateEncryptionKey()

      // Create sealed box from encrypted data
      let sealedBox = try AES.GCM.SealedBox(combined: encryptedData)

      // Decrypt the data
      let decryptedData = try AES.GCM.open(sealedBox, using: key)

      // Deserialize from JSON
      let decodedObject = try JSONDecoder().decode(type, from: decryptedData)

      return .success(decodedObject)

    } catch {
      return .failure(.encryptionError("Decryption failed: \(error.localizedDescription)"))
    }
  }

  /// Generate a secure random key for one-time use
  func generateRandomKey() -> SymmetricKey {
    return SymmetricKey(size: .bits256)
  }

  /// Securely delete encryption key from keychain
  func deleteEncryptionKey() -> CardResult<Void> {
    let currentStatus = deleteKey(service: service, account: keyTag)
    let legacyStatus = deleteKey(service: legacyService, account: legacyKeyTag)

    if [currentStatus, legacyStatus].allSatisfy({ $0 == errSecSuccess || $0 == errSecItemNotFound }) {
      return .success(())
    } else {
      return .failure(.encryptionError("Failed to delete encryption key: \(currentStatus) / \(legacyStatus)"))
    }
  }

  func migrateLegacyKeyIfNeeded() {
    guard (try? retrieveKeyFromKeychain(service: service, account: keyTag, synchronizable: .any)) == nil,
          let legacyKey = try? retrieveKeyFromKeychain(
            service: legacyService,
            account: legacyKeyTag,
            synchronizable: .any
          )
    else { return }

    try? storeKeyInKeychain(legacyKey)
    defaults.set(true, forKey: "solidarity.migration.encryption.v1")
  }

  // MARK: - Private Methods

  /// Filter for the `kSecAttrSynchronizable` attribute when querying or deleting.
  private enum SyncFilter {
    case yes
    case no
    case any

    var attributeValue: Any {
      switch self {
      case .yes: return kCFBooleanTrue as Any
      case .no: return kCFBooleanFalse as Any
      case .any: return kSecAttrSynchronizableAny
      }
    }
  }

  /// Get existing encryption key from keychain or create a new one. Prefers an
  /// iCloud-synced copy so a fresh device can decrypt backups created elsewhere
  /// once iCloud Keychain delivers the key. Promotes any legacy local-only key
  /// to a synced entry so future cross-device restores succeed.
  private func getOrCreateEncryptionKey() throws -> SymmetricKey {
    // 1. Synced key wins — this is the canonical copy shared across devices.
    if let syncedKey = try? retrieveKeyFromKeychain(
      service: service,
      account: keyTag,
      synchronizable: .yes
    ) {
      return syncedKey
    }

    // 2. Local-only key from a previous build that used `*ThisDeviceOnly`.
    //    Promote it to a synced entry so the next device can decrypt our backup.
    if let localKey = try? retrieveKeyFromKeychain(
      service: service,
      account: keyTag,
      synchronizable: .no
    ) {
      try promoteKeyToSynced(localKey, service: service, account: keyTag)
      return localKey
    }

    // 3. Legacy `airmeishi.*` key from the rebrand. Re-stamp under the current
    //    service/account as a synced item.
    if let legacyKey = try? retrieveKeyFromKeychain(
      service: legacyService,
      account: legacyKeyTag,
      synchronizable: .any
    ) {
      try storeKeyInKeychain(legacyKey)
      defaults.set(true, forKey: "solidarity.migration.encryption.v1")
      return legacyKey
    }

    // 4. Nothing found — mint a new synced key.
    let newKey = SymmetricKey(size: .bits256)
    try storeKeyInKeychain(newKey)
    return newKey
  }

  /// Retrieve encryption key from keychain
  private func retrieveKeyFromKeychain(
    service: String,
    account: String,
    synchronizable: SyncFilter = .any
  ) throws -> SymmetricKey {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrSynchronizable as String: synchronizable.attributeValue,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]

    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)

    guard status == errSecSuccess else {
      throw CardError.encryptionError("Failed to retrieve key from keychain: \(status)")
    }

    guard let keyData = result as? Data else {
      throw CardError.encryptionError("Invalid key data format in keychain")
    }

    return SymmetricKey(data: keyData)
  }

  /// Store encryption key in keychain, updating existing value when duplicate item exists.
  func storeKeyInKeychain(_ key: SymmetricKey) throws {
    try storeKeyInKeychain(key, service: service, account: keyTag)
  }

  private func storeKeyInKeychain(_ key: SymmetricKey, service: String, account: String) throws {
    let keyData = key.withUnsafeBytes { Data($0) }

    // Stored as `kSecAttrAccessibleWhenUnlocked` + `kSecAttrSynchronizable: true`
    // so iCloud Keychain can deliver this key to other devices on the same Apple
    // ID. The previous `*ThisDeviceOnly` accessibility blocked sync entirely,
    // which made `restoreFromBackup()` on a second device fail with
    // "Decryption failed" — the encrypted blob arrived via iCloud Drive but the
    // symmetric key never did.
    let addQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecValueData as String: keyData,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked,
      kSecAttrSynchronizable as String: kCFBooleanTrue as Any,
    ]

    let status = SecItemAdd(addQuery as CFDictionary, nil)
    if status == errSecDuplicateItem {
      // The synced slot is already populated. Update the bytes in place rather
      // than rewriting the sync attribute (synchronizable is part of the item's
      // primary key — changing it requires delete + add, handled in
      // `promoteKeyToSynced`).
      let matchQuery: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
        kSecAttrSynchronizable as String: kCFBooleanTrue as Any,
      ]
      let attributesToUpdate: [String: Any] = [
        kSecValueData as String: keyData,
        kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked,
      ]
      let updateStatus = SecItemUpdate(matchQuery as CFDictionary, attributesToUpdate as CFDictionary)
      guard updateStatus == errSecSuccess else {
        throw CardError.encryptionError("Failed to update key in keychain: \(updateStatus)")
      }
      return
    }

    guard status == errSecSuccess else {
      throw CardError.encryptionError("Failed to store key in keychain: \(status)")
    }
  }

  /// Delete the existing local-only entry and re-add the same bytes as a synced
  /// item. Required because `kSecAttrSynchronizable` is part of the Keychain
  /// item identity and cannot be flipped via `SecItemUpdate`.
  private func promoteKeyToSynced(_ key: SymmetricKey, service: String, account: String) throws {
    _ = deleteKey(service: service, account: account, synchronizable: .no)
    try storeKeyInKeychain(key, service: service, account: account)
    defaults.set(true, forKey: "solidarity.migration.encryption.icloud_sync.v1")
  }

  private func deleteKey(service: String, account: String, synchronizable: SyncFilter = .any) -> OSStatus {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrSynchronizable as String: synchronizable.attributeValue,
    ]

    return SecItemDelete(query as CFDictionary)
  }
}
