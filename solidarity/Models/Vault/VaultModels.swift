//
//  VaultModels.swift
//  airmeishi
//
//  All vault data models for The Sovereign Vault
//

import Foundation
import CryptoKit

// MARK: - Item Type

enum VaultItemType: String, Codable, CaseIterable {
    case file
    case json
    case text
    case encryptedBundle
    case image
    case video
    case document

    var displayName: String {
        switch self {
        case .file: return "File"
        case .json: return "JSON Data"
        case .text: return "Text"
        case .encryptedBundle: return "Encrypted Bundle"
        case .image: return "Image"
        case .video: return "Video"
        case .document: return "Document"
        }
    }

    var systemImage: String {
        switch self {
        case .file: return "doc.fill"
        case .json: return "curlybraces"
        case .text: return "text.alignleft"
        case .encryptedBundle: return "lock.fill"
        case .image: return "photo.fill"
        case .video: return "video.fill"
        case .document: return "doc.text.fill"
        }
    }

    var defaultMimeType: String {
        switch self {
        case .file: return "application/octet-stream"
        case .json: return "application/json"
        case .text: return "text/plain"
        case .encryptedBundle: return "application/octet-stream"
        case .image: return "image/png"
        case .video: return "video/mp4"
        case .document: return "application/pdf"
        }
    }

    static func from(mimeType: String) -> VaultItemType {
        if mimeType.hasPrefix("image/") { return .image }
        if mimeType.hasPrefix("video/") { return .video }
        if mimeType.hasPrefix("text/") { return .text }
        if mimeType == "application/json" { return .json }
        if mimeType == "application/pdf" { return .document }
        return .file
    }
}

// MARK: - Access Control

enum VaultAccessControl: String, Codable, CaseIterable {
    case privateOnly
    case biometricRequired
    case timeLocked
    case delegated
    case publicWithKey

    var displayName: String {
        switch self {
        case .privateOnly: return "Private"
        case .biometricRequired: return "Biometric Protected"
        case .timeLocked: return "Time Locked"
        case .delegated: return "App Access"
        case .publicWithKey: return "Key Protected"
        }
    }

    var description: String {
        switch self {
        case .privateOnly: return "Only accessible on this device"
        case .biometricRequired: return "Requires biometric authentication"
        case .timeLocked: return "Releases at a scheduled time"
        case .delegated: return "Shared with authorized apps"
        case .publicWithKey: return "Decryptable with content key"
        }
    }

    var systemImage: String {
        switch self {
        case .privateOnly: return "lock.fill"
        case .biometricRequired: return "faceid"
        case .timeLocked: return "clock.fill"
        case .delegated: return "app.fill"
        case .publicWithKey: return "key.fill"
        }
    }
}

// MARK: - Vault Item

struct VaultItem: Identifiable, Codable {
    let id: UUID
    var name: String
    var metadata: VaultMetadata
    var encryptedPath: URL
    var size: Int64
    var createdAt: Date
    var updatedAt: Date
    var tags: [String]
    var timeLockConfig: TimeLockConfig?
    var accessControl: VaultAccessControl

    var sourceApp: String? { metadata.sourceApp }

    var isLocked: Bool {
        guard let config = timeLockConfig else { return false }
        return config.isCurrentlyLocked
    }

    var requiresBiometric: Bool {
        accessControl == .biometricRequired
    }

    var formattedSize: String {
        ByteCountFormatter.string(fromByteCount: size, countStyle: .file)
    }

    func matches(query: String) -> Bool {
        let lowercasedQuery = query.lowercased()
        if name.lowercased().contains(lowercasedQuery) { return true }
        if tags.contains(where: { $0.lowercased().contains(lowercasedQuery) }) { return true }
        if let app = sourceApp, app.lowercased().contains(lowercasedQuery) { return true }
        return false
    }
}

// MARK: - Vault Metadata

struct VaultMetadata: Codable {
    var sourceApp: String?
    var originalFileName: String?
    var mimeType: String?
    var checksum: String
    var encryptionAlgorithm: String
    var keyVersion: Int
    var originalCreatedAt: Date?
    var customMetadata: [String: String]
    var contentType: VaultItemType

    init(
        sourceApp: String? = nil,
        originalFileName: String? = nil,
        mimeType: String? = nil,
        checksum: String,
        encryptionAlgorithm: String = "AES-256-GCM",
        keyVersion: Int = 1,
        originalCreatedAt: Date? = nil,
        customMetadata: [String: String] = [:],
        contentType: VaultItemType = .file
    ) {
        self.sourceApp = sourceApp
        self.originalFileName = originalFileName
        self.mimeType = mimeType
        self.checksum = checksum
        self.encryptionAlgorithm = encryptionAlgorithm
        self.keyVersion = keyVersion
        self.originalCreatedAt = originalCreatedAt
        self.customMetadata = customMetadata
        self.contentType = contentType
    }

    init(sourceApp: String? = nil, originalFileName: String? = nil, data: Data, contentType: VaultItemType = .file) {
        self.sourceApp = sourceApp
        self.originalFileName = originalFileName
        self.mimeType = contentType.defaultMimeType
        self.checksum = VaultMetadata.computeChecksum(data)
        self.encryptionAlgorithm = "AES-256-GCM"
        self.keyVersion = 1
        self.originalCreatedAt = nil
        self.customMetadata = [:]
        self.contentType = contentType
    }

    var isFromKnownApp: Bool {
        guard let app = sourceApp else { return false }
        let knownApps = ["AniSeekr", "MyGame", "Solidarity", "Twitter", "Google"]
        return knownApps.contains(where: { app.lowercased().contains($0.lowercased()) })
    }

    var contentDescription: String {
        if let app = sourceApp { return "From \(app)" }
        return contentType.displayName
    }

    func verifyChecksum(_ data: Data) -> Bool {
        VaultMetadata.computeChecksum(data).lowercased() == checksum.lowercased()
    }

    static func computeChecksum(_ data: Data) -> String {
        let hash = SHA256.hash(data: data)
        return hash.compactMap { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Cloud Item Metadata

struct CloudItemMetadata: Codable, Identifiable {
    var id: String { fileName }
    let fileName: String
    let size: Int64
    let modifiedAt: Date
    let isDownloaded: Bool
    let downloadProgress: Double?
}

// MARK: - Conflict Resolution

enum ConflictResolution: String, Codable {
    case keepLocal, keepCloud, keepBoth, merge

    var displayName: String {
        switch self {
        case .keepLocal: return "Keep Local"
        case .keepCloud: return "Keep Cloud"
        case .keepBoth: return "Keep Both"
        case .merge: return "Merge"
        }
    }
}
