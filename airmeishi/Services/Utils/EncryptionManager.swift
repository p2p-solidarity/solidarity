//
//  EncryptionManager.swift
//  airmeishi
//
//  AES-256 encryption service with keychain integration for secure local storage
//

import CryptoKit
import Foundation
import Security

/// Manages AES-256 encryption and keychain operations for secure data storage
class EncryptionManager {
  static let shared = EncryptionManager()

  private let keyTag = "com.kidneyweakx.airmeishi.encryption.key"
  private let service = "airmeishi"

  private init() {}

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
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: keyTag,
    ]

    let status = SecItemDelete(query as CFDictionary)

    if status == errSecSuccess || status == errSecItemNotFound {
      return .success(())
    } else {
      return .failure(.encryptionError("Failed to delete encryption key: \(status)"))
    }
  }

  // MARK: - Private Methods

  /// Get existing encryption key from keychain or create a new one
  private func getOrCreateEncryptionKey() throws -> SymmetricKey {
    // Try to retrieve existing key
    if let existingKey = try? retrieveKeyFromKeychain() {
      return existingKey
    }

    // Create new key if none exists
    let newKey = SymmetricKey(size: .bits256)
    try storeKeyInKeychain(newKey)
    return newKey
  }

  /// Retrieve encryption key from keychain
  private func retrieveKeyFromKeychain() throws -> SymmetricKey {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: keyTag,
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

  /// Store encryption key in keychain
  private func storeKeyInKeychain(_ key: SymmetricKey) throws {
    let keyData = key.withUnsafeBytes { Data($0) }

    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: keyTag,
      kSecValueData as String: keyData,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    ]

    let status = SecItemAdd(query as CFDictionary, nil)

    guard status == errSecSuccess else {
      throw CardError.encryptionError("Failed to store key in keychain: \(status)")
    }
  }
}
