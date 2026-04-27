//
//  VaultSecretsKeychain.swift
//  solidarity
//
//  Keychain-backed storage for vault secrets: the master vault key,
//  per-content keys, and received recovery shards.
//

import Foundation
import CryptoKit
import Security

enum VaultSecretsKeychainError: LocalizedError {
    case vaultLocked
    case readFailed(OSStatus)
    case writeFailed(OSStatus)
    case deleteFailed(OSStatus)

    var errorDescription: String? {
        switch self {
        case .vaultLocked:
            return "Vault is locked or has not been initialized"
        case .readFailed(let status):
            return "Keychain read failed (\(status))"
        case .writeFailed(let status):
            return "Keychain write failed (\(status))"
        case .deleteFailed(let status):
            return "Keychain delete failed (\(status))"
        }
    }
}

enum VaultSecretsKeychain {
    // Mirrors `FileEncryptionService.getOrCreateVaultKey`. Read-only here;
    // creation lives in FileEncryptionService.
    private static let vaultKeyService = "solidarity"
    private static let vaultKeyAccount = "com.solidarity.vault.encryption.key"

    static let contentKeyService = "solidarity.vault.contentKeys"
    static let receivedShardsService = "solidarity.vault.receivedShards"

    // MARK: - Vault key

    static func loadVaultKey() throws -> SymmetricKey {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: vaultKeyService,
            kSecAttrAccount as String: vaultKeyAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        var status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecInteractionNotAllowed {
            // Device locked. Surface a clean error so callers can fail closed.
            throw VaultSecretsKeychainError.vaultLocked
        }

        if status == errSecItemNotFound {
            throw VaultSecretsKeychainError.vaultLocked
        }

        if status != errSecSuccess {
            // Retry with synchronizable=any in case the only copy is in iCloud.
            query[kSecAttrSynchronizable as String] = kSecAttrSynchronizableAny
            status = SecItemCopyMatching(query as CFDictionary, &result)
            guard status == errSecSuccess else {
                throw VaultSecretsKeychainError.readFailed(status)
            }
        }

        guard let data = result as? Data else {
            throw VaultSecretsKeychainError.vaultLocked
        }

        return SymmetricKey(data: data)
    }

    // MARK: - Generic 32-byte secret storage

    static func loadData(service: String, account: String) throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            throw VaultSecretsKeychainError.readFailed(status)
        }
        return result as? Data
    }

    static func storeData(_ data: Data, service: String, account: String) throws {
        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]

        var attributes = baseQuery
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        attributes[kSecAttrSynchronizable as String] = kCFBooleanFalse

        let addStatus = SecItemAdd(attributes as CFDictionary, nil)
        if addStatus == errSecDuplicateItem {
            let updateStatus = SecItemUpdate(
                baseQuery as CFDictionary,
                [
                    kSecValueData as String: data,
                    kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
                ] as CFDictionary
            )
            guard updateStatus == errSecSuccess else {
                throw VaultSecretsKeychainError.writeFailed(updateStatus)
            }
            return
        }
        guard addStatus == errSecSuccess else {
            throw VaultSecretsKeychainError.writeFailed(addStatus)
        }
    }

    static func deleteData(service: String, account: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw VaultSecretsKeychainError.deleteFailed(status)
        }
    }
}
