//
//  ShardDistributionService+Recovery.swift
//  solidarity
//

import Foundation
import CryptoKit

// MARK: - Recovery Flow

extension ShardDistributionService {

    func startRecoverySession(itemName: String, requiredShards: Int, vaultId: UUID? = nil) -> RecoverySession {
        let session = RecoverySession(
            sessionId: UUID(),
            itemName: itemName,
            vaultId: vaultId,
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

    func completeRecovery(sessionId: UUID, expectedThreshold: Int? = nil) throws -> Data {
        guard let index = pendingRecoveries.firstIndex(where: { $0.sessionId == sessionId }) else {
            throw RecoveryError.sessionNotFound
        }

        guard pendingRecoveries[index].status == .ready else {
            throw RecoveryError.insufficientShards
        }

        let session = pendingRecoveries[index]
        // Threshold MUST come from authenticated state, not from the
        // attacker-controlled shard payload. Prefer caller-supplied value;
        // fall back to the session config; never trust shares[0].threshold.
        let threshold = expectedThreshold ?? session.requiredShards

        var openedShares: [SecretShare] = []
        var firstVaultId: UUID?
        for shard in session.collectedShards {
            let envelope: WrappedShardEnvelope
            do {
                envelope = try WrappedShardEnvelope.decode(shard.encryptedData)
            } catch {
                throw RecoveryError.shardAuthFailed(guardian: nil, shardIndex: shard.shardIndex)
            }

            if let expectedVault = session.vaultId, expectedVault != envelope.vaultId {
                throw RecoveryError.shardAuthFailed(guardian: envelope.guardianContactId, shardIndex: shard.shardIndex)
            }
            if let firstId = firstVaultId, firstId != envelope.vaultId {
                throw RecoveryError.shardAuthFailed(guardian: envelope.guardianContactId, shardIndex: shard.shardIndex)
            }
            firstVaultId = envelope.vaultId

            let wrapKey: SymmetricKey
            do {
                wrapKey = try ContentKeyExchangeService.shared.vaultWrapKey(
                    vaultId: envelope.vaultId,
                    createIfMissing: false
                )
            } catch {
                throw RecoveryError.shardAuthFailed(guardian: envelope.guardianContactId, shardIndex: shard.shardIndex)
            }

            let value: Data
            do {
                value = try envelope.openTrustingBindings(wrapKey: wrapKey, expectedThreshold: threshold)
            } catch {
                throw RecoveryError.shardAuthFailed(guardian: envelope.guardianContactId, shardIndex: shard.shardIndex)
            }

            openedShares.append(SecretShare(
                index: envelope.shardIndex,
                value: value,
                threshold: threshold,
                totalShares: max(threshold + 1, openedShares.count + 1),
                checksum: computeChecksum(envelope.shardIndex, value)
            ))
        }

        // Defense-in-depth: ensure all opened shares declare the same authenticated threshold.
        guard openedShares.allSatisfy({ $0.threshold == threshold }) else {
            throw RecoveryError.shardAuthFailed(guardian: nil, shardIndex: -1)
        }

        // ShamirSecretSharing.combine expects a uniform totalShares; align it.
        let normalizedTotal = openedShares.map(\.totalShares).max() ?? threshold + 1
        let normalizedShares = openedShares.map { share in
            SecretShare(
                index: share.index,
                value: share.value,
                threshold: threshold,
                totalShares: normalizedTotal,
                checksum: share.checksum
            )
        }

        let reconstructedKey = try ShamirSecretSharing.combine(shares: normalizedShares)

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
              let stored = try? JSONDecoder().decode([ReceivedShard].self, from: data) else {
            return
        }

        var hydrated: [ReceivedShard] = []
        for var shard in stored {
            do {
                if let payload = try VaultSecretsKeychain.loadData(
                    service: VaultSecretsKeychain.receivedShardsService,
                    account: shard.id.uuidString
                ) {
                    shard.encryptedData = payload
                } else if !shard.encryptedData.isEmpty {
                    try VaultSecretsKeychain.storeData(
                        shard.encryptedData,
                        service: VaultSecretsKeychain.receivedShardsService,
                        account: shard.id.uuidString
                    )
                    if !migratedShardIds.contains(shard.id) {
                        migratedShardIds.insert(shard.id)
                        print("[ShardDistribution] Migrated received shard \(shard.id) from UserDefaults to Keychain")
                    }
                }
            } catch {
                print("[ShardDistribution] Failed to hydrate received shard \(shard.id): \(error)")
            }
            hydrated.append(shard)
        }
        receivedShards = hydrated
        saveReceivedShards()
    }

    func saveReceivedShards() {
        for shard in receivedShards {
            do {
                try VaultSecretsKeychain.storeData(
                    shard.encryptedData,
                    service: VaultSecretsKeychain.receivedShardsService,
                    account: shard.id.uuidString
                )
            } catch {
                print("[ShardDistribution] Failed to persist received shard \(shard.id): \(error)")
            }
        }

        let sanitized = receivedShards.map { $0.withoutSecret() }
        if let data = try? JSONEncoder().encode(sanitized) {
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
    var encryptedData: Data
    let itemName: String
    let senderName: String
    let receivedAt: Date
    var usedForRecovery: Bool

    func withoutSecret() -> ReceivedShard {
        var copy = self
        copy.encryptedData = Data()
        return copy
    }
}

struct RecoverySession: Identifiable {
    var id: UUID { sessionId }
    let sessionId: UUID
    let itemName: String
    let vaultId: UUID?
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
    case shardAuthFailed(guardian: UUID?, shardIndex: Int)

    var errorDescription: String? {
        switch self {
        case .sessionNotFound: return "Recovery session not found"
        case .sessionNotActive: return "Recovery session is not active"
        case .duplicateShard: return "This shard has already been added"
        case .insufficientShards: return "Not enough shards to complete recovery"
        case .reconstructionFailed: return "Failed to reconstruct the key"
        case .shardAuthFailed(let guardian, let idx):
            if let guardian = guardian {
                return "Recovery shard auth failed for guardian \(guardian) (index \(idx))"
            }
            return "Recovery shard auth failed (index \(idx))"
        }
    }
}
