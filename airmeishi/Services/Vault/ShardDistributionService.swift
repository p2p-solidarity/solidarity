//
//  ShardDistributionService.swift
//  airmeishi
//
//  AirDrop and QR-based key shard distribution for digital inheritance
//

import Foundation
import CryptoKit
import CoreImage.CIFilterBuiltins
import UIKit

// MARK: - Shard Distribution Service

@MainActor
final class ShardDistributionService: ObservableObject {
    static let shared = ShardDistributionService()

    // MARK: - Published Properties

    @Published private(set) var distributedShards: [DistributedShardRecord] = []
    @Published private(set) var receivedShards: [ReceivedShard] = []
    @Published private(set) var pendingRecoveries: [RecoverySession] = []

    // MARK: - Private Properties

    private let userDefaults = UserDefaults.standard
    private let distributedKey = "com.solidarity.vault.distributedShards"
    private let receivedKey = "com.solidarity.vault.receivedShards"
    private let context = CIContext()

    // MARK: - Initialization

    private init() {
        loadDistributedShards()
        loadReceivedShards()
    }

    // MARK: - Shard Distribution

    /// Create a shareable package for a shard (for AirDrop/QR)
    func createShardPackage(
        shard: EncryptedKeyShard,
        itemName: String,
        recipientName: String
    ) -> ShardPackage {
        let package = ShardPackage(
            packageId: UUID(),
            shardIndex: shard.shardIndex,
            encryptedData: shard.encryptedData,
            recipientContactId: shard.recipientContactId,
            itemName: itemName,
            recipientName: recipientName,
            createdAt: Date(),
            expiresAt: Date().addingTimeInterval(7 * 24 * 60 * 60) // 7 days
        )

        return package
    }

