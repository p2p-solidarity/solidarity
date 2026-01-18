//
//  SovereignVaultService.swift
//  airmeishi
//
//  Main service for The Sovereign Vault - manages encrypted local storage
//

import Foundation
import Combine

@MainActor
final class SovereignVaultService: ObservableObject {
    static let shared = SovereignVaultService()

    // MARK: - Published Properties

    @Published private(set) var items: [VaultItem] = []
    @Published private(set) var totalSize: Int64 = 0
    @Published private(set) var isSyncing = false
    @Published private(set) var syncError: String?

    // MARK: - Private Properties

    private let encryption = FileEncryptionService.shared
    private let fileManager = FileManager.default
    private var cancellables = Set<AnyCancellable>()

    private var vaultDirectoryURL: URL {
        let documents = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return documents.appendingPathComponent("SovereignVault", isDirectory: true)
    }

    private var metadataURL: URL {
        vaultDirectoryURL.appendingPathComponent("vault_metadata.json")
    }

    // MARK: - Initialization

    private init() {
        setupVaultDirectory()
        loadMetadata()
    }

    // MARK: - Public API

    /// Import a file into the vault
    func importFile(
        _ sourceURL: URL,
        name: String?,
        tags: [String] = [],
        timeLock: TimeLockConfig? = nil,
        accessControl: VaultAccessControl = .privateOnly
    ) async throws -> VaultItem {
        let fileName = name ?? sourceURL.lastPathComponent
        let contentType = VaultItemType.from(mimeType: mimeTypeForFile(at: sourceURL))

        let data = try Data(contentsOf: sourceURL)
        let checksum = encryption.computeChecksum(data)

        let metadata = VaultMetadata(
            sourceApp: nil,
            originalFileName: sourceURL.lastPathComponent,
            data: data,
            contentType: contentType
        )

        let itemId = UUID()
        let encryptedFileName = "\(itemId.uuidString).encrypted"
        let encryptedURL = vaultDirectoryURL.appendingPathComponent(encryptedFileName)

        let result = try await encryption.encryptData(data)
        try result.encryptedData.write(to: encryptedURL)

        let item = VaultItem(
            id: itemId,
            name: fileName,
            metadata: metadata,
            encryptedPath: encryptedURL,
            size: Int64(data.count),
            createdAt: Date(),
            updatedAt: Date(),
            tags: tags,
            timeLockConfig: timeLock,
            accessControl: accessControl
        )

        items.append(item)
        updateTotalSize()
        saveMetadata()

        return item
    }

    /// Import data directly into the vault
    func importData(
        _ data: Data,
        name: String,
        contentType: VaultItemType = .file,
        tags: [String] = [],
        timeLock: TimeLockConfig? = nil,
        accessControl: VaultAccessControl = .privateOnly,
        sourceApp: String? = nil
    ) async throws -> VaultItem {
        let itemId = UUID()
        let encryptedFileName = "\(itemId.uuidString).encrypted"
        let encryptedURL = vaultDirectoryURL.appendingPathComponent(encryptedFileName)

        let result = try await encryption.encryptData(data)
        try result.encryptedData.write(to: encryptedURL)

        let metadata = VaultMetadata(
            sourceApp: sourceApp,
            originalFileName: name,
            data: data,
            contentType: contentType
        )

        let item = VaultItem(
            id: itemId,
            name: name,
            metadata: metadata,
            encryptedPath: encryptedURL,
            size: Int64(data.count),
            createdAt: Date(),
            updatedAt: Date(),
            tags: tags,
            timeLockConfig: timeLock,
            accessControl: accessControl
        )

        items.append(item)
        updateTotalSize()
        saveMetadata()

        return item
    }

    /// Export an item from the vault
    func exportItem(_ itemId: UUID, to destinationURL: URL) async throws {
        guard let item = items.first(where: { $0.id == itemId }) else {
            throw VaultServiceError.itemNotFound
        }

        let decryptedData = try await encryption.decryptData(Data(contentsOf: item.encryptedPath))
        try decryptedData.write(to: destinationURL)
    }

    /// Get decrypted data for an item
    func getDecryptedData(_ itemId: UUID) async throws -> Data {
        guard let item = items.first(where: { $0.id == itemId }) else {
            throw VaultServiceError.itemNotFound
        }

        return try await encryption.decryptData(Data(contentsOf: item.encryptedPath))
    }

    /// Delete an item from the vault
    func deleteItem(_ itemId: UUID) async throws {
        guard let index = items.firstIndex(where: { $0.id == itemId }) else {
            throw VaultServiceError.itemNotFound
        }

        let item = items[index]

        try fileManager.removeItem(at: item.encryptedPath)
        items.remove(at: index)

        updateTotalSize()
        saveMetadata()
    }

