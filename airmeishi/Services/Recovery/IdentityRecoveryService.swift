import Foundation

struct IdentityRecoveryBundle: Codable, Identifiable {
  let id: UUID
  let threshold: Int
  let totalShares: Int
  let createdAt: Date
  let shares: [SecretShare]
  let contactIDs: [String]
}

@MainActor
final class IdentityRecoveryService {
  static let shared = IdentityRecoveryService()

  private init() {}

  func createBundle(
    masterKeyData: Data,
    threshold: Int,
    totalShares: Int,
    contacts: [ContactEntity]
  ) -> CardResult<IdentityRecoveryBundle> {
    do {
      let shares = try ShamirSecretSharing.split(
        secret: masterKeyData,
        threshold: threshold,
        totalShares: totalShares
      )
      let bundle = IdentityRecoveryBundle(
        id: UUID(),
        threshold: threshold,
        totalShares: totalShares,
        createdAt: Date(),
        shares: shares,
        contactIDs: contacts.map(\.id)
      )
      return .success(bundle)
    } catch {
      return .failure(.cryptographicError("Failed to split master key: \(error.localizedDescription)"))
    }
  }

  func prepareDistributionPackages(
    bundle: IdentityRecoveryBundle
  ) -> CardResult<[ShardPackage]> {
    var packages: [ShardPackage] = []
    for (index, share) in bundle.shares.enumerated() {
      let recipientIdString = bundle.contactIDs[safe: index] ?? UUID().uuidString
      let recipientID = UUID(uuidString: recipientIdString) ?? UUID()
      let shard = EncryptedKeyShard(
        shardIndex: share.index,
        encryptedData: share.value,
        recipientContactId: recipientID
      )
      let package = ShardDistributionService.shared.createShardPackage(
        shard: shard,
        itemName: "DID Master Key",
        recipientName: "Recovery Contact \(index + 1)"
      )
      packages.append(package)
    }
    return .success(packages)
  }

  func recoverMasterKey(from shares: [SecretShare]) -> CardResult<Data> {
    do {
      let key = try ShamirSecretSharing.combine(shares: shares)
      return .success(key)
    } catch {
      return .failure(.cryptographicError("Failed to recover master key: \(error.localizedDescription)"))
    }
  }
}

private extension Array {
  subscript(safe index: Int) -> Element? {
    guard indices.contains(index) else { return nil }
    return self[index]
  }
}