    /// Generate QR code for a shard package
    func generateQRCode(for package: ShardPackage, size: CGFloat = 250) -> UIImage? {
        guard let data = try? JSONEncoder().encode(package),
              let compressed = try? compress(data) else {
            return nil
        }

        let base64 = compressed.base64EncodedString()
        let urlString = "airmeishi://shard?data=\(base64)"

        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(urlString.utf8)
        filter.correctionLevel = "M"

        guard let outputImage = filter.outputImage else { return nil }

        let scale = size / outputImage.extent.width
        let scaledImage = outputImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))

        guard let cgImage = context.createCGImage(scaledImage, from: scaledImage.extent) else {
            return nil
        }

        return UIImage(cgImage: cgImage)
    }

    /// Parse received shard from URL
    func parseShardFromURL(_ url: URL) -> ShardPackage? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let dataParam = components.queryItems?.first(where: { $0.name == "data" })?.value,
              let compressedData = Data(base64Encoded: dataParam),
              let decompressedData = try? decompress(compressedData),
              let package = try? JSONDecoder().decode(ShardPackage.self, from: decompressedData) else {
            return nil
        }

        return package
    }

    /// Record that a shard was distributed
    func recordDistribution(
        shard: EncryptedKeyShard,
        itemId: UUID,
        itemName: String,
        recipientName: String,
        method: DistributionMethod
    ) {
        let record = DistributedShardRecord(
            id: UUID(),
            shardId: shard.id,
            shardIndex: shard.shardIndex,
            itemId: itemId,
            itemName: itemName,
            recipientContactId: shard.recipientContactId,
            recipientName: recipientName,
            distributedAt: Date(),
            method: method,
            acknowledged: false
        )

        distributedShards.append(record)
        saveDistributedShards()
    }

    /// Mark a shard as acknowledged by recipient
    func acknowledgeDistribution(shardId: UUID) {
        guard let index = distributedShards.firstIndex(where: { $0.shardId == shardId }) else {
            return
        }
        distributedShards[index].acknowledged = true
        distributedShards[index].acknowledgedAt = Date()
        saveDistributedShards()
    }

    // MARK: - Shard Reception

    /// Store a received shard
    func storeReceivedShard(_ package: ShardPackage) {
        let received = ReceivedShard(
            id: package.packageId,
            shardIndex: package.shardIndex,
            encryptedData: package.encryptedData,
            itemName: package.itemName,
            senderName: package.recipientName, // This is from me to them
            receivedAt: Date(),
            usedForRecovery: false
        )

        if !receivedShards.contains(where: { $0.id == received.id }) {
            receivedShards.append(received)
            saveReceivedShards()
        }
    }

    /// Get shards for a specific item (by matching item name)
    func shardsForItem(named itemName: String) -> [ReceivedShard] {
        receivedShards.filter { $0.itemName == itemName }
    }

    // MARK: - Recovery Flow

    /// Start a recovery session
    func startRecoverySession(itemName: String, requiredShards: Int) -> RecoverySession {
        let session = RecoverySession(
            sessionId: UUID(),
            itemName: itemName,
            requiredShards: requiredShards,
            collectedShards: [],
            status: .collecting,
            startedAt: Date()
        )

        pendingRecoveries.append(session)
        return session
    }

    /// Add a shard to a recovery session
    func addShardToRecovery(sessionId: UUID, shard: ReceivedShard) throws {
        guard let index = pendingRecoveries.firstIndex(where: { $0.sessionId == sessionId }) else {
            throw RecoveryError.sessionNotFound
        }

        guard pendingRecoveries[index].status == .collecting else {
            throw RecoveryError.sessionNotActive
        }

        // Check if shard already added
        if pendingRecoveries[index].collectedShards.contains(where: { $0.shardIndex == shard.shardIndex }) {
            throw RecoveryError.duplicateShard
        }

        pendingRecoveries[index].collectedShards.append(shard)

        // Check if we have enough
        if pendingRecoveries[index].collectedShards.count >= pendingRecoveries[index].requiredShards {
            pendingRecoveries[index].status = .ready
        }
    }

    /// Complete recovery and reconstruct key
    func completeRecovery(sessionId: UUID) throws -> Data {
        guard let index = pendingRecoveries.firstIndex(where: { $0.sessionId == sessionId }) else {
            throw RecoveryError.sessionNotFound
        }

        guard pendingRecoveries[index].status == .ready else {
            throw RecoveryError.insufficientShards
        }

        // Convert collected shards to SecretShares
        let shares = pendingRecoveries[index].collectedShards.map { shard in
            SecretShare(
                index: shard.shardIndex,
                value: shard.encryptedData,
                threshold: pendingRecoveries[index].requiredShards,
                totalShares: pendingRecoveries[index].requiredShards + 1,
                checksum: computeChecksum(shard.shardIndex, shard.encryptedData)
            )
        }

        // Reconstruct using Shamir
        let reconstructedKey = try ShamirSecretSharing.combine(shares: shares)

        // Mark session as complete
        pendingRecoveries[index].status = .completed
        pendingRecoveries[index].completedAt = Date()

        // Mark shards as used
        for shard in pendingRecoveries[index].collectedShards {
            if let shardIndex = receivedShards.firstIndex(where: { $0.id == shard.id }) {
                receivedShards[shardIndex].usedForRecovery = true
            }
        }
        saveReceivedShards()

        return reconstructedKey
    }

    /// Cancel a recovery session
    func cancelRecovery(sessionId: UUID) {
        pendingRecoveries.removeAll { $0.sessionId == sessionId }
    }

    // MARK: - Export for AirDrop

    /// Create a file URL for AirDrop sharing
    func createAirDropFile(for package: ShardPackage) -> URL? {
        guard let data = try? JSONEncoder().encode(package) else {
            return nil
        }

        let filename = "shard_\(package.shardIndex)_\(package.itemName).solidarity"
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(filename)

        do {
            try data.write(to: tempURL)
            return tempURL
        } catch {
            return nil
        }
    }

    /// Import shard from AirDrop file
    func importAirDropFile(from url: URL) -> ShardPackage? {
        guard let data = try? Data(contentsOf: url),
              let package = try? JSONDecoder().decode(ShardPackage.self, from: data) else {
            return nil
        }

        return package
    }

    // MARK: - Private Methods

    private func loadDistributedShards() {
        guard let data = userDefaults.data(forKey: distributedKey),
              let records = try? JSONDecoder().decode([DistributedShardRecord].self, from: data) else {
            return
        }
        distributedShards = records
    }

    private func saveDistributedShards() {
        if let data = try? JSONEncoder().encode(distributedShards) {
            userDefaults.set(data, forKey: distributedKey)
        }
    }

    private func loadReceivedShards() {
        guard let data = userDefaults.data(forKey: receivedKey),
              let shards = try? JSONDecoder().decode([ReceivedShard].self, from: data) else {
            return
        }
        receivedShards = shards
    }

    private func saveReceivedShards() {
        if let data = try? JSONEncoder().encode(receivedShards) {
            userDefaults.set(data, forKey: receivedKey)
        }
    }

    private func compress(_ data: Data) throws -> Data {
        // Simple compression - in production use proper compression
        data
    }

    private func decompress(_ data: Data) throws -> Data {
        data
    }

    private func computeChecksum(_ index: Int, _ data: Data) -> String {
        var hashData = Data()
        hashData.append(UInt8(index))
        hashData.append(data)
        let hash = SHA256.hash(data: hashData)
        return hash.prefix(4).compactMap { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Data Models

struct ShardPackage: Codable, Identifiable {
    var id: UUID { packageId }
    let packageId: UUID
    let shardIndex: Int
    let encryptedData: Data
    let recipientContactId: UUID
    let itemName: String
    let recipientName: String
    let createdAt: Date
    let expiresAt: Date

    var isExpired: Bool {
        Date() > expiresAt
    }
}

struct DistributedShardRecord: Codable, Identifiable {
    let id: UUID
    let shardId: UUID
    let shardIndex: Int
    let itemId: UUID
    let itemName: String
    let recipientContactId: UUID
    let recipientName: String
    let distributedAt: Date
    let method: DistributionMethod
    var acknowledged: Bool
    var acknowledgedAt: Date?
}

enum DistributionMethod: String, Codable {
    case airDrop
    case qrCode
    case directShare

    var displayName: String {
        switch self {
        case .airDrop: return "AirDrop"
        case .qrCode: return "QR Code"
        case .directShare: return "Direct Share"
        }
    }

    var systemImage: String {
        switch self {
        case .airDrop: return "airplayaudio"
        case .qrCode: return "qrcode"
        case .directShare: return "person.line.dotted.person"
        }
    }
}

struct ReceivedShard: Codable, Identifiable {
    let id: UUID
    let shardIndex: Int
    let encryptedData: Data
    let itemName: String
    let senderName: String
    let receivedAt: Date
    var usedForRecovery: Bool
}

struct RecoverySession: Identifiable {
    var id: UUID { sessionId }
    let sessionId: UUID
    let itemName: String
    let requiredShards: Int
    var collectedShards: [ReceivedShard]
    var status: RecoveryStatus
    let startedAt: Date
    var completedAt: Date?

    var progress: Double {
        Double(collectedShards.count) / Double(requiredShards)
    }

    enum RecoveryStatus {
        case collecting
        case ready
        case completed
        case failed
    }
}

// MARK: - Errors

enum RecoveryError: LocalizedError {
    case sessionNotFound
    case sessionNotActive
    case duplicateShard
    case insufficientShards
    case reconstructionFailed

    var errorDescription: String? {
        switch self {
        case .sessionNotFound: return "Recovery session not found"
        case .sessionNotActive: return "Recovery session is not active"
        case .duplicateShard: return "This shard has already been added"
        case .insufficientShards: return "Not enough shards to complete recovery"
        case .reconstructionFailed: return "Failed to reconstruct the key"
        }
    }
}
