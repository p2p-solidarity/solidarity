//
//  ShardDistributionService+Recovery.swift
//  solidarity
//

import Foundation
import CryptoKit

// MARK: - Recovery Flow

extension ShardDistributionService {

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

    func addShardToRecovery(sessionId: UUID, shard: ReceivedShard) throws {
        guard let index = pendingRecoveries.firstIndex(where: { $0.sessionId == sessionId }) else {
            throw RecoveryError.sessionNotFound
        }

        guard pendingRecoveries[index].status == .collecting else {
            throw RecoveryError.sessionNotActive
        }

        if pendingRecoveries[index].collectedShards.contains(where: { $0.shardIndex == shard.shardIndex }) {
            throw RecoveryError.duplicateShard
        }

        pendingRecoveries[index].collectedShards.append(shard)

        if pendingRecoveries[index].collectedShards.count >= pendingRecoveries[index].requiredShards {
            pendingRecoveries[index].status = .ready
        }
    }

    func completeRecovery(sessionId: UUID) throws -> Data {
        guard let index = pendingRecoveries.firstIndex(where: { $0.sessionId == sessionId }) else {
            throw RecoveryError.sessionNotFound
        }

        guard pendingRecoveries[index].status == .ready else {
            throw RecoveryError.insufficientShards
        }

        let shares = pendingRecoveries[index].collectedShards.map { shard in
            SecretShare(
                index: shard.shardIndex,
                value: shard.encryptedData,
                threshold: pendingRecoveries[index].requiredShards,
                totalShares: pendingRecoveries[index].requiredShards + 1,
                checksum: computeChecksum(shard.shardIndex, shard.encryptedData)
            )
        }

        let reconstructedKey = try ShamirSecretSharing.combine(shares: shares)

        pendingRecoveries[index].status = .completed
        pendingRecoveries[index].completedAt = Date()

        for shard in pendingRecoveries[index].collectedShards {
            if let shardIndex = receivedShards.firstIndex(where: { $0.id == shard.id }) {
                receivedShards[shardIndex].usedForRecovery = true
            }
        }
        saveReceivedShards()

        return reconstructedKey
    }

    func cancelRecovery(sessionId: UUID) {
        pendingRecoveries.removeAll { $0.sessionId == sessionId }
    }

    // MARK: - AirDrop Export/Import

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

    func importAirDropFile(from url: URL) -> ShardPackage? {
        guard let data = try? Data(contentsOf: url),
              let package = try? JSONDecoder().decode(ShardPackage.self, from: data) else {
            return nil
        }

        return package
    }

    // MARK: - Persistence

    func loadDistributedShards() {
        guard let data = userDefaults.data(forKey: distributedKey),
              let records = try? JSONDecoder().decode([DistributedShardRecord].self, from: data) else {
            return
        }
        distributedShards = records
    }

    func saveDistributedShards() {
        if let data = try? JSONEncoder().encode(distributedShards) {
            userDefaults.set(data, forKey: distributedKey)
        }
    }

    func loadReceivedShards() {
        guard let data = userDefaults.data(forKey: receivedKey),
              let shards = try? JSONDecoder().decode([ReceivedShard].self, from: data) else {
            return
        }
        receivedShards = shards
    }

    func saveReceivedShards() {
        if let data = try? JSONEncoder().encode(receivedShards) {
            userDefaults.set(data, forKey: receivedKey)
        }
    }

    func compress(_ data: Data) throws -> Data {
        data
    }

    func decompress(_ data: Data) throws -> Data {
        data
    }

    func computeChecksum(_ index: Int, _ data: Data) -> String {
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