    /// Update time lock configuration
    func updateTimeLock(_ itemId: UUID, config: TimeLockConfig?) async throws {
        guard let index = items.firstIndex(where: { $0.id == itemId }) else {
            throw VaultServiceError.itemNotFound
        }

        items[index].timeLockConfig = config
        items[index].updatedAt = Date()

        if config != nil {
            items[index].accessControl = .timeLocked
        }

        saveMetadata()
    }

    /// Update access control
    func updateAccessControl(_ itemId: UUID, control: VaultAccessControl) async throws {
        guard let index = items.firstIndex(where: { $0.id == itemId }) else {
            throw VaultServiceError.itemNotFound
        }

        items[index].accessControl = control
        items[index].updatedAt = Date()
        saveMetadata()
    }

    /// Add tags to an item
    func addTags(_ itemId: UUID, tags: [String]) async throws {
        guard let index = items.firstIndex(where: { $0.id == itemId }) else {
            throw VaultServiceError.itemNotFound
        }

        let existingTags = Set(items[index].tags)
        let newTags = tags.filter { !existingTags.contains($0) }
        items[index].tags.append(contentsOf: newTags)
        items[index].updatedAt = Date()
        saveMetadata()
    }

    /// Remove tags from an item
    func removeTags(_ itemId: UUID, tags: [String]) async throws {
        guard let index = items.firstIndex(where: { $0.id == itemId }) else {
            throw VaultServiceError.itemNotFound
        }

        let tagsToRemove = Set(tags)
        items[index].tags.removeAll { tagsToRemove.contains($0) }
        items[index].updatedAt = Date()
        saveMetadata()
    }

    /// Rename an item
    func renameItem(_ itemId: UUID, newName: String) async throws {
        guard let index = items.firstIndex(where: { $0.id == itemId }) else {
            throw VaultServiceError.itemNotFound
        }

        items[index].name = newName
        items[index].updatedAt = Date()
        saveMetadata()
    }

    /// Search items
    func searchItems(query: String) -> [VaultItem] {
        guard !query.isEmpty else { return items }
        return items.filter { $0.matches(query: query) }
    }

    /// Get items by tag
    func items(withTag tag: String) -> [VaultItem] {
        items.filter { $0.tags.contains(tag) }
    }

    /// Get items by source app
    func items(fromApp app: String) -> [VaultItem] {
        items.filter { $0.sourceApp?.lowercased() == app.lowercased() }
    }

    /// Get locked items
    func lockedItems() -> [VaultItem] {
        items.filter { $0.isLocked }
    }

    /// Get recently added items
    func recentItems(limit: Int = 10) -> [VaultItem] {
        Array(items.sorted { $0.createdAt > $1.createdAt }.prefix(limit))
    }

    /// Get total item count
    var itemCount: Int { items.count }

    /// Format total size
    var formattedTotalSize: String {
        ByteCountFormatter.string(fromByteCount: totalSize, countStyle: .file)
    }

    // MARK: - Private Methods

    private func setupVaultDirectory() {
        if !fileManager.fileExists(atPath: vaultDirectoryURL.path) {
            try? fileManager.createDirectory(at: vaultDirectoryURL, withIntermediateDirectories: true)
        }
    }

    private func loadMetadata() {
        guard fileManager.fileExists(atPath: metadataURL.path) else { return }

        do {
            let data = try Data(contentsOf: metadataURL)
            items = try JSONDecoder().decode([VaultItem].self, from: data)
            updateTotalSize()
        } catch {
            print("Failed to load vault metadata: \(error)")
        }
    }

    private func saveMetadata() {
        do {
            let data = try JSONEncoder().encode(items)
            try data.write(to: metadataURL)
        } catch {
            print("Failed to save vault metadata: \(error)")
        }
    }

    private func updateTotalSize() {
        totalSize = items.reduce(0) { $0 + $1.size }
    }

    private func mimeTypeForFile(at url: URL) -> String {
        let path = url.path
        let ext = (url.pathExtension as NSString).pathExtension.lowercased()

        switch ext {
        case "png", "jpg", "jpeg", "gif", "heic": return "image/\(ext)"
        case "mp4", "mov", "avi": return "video/\(ext)"
        case "json": return "application/json"
        case "txt": return "text/plain"
        case "pdf": return "application/pdf"
        default: return "application/octet-stream"
        }
    }
}

// MARK: - Errors

enum VaultServiceError: LocalizedError {
    case itemNotFound
    case exportFailed(String)
    case importFailed(String)
    case syncFailed(String)

    var errorDescription: String? {
        switch self {
        case .itemNotFound: return "Vault item not found"
        case .exportFailed(let reason): return "Export failed: \(reason)"
        case .importFailed(let reason): return "Import failed: \(reason)"
        case .syncFailed(let reason): return "Sync failed: \(reason)"
        }
    }
}
