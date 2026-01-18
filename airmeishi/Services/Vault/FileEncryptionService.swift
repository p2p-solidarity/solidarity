//
//  FileEncryptionService.swift
//  airmeishi
//
//  AES-256-GCM encryption with streaming support for large files
//

import Foundation
import CryptoKit

final class FileEncryptionService {
    static let shared = FileEncryptionService()

    private let fileManager = FileManager.default
    private let bufferSize = 1024 * 1024  // 1MB buffer
    private let vaultKeyTag = "com.solidarity.vault.encryption.key"

    private init() {}

    // MARK: - Public API

    /// Encrypt a file using AES-256-GCM with streaming
    func encryptFile(
        at sourceURL: URL,
        to destinationURL: URL,
        progress: ((Double) -> Void)? = nil
    ) async throws -> EncryptedFileResult {
        let fileSize = try fileManager.attributesOfItem(atPath: sourceURL.path)[.size] as? Int64 ?? 0

        guard fileSize > 0 else {
            throw VaultError.fileEmpty
        }

        let vaultKey = try getOrCreateVaultKey()
        let nonce = AES.GCM.Nonce()

        let inputStream = InputStream(url: sourceURL)
        guard let stream = inputStream else {
            throw VaultError.cannotOpenFile
        }

        stream.open()
        defer { stream.close() }

        var encryptedData = Data()
        var processedBytes: Int64 = 0

        var buffer = [UInt8](repeating: 0, count: bufferSize)

        while stream.hasBytesAvailable {
            let bytesRead = stream.read(&buffer, maxLength: bufferSize)

            guard bytesRead > 0 else { break }

            let chunk = Data(buffer.prefix(bytesRead))
            let sealedChunk = try AES.GCM.seal(chunk, using: vaultKey, nonce: nonce)

            if let combined = sealedChunk.combined {
                encryptedData.append(combined)
            }

            processedBytes += Int64(bytesRead)
            progress?(Double(processedBytes) / Double(fileSize))

            if Task.isCancelled { throw VaultError.cancelled }
        }

        try encryptedData.write(to: destinationURL)

        return EncryptedFileResult(
            encryptedURL: destinationURL,
            size: Int64(encryptedData.count),
            nonce: Data(nonce),
            checksum: computeChecksum(encryptedData)
        )
    }

    /// Decrypt a file using AES-256-GCM with streaming
    func decryptFile(
        at encryptedURL: URL,
        to destinationURL: URL,
        progress: ((Double) -> Void)? = nil
    ) async throws {
        let encryptedData = try Data(contentsOf: encryptedURL)
        let vaultKey = try getOrCreateVaultKey()

        let sealedBox = try AES.GCM.SealedBox(combined: encryptedData)
        let decryptedData = try AES.GCM.open(sealedBox, using: vaultKey)

        try decryptedData.write(to: destinationURL)
    }

    /// Decrypt and return data directly
    func decryptData(_ encryptedData: Data) async throws -> Data {
        let vaultKey = try getOrCreateVaultKey()
        let sealedBox = try AES.GCM.SealedBox(combined: encryptedData)
        return try AES.GCM.open(sealedBox, using: vaultKey)
    }

    /// Encrypt data in memory (for small files)
    func encryptData(_ data: Data) async throws -> EncryptedDataResult {
        let vaultKey = try getOrCreateVaultKey()
        let nonce = AES.GCM.Nonce()
        let sealedBox = try AES.GCM.seal(data, using: vaultKey, nonce: nonce)

        guard let combined = sealedBox.combined else {
            throw VaultError.encryptionFailed
        }

        return EncryptedDataResult(
            encryptedData: combined,
            nonce: Data(nonce),
            checksum: computeChecksum(combined)
        )
    }

    /// Generate a content key for sharing
    func generateContentKey() -> SymmetricKey {
        SymmetricKey(size: .bits256)
    }

    /// Encrypt with content key for sharing
    func encryptForSharing(
        _ data: Data,
        key: SymmetricKey,
        expiresAt: Date? = nil
    ) async throws -> SharedContentPackage {
        let nonce = AES.GCM.Nonce()
        let sealedBox = try AES.GCM.seal(data, using: key, nonce: nonce)

        guard let combined = sealedBox.combined else {
            throw VaultError.encryptionFailed
        }

        return SharedContentPackage(
            encryptedData: combined,
            nonce: Data(nonce),
            algorithm: "AES-256-GCM",
            expiresAt: expiresAt,
            checksum: computeChecksum(combined)
        )
    }

    /// Decrypt shared content
    func decryptSharedContent(
        _ package: SharedContentPackage,
        key: SymmetricKey
    ) async throws -> Data {
        let sealedBox = try AES.GCM.SealedBox(combined: package.encryptedData)
        return try AES.GCM.open(sealedBox, using: key)
    }

    /// Compute checksum of data
    func computeChecksum(_ data: Data) -> String {
        let hash = SHA256.hash(data: data)
        return hash.compactMap { String(format: "%02x", $0) }.joined()
    }

    // MARK: - Key Management

    private func getOrCreateVaultKey() throws -> SymmetricKey {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "solidarity",
            kSecAttrAccount as String: vaultKeyTag,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecSuccess, let keyData = result as? Data {
            return SymmetricKey(data: keyData)
        }

        let newKey = SymmetricKey(size: .bits256)
        let keyData = newKey.withUnsafeBytes { Data($0) }

        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "solidarity",
            kSecAttrAccount as String: vaultKeyTag,
            kSecValueData as String: keyData,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]

        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)

        guard addStatus == errSecSuccess else {
            let errorMessage = SecCopyErrorMessageString(addStatus, nil) ?? "Unknown error" as CFString
            throw VaultError.keyCreationFailed(errorMessage as String)
        }

        return newKey
    }

    /// Delete vault encryption key (use with caution!)
    func deleteVaultKey() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "solidarity",
            kSecAttrAccount as String: vaultKeyTag
        ]

        let status = SecItemDelete(query as CFDictionary)

        guard status == errSecSuccess || status == errSecItemNotFound else {
            let errorMessage = SecCopyErrorMessageString(status, nil) ?? "Unknown error" as CFString
            throw VaultError.keyDeletionFailed(errorMessage as String)
        }
    }
}

// MARK: - Result Types

struct EncryptedFileResult {
    let encryptedURL: URL
    let size: Int64
    let nonce: Data
    let checksum: String
}

struct EncryptedDataResult {
    let encryptedData: Data
    let nonce: Data
    let checksum: String
}

struct SharedContentPackage {
    let encryptedData: Data
    let nonce: Data
    let algorithm: String
    let expiresAt: Date?
    let checksum: String
}

// MARK: - Vault Errors

enum VaultError: LocalizedError {
    case fileEmpty
    case cannotOpenFile
    case encryptionFailed
    case decryptionFailed
    case cancelled
    case keyCreationFailed(String)
    case keyDeletionFailed(String)
    case checksumMismatch

    var errorDescription: String? {
        switch self {
        case .fileEmpty: return "Cannot encrypt an empty file"
        case .cannotOpenFile: return "Cannot open file for reading"
        case .encryptionFailed: return "Encryption operation failed"
        case .decryptionFailed: return "Decryption operation failed"
        case .cancelled: return "Operation was cancelled"
        case .keyCreationFailed(let reason): return "Failed to create encryption key: \(reason)"
        case .keyDeletionFailed(let reason): return "Failed to delete encryption key: \(reason)"
        case .checksumMismatch: return "File integrity check failed"
        }
    }
}
