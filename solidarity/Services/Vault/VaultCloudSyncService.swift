//
//  VaultCloudSyncService.swift
//  solidarity
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

    // MARK: - Internal Properties

    let fileManager = FileManager.default
    let vault = SovereignVaultService.shared
    private var cancellables = Set<AnyCancellable>()

    var cloudContainerURL: URL? {
        fileManager.url(forUbiquityContainerIdentifier: nil)?
            .appendingPathComponent("Documents", isDirectory: true)
            .appendingPathComponent("SovereignVault", isDirectory: true)
    }

    var localVaultURL: URL {
        fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("SovereignVault", isDirectory: true)
    }

    var syncManifestURL: URL? {
        cloudContainerURL?.appendingPathComponent(".sync_manifest.json")
    }

    // MARK: - Initialization

    private init() {
        checkCloudAvailability()
        setupCloudObserver()
    }

    // MARK: - Public API

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

            // 4. Handle uploads (local -> cloud)
            try await uploadChanges(changes.toUpload)
            syncProgress = 0.5

            // 5. Handle downloads (cloud -> local)
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
            _ = try Data(contentsOf: metadataURL)
            // Item will be loaded from vault metadata on next load
        }
    }

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
}

