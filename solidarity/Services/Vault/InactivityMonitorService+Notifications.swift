//
//  InactivityMonitorService+Notifications.swift
//  solidarity
//

import Foundation
import UserNotifications

// MARK: - Notifications & Key Shards

extension InactivityMonitorService {

    func processAutoUnlock(item: VaultItem) async throws {
        guard var config = item.timeLockConfig else { return }

        config.status = .unlocked
        try await vault.updateTimeLock(item.id, config: config)

        if let beneficiaryId = config.beneficiaryContactId {
            await notifyBeneficiary(beneficiaryId, about: item)
        }

        print("[InactivityMonitor] Auto-unlocked item: \(item.name)")
    }

    func createKeyShards(
        for itemId: UUID,
        beneficiary: UUID,
        witnesses: [UUID]
    ) async throws -> [EncryptedKeyShard] {
        let itemKey = try await getItemEncryptionKey(itemId)

        let totalParties = 1 + witnesses.count
        let threshold = max(2, (totalParties / 2) + 1)

        let shares = try ShamirSecretSharing.split(
            secret: itemKey,
            threshold: threshold,
            totalShares: totalParties
        )

        let wrapKey = try ContentKeyExchangeService.shared.vaultWrapKey(vaultId: itemId)

        let recipients: [UUID] = [beneficiary] + witnesses
        var shards: [EncryptedKeyShard] = []
        for (offset, recipient) in recipients.enumerated() {
            let envelope = try WrappedShardEnvelope.seal(
                share: shares[offset].value,
                vaultId: itemId,
                guardianContactId: recipient,
                shardIndex: shares[offset].index,
                threshold: threshold,
                wrapKey: wrapKey
            )
            shards.append(EncryptedKeyShard(
                shardIndex: shares[offset].index,
                encryptedData: try envelope.encode(),
                recipientContactId: recipient
            ))
        }

        return shards
    }

    /// Returns the symmetric encryption key used to seal a vault item, as raw
    /// bytes suitable for Shamir splitting. Vault items currently share a
    /// single per-device vault key (managed by FileEncryptionService); per-item
    /// keys are not yet implemented. Fails closed if the key cannot be loaded
    /// — callers must NOT receive random bytes.
    func getItemEncryptionKey(_ itemId: UUID) async throws -> Data {
        let key = try VaultSecretsKeychain.loadVaultKey()
        return key.withUnsafeBytes { Data($0) }
    }

    func notifyBeneficiary(_ beneficiaryId: UUID, about item: VaultItem) async {
        print("[InactivityMonitor] Would notify beneficiary \(beneficiaryId) about unlocked item: \(item.name)")
    }

    // MARK: - Notifications

    func requestNotificationPermission() {
        notificationCenter.requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            if granted {
                print("[InactivityMonitor] Notification permission granted")
            }
        }
    }

    func scheduleWarningNotifications() {
        for pending in pendingUnlocks {
            scheduleNotification(for: pending)
        }
    }

    func scheduleNotification(for pending: PendingUnlock) {
        let content = UNMutableNotificationContent()
        content.title = String(localized: "Vault Item Will Unlock Soon")
        let bodyFormat = String(localized: "\"%@\" will unlock in %lld day(s). Open the app to record activity.")
        content.body = String(format: bodyFormat, locale: Locale.current, pending.itemName, pending.daysUntilUnlock)
        content.sound = .default
        content.categoryIdentifier = "VAULT_UNLOCK_WARNING"

        let trigger = UNTimeIntervalNotificationTrigger(
            timeInterval: 60,
            repeats: false
        )

        let request = UNNotificationRequest(
            identifier: "vault-unlock-\(pending.itemId.uuidString)",
            content: content,
            trigger: trigger
        )

        notificationCenter.add(request)
    }

    func cancelPendingNotifications() {
        let identifiers = pendingUnlocks.map { "vault-unlock-\($0.itemId.uuidString)" }
        notificationCenter.removePendingNotificationRequests(withIdentifiers: identifiers)
    }
}

// MARK: - Supporting Types

struct PendingUnlock: Identifiable {
    var id: UUID { itemId }
    let itemId: UUID
    let itemName: String
    let daysUntilUnlock: Int
    let unlockType: UnlockType
    let beneficiaryId: UUID?

    enum UnlockType {
        case inactivity
        case fixedDate(Date)

        var description: String {
            switch self {
            case .inactivity:
                return String(localized: "Inactivity unlock")
            case .fixedDate(let date):
                let format = String(localized: "Scheduled for %@")
                return String(format: format, locale: Locale.current, date.formatted(date: .abbreviated, time: .omitted))
            }
        }
    }
}

struct ActivityStatus {
    let lastActivity: Date
    let daysSinceActivity: Int
    let monitoredItemCount: Int
    let pendingUnlockCount: Int
    let isMonitoring: Bool

    var formattedLastActivity: String {
        lastActivity.formatted(date: .abbreviated, time: .shortened)
    }

    var statusMessage: String {
        if daysSinceActivity == 0 {
            return String(localized: "Active today")
        } else if daysSinceActivity == 1 {
            return String(localized: "Last active yesterday")
        } else {
            let format = String(localized: "Last active %lld days ago")
            return String(format: format, locale: Locale.current, daysSinceActivity)
        }
    }
}

// MARK: - Errors

enum InactivityError: LocalizedError {
    case itemNotConfigured
    case unlockConditionsNotMet
    case shardCreationFailed

    var errorDescription: String? {
        switch self {
        case .itemNotConfigured:
            return String(localized: "Item is not configured for inactivity monitoring")
        case .unlockConditionsNotMet:
            return String(localized: "Unlock conditions have not been met")
        case .shardCreationFailed:
            return String(localized: "Failed to create key shards")
        }
    }
}
