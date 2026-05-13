//
//  ShardDistributionService.swift
//  solidarity
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

    @Published var distributedShards: [DistributedShardRecord] = []
    @Published var receivedShards: [ReceivedShard] = []
    @Published var pendingRecoveries: [RecoverySession] = []

    // MARK: - Internal Properties

    let userDefaults = UserDefaults.standard
    let distributedKey = "com.solidarity.vault.distributedShards"
    let receivedKey = "com.solidarity.vault.receivedShards"

    // Tracks which shard ids have been migrated out of plaintext storage so we
    // only log the migration once per id.
    var migratedShardIds: Set<UUID> = []

    // MARK: - Private Properties

    private let context = CIContext()

    // MARK: - Initialization

    private init() {
        loadDistributedShards()
        loadReceivedShards()
    }

    // MARK: - Shard Distribution

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
            expiresAt: Date().addingTimeInterval(7 * 24 * 60 * 60)
        )

        return package
    }

    func generateQRCode(for package: ShardPackage, size: CGFloat = 250) -> UIImage? {
        guard let data = try? JSONEncoder().encode(package),
              let compressed = try? compress(data) else {
            return nil
        }

        let base64 = compressed.base64EncodedString()
        let urlString = AppBranding.shardURL(data: base64)

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

    func acknowledgeDistribution(shardId: UUID) {
        guard let index = distributedShards.firstIndex(where: { $0.shardId == shardId }) else {
            return
        }
        distributedShards[index].acknowledged = true
        distributedShards[index].acknowledgedAt = Date()
        saveDistributedShards()
    }

    // MARK: - Shard Reception

    func storeReceivedShard(_ package: ShardPackage) {
        let received = ReceivedShard(
            id: package.packageId,
            shardIndex: package.shardIndex,
            encryptedData: package.encryptedData,
            itemName: package.itemName,
            senderName: package.recipientName,
            receivedAt: Date(),
            usedForRecovery: false
        )

        if !receivedShards.contains(where: { $0.id == received.id }) {
            receivedShards.append(received)
            saveReceivedShards()
        }
    }

    func shardsForItem(named itemName: String) -> [ReceivedShard] {
        receivedShards.filter { $0.itemName == itemName }
    }
}
