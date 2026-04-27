//
//  FileEncryptionService.swift
//  solidarity
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

    // v2: per-chunk fresh nonce; framed as [u32 BE chunk-len][12B nonce + ct + 16B tag].
    // v1 (legacy, broken): single nonce reused across all chunks. Refuse to decrypt.
    private static let streamMagicV2: [UInt8] = [0x00, 0x00, 0x00, 0x02]

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

        let inputStream = InputStream(url: sourceURL)
        guard let stream = inputStream else {
            throw VaultError.cannotOpenFile
        }

        stream.open()
        defer { stream.close() }

        var encryptedData = Data()
        encryptedData.append(contentsOf: Self.streamMagicV2)

        var processedBytes: Int64 = 0
        var buffer = [UInt8](repeating: 0, count: bufferSize)

        while stream.hasBytesAvailable {
            let bytesRead = stream.read(&buffer, maxLength: bufferSize)

            guard bytesRead > 0 else { break }

            let chunk = Data(buffer.prefix(bytesRead))
            let nonce = AES.GCM.Nonce()
            let sealedChunk = try AES.GCM.seal(chunk, using: vaultKey, nonce: nonce)

            guard let combined = sealedChunk.combined else {
                throw VaultError.encryptionFailed
            }

            var lengthBE = UInt32(combined.count).bigEndian
            withUnsafeBytes(of: &lengthBE) { encryptedData.append(contentsOf: $0) }
            encryptedData.append(combined)

            processedBytes += Int64(bytesRead)
            progress?(Double(processedBytes) / Double(fileSize))

            if Task.isCancelled { throw VaultError.cancelled }
        }

        try encryptedData.write(to: destinationURL, options: [.atomic, .completeFileProtection])

        return EncryptedFileResult(
            encryptedURL: destinationURL,
            size: Int64(encryptedData.count),
            nonce: Data(),
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

        guard encryptedData.count >= 4,
              Array(encryptedData.prefix(4)) == Self.streamMagicV2 else {
            throw VaultError.unsupportedFileVersion
        }

        var output = Data()
        var offset = 4
        let total = encryptedData.count

        while offset < total {
            guard offset + 4 <= total else {
                throw VaultError.decryptionFailed
            }
            let lenBytes = encryptedData[offset..<(offset + 4)]
            let length = lenBytes.withUnsafeBytes { ptr -> UInt32 in
                let raw = ptr.load(as: UInt32.self)
                return UInt32(bigEndian: raw)
            }
            offset += 4

            guard length > 0, offset + Int(length) <= total else {
                throw VaultError.decryptionFailed
            }
            let chunk = encryptedData[offset..<(offset + Int(length))]
            offset += Int(length)

            let sealedBox = try AES.GCM.SealedBox(combined: chunk)
            let plain = try AES.GCM.open(sealedBox, using: vaultKey)
            output.append(plain)

            progress?(Double(offset) / Double(total))
            if Task.isCancelled { throw VaultError.cancelled }
        }

        try output.write(to: destinationURL, options: [.atomic, .completeFileProtection])
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
    case unsupportedFileVersion

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
        case .unsupportedFileVersion: return "Encrypted file uses an unsupported or legacy format"
        }
    }
}
