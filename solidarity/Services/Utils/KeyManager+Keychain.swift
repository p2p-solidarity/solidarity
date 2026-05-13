//
//  KeyManager+Keychain.swift
//  solidarity
//

import CryptoKit
import Foundation
import Security

// MARK: - Key Storage & Retrieval

extension KeyManager {

  func retrieveSymmetricKey(_ identifier: KeyIdentifier) -> CardResult<SymmetricKey> {
    for tag in identifier.readTags {
      let retrieve = keychain.retrieveSymmetricKey(tag: tag)
      if case .success(let key) = retrieve {
        if tag != identifier.primaryTag {
          _ = keychain.storeSymmetricKey(key, tag: identifier.primaryTag)
        }
        if tag != identifier.legacyKeychainTag {
          _ = keychain.storeSymmetricKey(key, tag: identifier.legacyKeychainTag)
        }
        return .success(key)
      }
    }
    return .failure(.encryptionError("Failed to retrieve symmetric key from compatible tags"))
  }

  func retrievePrivateKey(_ identifier: KeyIdentifier) -> CardResult<P256.Signing.PrivateKey> {
    for tag in identifier.readTags {
      let retrieve = keychain.retrievePrivateKey(tag: tag)
      if case .success(let key) = retrieve {
        if tag != identifier.primaryTag {
          _ = keychain.storePrivateKey(key, tag: identifier.primaryTag)
        }
        if tag != identifier.legacyKeychainTag {
          _ = keychain.storePrivateKey(key, tag: identifier.legacyKeychainTag)
        }
        return .success(key)
      }
    }
    return .failure(.encryptionError("Failed to retrieve private key from compatible tags"))
  }

  func storeSymmetricKey(_ key: SymmetricKey, identifier: KeyIdentifier) -> CardResult<Void> {
    let primary = keychain.storeSymmetricKey(key, tag: identifier.primaryTag)
    guard case .success = primary else { return primary }
    _ = keychain.storeSymmetricKey(key, tag: identifier.legacyKeychainTag)
    return .success(())
  }

  func storePrivateKey(_ key: P256.Signing.PrivateKey, identifier: KeyIdentifier) -> CardResult<Void> {
    let primary = keychain.storePrivateKey(key, tag: identifier.primaryTag)
    guard case .success = primary else { return primary }
    _ = keychain.storePrivateKey(key, tag: identifier.legacyKeychainTag)
    return .success(())
  }
}

// MARK: - Supporting Types

struct PublicKeyBundle: Codable {
  let signingPublicKey: Data
  let keyId: String
  let createdAt: Date
  let expiresAt: Date

  var isExpired: Bool {
    return expiresAt < Date()
  }

  var isValid: Bool {
    return !isExpired && signingPublicKey.count == 64
  }
}

// MARK: - Keychain Manager

class KeychainManager {

  func storeSymmetricKey(_ key: SymmetricKey, tag: String) -> CardResult<Void> {
    let keyData = key.withUnsafeBytes { Data($0) }

    // Local-only storage. Raw key bytes must never leave the device via iCloud
    // Keychain — `WhenUnlockedThisDeviceOnly` prevents both backup and sync.
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: tag,
      kSecValueData as String: keyData,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
    ]

    _ = deleteKey(tag: tag)

    let status = SecItemAdd(query as CFDictionary, nil)

    if status == errSecSuccess {
      return .success(())
    } else {
      return .failure(.encryptionError("Failed to store symmetric key: \(status)"))
    }
  }

  func retrieveSymmetricKey(tag: String) -> CardResult<SymmetricKey> {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: tag,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
      kSecReturnData as String: true,
      kSecReturnAttributes as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]

    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)

    if status == errSecSuccess,
       let dict = result as? [String: Any],
       let keyData = dict[kSecValueData as String] as? Data {
      let key = SymmetricKey(data: keyData)

      // One-time migration: if the stored item was synchronizable (iCloud
      // Keychain), copy it to a local-only entry and delete the synced one so
      // future reads use the safe variant.
      if let isSynchronizable = (dict[kSecAttrSynchronizable as String] as? NSNumber)?.boolValue,
         isSynchronizable {
        print("[KeychainManager] Migrating synchronizable symmetric key to local-only: \(tag)")
        _ = deleteKey(tag: tag)
        _ = storeSymmetricKey(key, tag: tag)
      }

      return .success(key)
    } else {
      return .failure(.encryptionError("Failed to retrieve symmetric key: \(status)"))
    }
  }

  func storePrivateKey(_ key: P256.Signing.PrivateKey, tag: String) -> CardResult<Void> {
    let keyData = key.rawRepresentation

    // Local-only storage. Private key bytes must never leave the device via
    // iCloud Keychain.
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: tag,
      kSecValueData as String: keyData,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
    ]

    _ = deleteKey(tag: tag)

    let status = SecItemAdd(query as CFDictionary, nil)

    if status == errSecSuccess {
      return .success(())
    } else {
      return .failure(.encryptionError("Failed to store private key: \(status)"))
    }
  }

  func retrievePrivateKey(tag: String) -> CardResult<P256.Signing.PrivateKey> {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: tag,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
      kSecReturnData as String: true,
      kSecReturnAttributes as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]

    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)

    if status == errSecSuccess,
       let dict = result as? [String: Any],
       let keyData = dict[kSecValueData as String] as? Data {
      do {
        let key = try P256.Signing.PrivateKey(rawRepresentation: keyData)

        // One-time migration: pull legacy iCloud-synced entries down to a
        // local-only entry on first read so private key bytes stop leaving
        // the device.
        if let isSynchronizable = (dict[kSecAttrSynchronizable as String] as? NSNumber)?.boolValue,
           isSynchronizable {
          print("[KeychainManager] Migrating synchronizable private key to local-only: \(tag)")
          _ = deleteKey(tag: tag)
          _ = storePrivateKey(key, tag: tag)
        }

        return .success(key)
      } catch {
        return .failure(.encryptionError("Failed to reconstruct private key: \(error.localizedDescription)"))
      }
    } else {
      return .failure(.encryptionError("Failed to retrieve private key: \(status)"))
    }
  }

  func deleteKey(tag: String) -> CardResult<Void> {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: tag,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
    ]

    let status = SecItemDelete(query as CFDictionary)

    if status == errSecSuccess || status == errSecItemNotFound {
      return .success(())
    } else {
      return .failure(.encryptionError("Failed to delete key: \(status)"))
    }
  }
}
