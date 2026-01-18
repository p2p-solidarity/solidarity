//
//  VaultCloudSyncService.swift
//  airmeishi
//
//  iCloud Drive sync for The Sovereign Vault
//  Ensures encrypted vault items are backed up to user's iCloud
//

import Foundation
import Combine

// MARK: - Cloud Sync Service

@MainActor
final class VaultCloudSyncService: ObservableObject {
    static let shared = VaultCloudSyncService()

    // MARK: - Published Properties

    @Published private(set) var isSyncing = false
    @Published private(set) var lastSyncDate: Date?
    @Published private(set) var syncProgress: Double = 0
    @Published private(set) var pendingConflicts: [VaultConflict] = []
    @Published private(set) var syncStatus: SyncStatus = .idle
    @Published private(set) var isCloudAvailable = false

    // MARK: - Private Properties

    private let fileManager = FileManager.default
    private let vault = SovereignVaultService.shared
    private var cancellables = Set<AnyCancellable>()

    private var cloudContainerURL: URL? {
        fileManager.url(forUbiquityContainerIdentifier: nil)?
            .appendingPathComponent("Documents", isDirectory: true)
            .appendingPathComponent("SovereignVault", isDirectory: true)
    }

    private var localVaultURL: URL {
        fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("SovereignVault", isDirectory: true)
    }

    private var syncManifestURL: URL? {
        cloudContainerURL?.appendingPathComponent(".sync_manifest.json")
    }

    // MARK: - Initialization

    private init() {
        checkCloudAvailability()
        setupCloudObserver()
    }

    // MARK: - Public API

    /// Perform a full sync with iCloud Drive
    func performSync() async throws {
        guard isCloudAvailable else {
            throw VaultSyncError.cloudNotAvailable
        }
        guard !isSyncing else {
            return
        }

        isSyncing = true
        syncStatus = .syncing
        syncProgress = 0

        defer {
            isSyncing = false
            syncStatus = pendingConflicts.isEmpty ? .synced : .conflictsExist
        }

        do {
            // 1. Ensure cloud directory exists
            try ensureCloudDirectoryExists()
            syncProgress = 0.1

            // 2. Load manifests
            let localManifest = try loadLocalManifest()
            let cloudManifest = try await loadCloudManifest()
            syncProgress = 0.2

            // 3. Compute changes
            let changes = computeSyncChanges(local: localManifest, cloud: cloudManifest)
            syncProgress = 0.3

            // 4. Handle uploads (local → cloud)
            try await uploadChanges(changes.toUpload)
            syncProgress = 0.5

            // 5. Handle downloads (cloud → local)
            try await downloadChanges(changes.toDownload)
            syncProgress = 0.7

            // 6. Handle deletions
            try await processDeletions(changes.toDelete)
            syncProgress = 0.8

            // 7. Handle conflicts
            pendingConflicts = changes.conflicts
            syncProgress = 0.9

            // 8. Save updated manifest
            try await saveManifests(localManifest: localManifest, cloudManifest: cloudManifest)
            syncProgress = 1.0

            lastSyncDate = Date()

        } catch {
            syncStatus = .error(error.localizedDescription)
            throw error
        }
    }

    /// Upload a specific item to cloud
    func uploadItem(_ itemId: UUID) async throws {
        guard isCloudAvailable, let cloudURL = cloudContainerURL else {
            throw VaultSyncError.cloudNotAvailable
        }

        guard let item = vault.items.first(where: { $0.id == itemId }) else {
            throw VaultSyncError.itemNotFound
        }

        let cloudItemURL = cloudURL.appendingPathComponent("\(item.id.uuidString).encrypted")

        // Copy the encrypted file to cloud
        try fileManager.copyItem(at: item.encryptedPath, to: cloudItemURL)

        // Save metadata alongside
        let metadataURL = cloudURL.appendingPathComponent("\(item.id.uuidString).meta.json")
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let metadataData = try encoder.encode(item)
        try metadataData.write(to: metadataURL)
    }

    /// Download a specific item from cloud
    func downloadItem(_ itemId: UUID) async throws {
        guard isCloudAvailable, let cloudURL = cloudContainerURL else {
            throw VaultSyncError.cloudNotAvailable
        }

        let cloudItemURL = cloudURL.appendingPathComponent("\(itemId.uuidString).encrypted")
        let metadataURL = cloudURL.appendingPathComponent("\(itemId.uuidString).meta.json")

        guard fileManager.fileExists(atPath: cloudItemURL.path) else {
            throw VaultSyncError.cloudItemNotFound
        }

        // Download to local vault
        let localItemURL = localVaultURL.appendingPathComponent("\(itemId.uuidString).encrypted")
        try fileManager.copyItem(at: cloudItemURL, to: localItemURL)

        // Load and register item if metadata exists
        if fileManager.fileExists(atPath: metadataURL.path) {
            let metadataData = try Data(contentsOf: metadataURL)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            // Item will be loaded from vault metadata on next load
        }
    }

