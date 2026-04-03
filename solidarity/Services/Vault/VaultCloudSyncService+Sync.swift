//
//  VaultCloudSyncService+Sync.swift
//  solidarity
//

import Foundation

extension VaultCloudSyncService {

    func ensureCloudDirectoryExists() throws {
        guard let cloudURL = cloudContainerURL else {
            throw VaultSyncError.cloudNotAvailable
        }

        if !fileManager.fileExists(atPath: cloudURL.path) {
            try fileManager.createDirectory(at: cloudURL, withIntermediateDirectories: true)
        }
    }

    func loadLocalManifest() throws -> SyncManifest {
        let manifestURL = localVaultURL.appendingPathComponent(".sync_manifest.json")

        if fileManager.fileExists(atPath: manifestURL.path) {
            let data = try Data(contentsOf: manifestURL)
            return try JSONDecoder().decode(SyncManifest.self, from: data)
        }

        return SyncManifest(items: [:], lastSync: nil)
    }

    func loadCloudManifest() async throws -> SyncManifest {
        guard let manifestURL = syncManifestURL else {
            return SyncManifest(items: [:], lastSync: nil)
        }

        // Trigger download if needed
        if fileManager.fileExists(atPath: manifestURL.path) {
            try? fileManager.startDownloadingUbiquitousItem(at: manifestURL)

            // Wait for download
            var attempts = 0
            while attempts < 10 {
                let resourceValues = try? manifestURL.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey])
                if resourceValues?.ubiquitousItemDownloadingStatus == .current {
                    break
                }
                try await Task.sleep(nanoseconds: 500_000_000)
                attempts += 1
            }

            let data = try Data(contentsOf: manifestURL)
            return try JSONDecoder().decode(SyncManifest.self, from: data)
        }

        return SyncManifest(items: [:], lastSync: nil)
    }

    func computeSyncChanges(local: SyncManifest, cloud: SyncManifest) -> SyncChanges {
        var toUpload: [UUID] = []
        var toDownload: [UUID] = []
        var toDelete: [UUID] = []
        var conflicts: [VaultConflict] = []

        let allItemIds = Set(local.items.keys).union(Set(cloud.items.keys))

        for itemId in allItemIds {
            let localEntry = local.items[itemId]
            let cloudEntry = cloud.items[itemId]

            switch (localEntry, cloudEntry) {
            case (let local?, nil):
                // Only exists locally - upload
                if !local.isDeleted {
                    toUpload.append(itemId)
                }

            case (nil, let cloud?):
                // Only exists in cloud - download
                if !cloud.isDeleted {
                    toDownload.append(itemId)
                }

            case (let local?, let cloud?):
                // Exists in both - check for conflicts
                if local.isDeleted && !cloud.isDeleted {
                    toDelete.append(itemId)
                } else if !local.isDeleted && cloud.isDeleted {
                    toUpload.append(itemId)
                } else if local.modifiedAt != cloud.modifiedAt {
                    conflicts.append(VaultConflict(
                        itemId: itemId,
                        localModified: local.modifiedAt,
                        cloudModified: cloud.modifiedAt,
                        localChecksum: local.checksum,
                        cloudChecksum: cloud.checksum
                    ))
                }

            case (nil, nil):
                break
            }
        }

        return SyncChanges(
            toUpload: toUpload,
            toDownload: toDownload,
            toDelete: toDelete,
            conflicts: conflicts
        )
    }

    func uploadChanges(_ itemIds: [UUID]) async throws {
        for itemId in itemIds {
            try await uploadItem(itemId)
        }
    }

    func downloadChanges(_ itemIds: [UUID]) async throws {
        for itemId in itemIds {
            try await downloadItem(itemId)
        }
    }

    func processDeletions(_ itemIds: [UUID]) async throws {
        guard let cloudURL = cloudContainerURL else { return }

        for itemId in itemIds {
            let cloudItemURL = cloudURL.appendingPathComponent("\(itemId.uuidString).encrypted")
            let metadataURL = cloudURL.appendingPathComponent("\(itemId.uuidString).meta.json")

            try? fileManager.removeItem(at: cloudItemURL)
            try? fileManager.removeItem(at: metadataURL)
        }
    }

    func saveManifests(localManifest: SyncManifest, cloudManifest: SyncManifest) async throws {
        var updatedManifest = SyncManifest(items: [:], lastSync: Date())

        // Build manifest from current vault items
        for item in vault.items {
            updatedManifest.items[item.id] = SyncManifestEntry(
                modifiedAt: item.updatedAt,
                checksum: item.metadata.checksum,
                isDeleted: false
            )
        }

        // Save local manifest
        let localManifestURL = localVaultURL.appendingPathComponent(".sync_manifest.json")
        let data = try JSONEncoder().encode(updatedManifest)
        try data.write(to: localManifestURL)

        // Save cloud manifest
        if let cloudManifestURL = syncManifestURL {
            try data.write(to: cloudManifestURL)
        }
    }

    func createDuplicateItem(for itemId: UUID, suffix: String) async throws {
        guard let item = vault.items.first(where: { $0.id == itemId }) else { return }

        // Read encrypted data
        let data = try Data(contentsOf: item.encryptedPath)

        // Import as new item with suffix
        _ = try await vault.importData(
            data,
            name: "\(item.name)\(suffix)",
            contentType: item.metadata.contentType,
            tags: item.tags,
            sourceApp: item.sourceApp
        )
    }
}

// MARK: - Supporting Types

struct SyncManifest: Codable {
    var items: [UUID: SyncManifestEntry]
    var lastSync: Date?
}

struct SyncManifestEntry: Codable {
    let modifiedAt: Date
    let checksum: String
    var isDeleted: Bool
}

struct SyncChanges {
    let toUpload: [UUID]
    let toDownload: [UUID]
    let toDelete: [UUID]
    let conflicts: [VaultConflict]
}

struct VaultConflict: Identifiable {
    var id: UUID { itemId }
    let itemId: UUID
    let localModified: Date
    let cloudModified: Date
    let localChecksum: String
    let cloudChecksum: String

    var isIdentical: Bool {
        localChecksum == cloudChecksum
    }
}

struct CloudStorageInfo {
    let totalSize: Int64
    let itemCount: Int
    let lastSync: Date?
    let isAvailable: Bool

    var formattedSize: String {
        ByteCountFormatter.string(fromByteCount: totalSize, countStyle: .file)
    }
}

enum SyncStatus: Equatable {
    case idle
    case syncing
    case synced
    case conflictsExist
    case error(String)

    var displayName: String {
        switch self {
        case .idle: return "Not synced"
        case .syncing: return "Syncing..."
        case .synced: return "Synced"
        case .conflictsExist: return "Conflicts"
        case .error(let msg): return "Error: \(msg)"
        }
    }
}

// MARK: - Errors

enum VaultSyncError: LocalizedError {
    case cloudNotAvailable
    case itemNotFound
    case cloudItemNotFound
    case syncFailed(String)

    var errorDescription: String? {
        switch self {
        case .cloudNotAvailable:
            return "iCloud is not available. Please sign in to iCloud in Settings."
        case .itemNotFound:
            return "Vault item not found"
        case .cloudItemNotFound:
            return "Item not found in iCloud"
        case .syncFailed(let reason):
            return "Sync failed: \(reason)"
        }
    }
}