    /// Resolve a sync conflict
    func resolveConflict(_ conflict: VaultConflict, resolution: ConflictResolution) async throws {
        switch resolution {
        case .keepLocal:
            try await uploadItem(conflict.itemId)
        case .keepCloud:
            try await downloadItem(conflict.itemId)
        case .keepBoth:
            // Rename local item and download cloud version
            try await createDuplicateItem(for: conflict.itemId, suffix: "_local")
            try await downloadItem(conflict.itemId)
        case .merge:
            // For now, merge means keeping the newer one
            if conflict.localModified > conflict.cloudModified {
                try await uploadItem(conflict.itemId)
            } else {
                try await downloadItem(conflict.itemId)
            }
        }

        pendingConflicts.removeAll { $0.itemId == conflict.itemId }
    }

    /// Get cloud storage metadata
    func getCloudStorageInfo() async throws -> CloudStorageInfo {
        guard let cloudURL = cloudContainerURL else {
            throw VaultSyncError.cloudNotAvailable
        }

        var totalSize: Int64 = 0
        var itemCount = 0

        if let enumerator = fileManager.enumerator(at: cloudURL, includingPropertiesForKeys: [.fileSizeKey]) {
            while let fileURL = enumerator.nextObject() as? URL {
                if fileURL.pathExtension == "encrypted" {
                    let attributes = try fileURL.resourceValues(forKeys: [.fileSizeKey])
                    totalSize += Int64(attributes.fileSize ?? 0)
                    itemCount += 1
                }
            }
        }

        return CloudStorageInfo(
            totalSize: totalSize,
            itemCount: itemCount,
            lastSync: lastSyncDate,
            isAvailable: isCloudAvailable
        )
    }

    // MARK: - Private Methods

    private func checkCloudAvailability() {
        isCloudAvailable = fileManager.ubiquityIdentityToken != nil
    }

    private func setupCloudObserver() {
        NotificationCenter.default.publisher(for: NSNotification.Name.NSUbiquityIdentityDidChange)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.checkCloudAvailability()
            }
            .store(in: &cancellables)
    }

    private func ensureCloudDirectoryExists() throws {
        guard let cloudURL = cloudContainerURL else {
            throw VaultSyncError.cloudNotAvailable
        }

        if !fileManager.fileExists(atPath: cloudURL.path) {
            try fileManager.createDirectory(at: cloudURL, withIntermediateDirectories: true)
        }
    }

    private func loadLocalManifest() throws -> SyncManifest {
        let manifestURL = localVaultURL.appendingPathComponent(".sync_manifest.json")

        if fileManager.fileExists(atPath: manifestURL.path) {
            let data = try Data(contentsOf: manifestURL)
            return try JSONDecoder().decode(SyncManifest.self, from: data)
        }

        return SyncManifest(items: [:], lastSync: nil)
    }

    private func loadCloudManifest() async throws -> SyncManifest {
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

    private func computeSyncChanges(local: SyncManifest, cloud: SyncManifest) -> SyncChanges {
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

    private func uploadChanges(_ itemIds: [UUID]) async throws {
        for itemId in itemIds {
            try await uploadItem(itemId)
        }
    }

    private func downloadChanges(_ itemIds: [UUID]) async throws {
        for itemId in itemIds {
            try await downloadItem(itemId)
        }
    }

    private func processDeletions(_ itemIds: [UUID]) async throws {
        guard let cloudURL = cloudContainerURL else { return }

        for itemId in itemIds {
            let cloudItemURL = cloudURL.appendingPathComponent("\(itemId.uuidString).encrypted")
            let metadataURL = cloudURL.appendingPathComponent("\(itemId.uuidString).meta.json")

            try? fileManager.removeItem(at: cloudItemURL)
            try? fileManager.removeItem(at: metadataURL)
        }
    }

    private func saveManifests(localManifest: SyncManifest, cloudManifest: SyncManifest) async throws {
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

    private func createDuplicateItem(for itemId: UUID, suffix: String) async throws {
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
