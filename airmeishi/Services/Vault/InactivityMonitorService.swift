//
//  InactivityMonitorService.swift
//  airmeishi
//
//  Monitors user activity for time-locked vault items
//  Core component of the "Digital Will" / inheritance feature
//

import Foundation
import Combine
import UserNotifications
import UIKit

// MARK: - Inactivity Monitor Service

@MainActor
final class InactivityMonitorService: ObservableObject {
    static let shared = InactivityMonitorService()

    // MARK: - Published Properties

    @Published private(set) var lastActivityDate: Date
    @Published private(set) var daysSinceActivity: Int = 0
    @Published private(set) var pendingUnlocks: [PendingUnlock] = []
    @Published private(set) var isMonitoring = true

    // MARK: - Private Properties

    private let userDefaults = UserDefaults.standard
    private let activityKey = "com.solidarity.vault.lastActivity"
    private let historyKey = "com.solidarity.vault.activityHistory"
    private var cancellables = Set<AnyCancellable>()
    private var checkTimer: Timer?

    private let vault = SovereignVaultService.shared
    private let notificationCenter = UNUserNotificationCenter.current()

    // MARK: - Configuration

    private let warningDays = [7, 3, 1] // Days before unlock to warn
    private let minimumCheckInterval: TimeInterval = 3600 // 1 hour

    // MARK: - Initialization

    private init() {
        // Load last activity date or initialize to now
        if let savedDate = userDefaults.object(forKey: activityKey) as? Date {
            lastActivityDate = savedDate
        } else {
            lastActivityDate = Date()
            saveActivity()
        }

        updateDaysSinceActivity()
        setupActivityObservers()
        schedulePeriodicCheck()
        requestNotificationPermission()
    }

    // MARK: - Public API

    /// Record user activity (call on meaningful interactions)
    func recordActivity() {
        lastActivityDate = Date()
        daysSinceActivity = 0
        saveActivity()

        // Cancel any pending unlock notifications
        cancelPendingNotifications()

        // Reset pending unlocks
        pendingUnlocks.removeAll()

        print("[InactivityMonitor] Activity recorded at \(lastActivityDate)")
    }

    /// Perform a check for inactivity-based unlocks
    func performCheck() {
        updateDaysSinceActivity()
        checkForPendingUnlocks()
        scheduleWarningNotifications()
    }

    /// Get items that will unlock soon due to inactivity
    func itemsWithUpcomingUnlock(within days: Int) -> [VaultItem] {
        vault.items.filter { item in
            guard let config = item.timeLockConfig,
                  config.enabled,
                  let inactivityDays = config.inactivityDays else {
                return false
            }

            let daysUntilUnlock = inactivityDays - daysSinceActivity
            return daysUntilUnlock > 0 && daysUntilUnlock <= days
        }
    }

    /// Manually trigger the recovery process for an item
    func initiateRecoveryProcess(for itemId: UUID) async throws {
        guard let item = vault.items.first(where: { $0.id == itemId }),
              let config = item.timeLockConfig,
              config.enabled else {
            throw InactivityError.itemNotConfigured
        }

        // Check if inactivity threshold has been met
        if let inactivityDays = config.inactivityDays,
           daysSinceActivity >= inactivityDays {
            // Trigger the unlock flow
            try await processAutoUnlock(item: item)
        } else if let unlockDate = config.unlockDate,
                  Date() >= unlockDate {
            // Fixed date unlock
            try await processAutoUnlock(item: item)
        } else {
            throw InactivityError.unlockConditionsNotMet
        }
    }

    /// Configure inactivity monitoring for an item
    func configureMonitoring(
        for itemId: UUID,
        inactivityDays: Int,
        beneficiaryContactId: UUID?,
        witnessContactIds: [UUID] = []
    ) async throws {
        var config = TimeLockConfig(
            enabled: true,
            inactivityDays: inactivityDays,
            beneficiaryContactId: beneficiaryContactId,
            witnessContactIds: witnessContactIds
        )

        // If there's a beneficiary, create and distribute key shards
        if let beneficiaryId = beneficiaryContactId {
            let shards = try await createKeyShards(
                for: itemId,
                beneficiary: beneficiaryId,
                witnesses: witnessContactIds
            )
            config.keyShards = shards
            config.requiredShardCount = max(2, (witnessContactIds.count / 2) + 1)
        }

        try await vault.updateTimeLock(itemId, config: config)
    }

    /// Get status summary
    var statusSummary: ActivityStatus {
        ActivityStatus(
            lastActivity: lastActivityDate,
            daysSinceActivity: daysSinceActivity,
            monitoredItemCount: vault.items.filter { $0.timeLockConfig?.inactivityDays != nil }.count,
            pendingUnlockCount: pendingUnlocks.count,
            isMonitoring: isMonitoring
        )
    }

    // MARK: - Private Methods

    private func setupActivityObservers() {
        // Observe app becoming active
        NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)
            .sink { [weak self] _ in
                self?.performCheck()
            }
            .store(in: &cancellables)

        // Observe significant time changes
        NotificationCenter.default.publisher(for: UIApplication.significantTimeChangeNotification)
            .sink { [weak self] _ in
                self?.updateDaysSinceActivity()
            }
            .store(in: &cancellables)
    }

    private func schedulePeriodicCheck() {
        checkTimer?.invalidate()
        checkTimer = Timer.scheduledTimer(withTimeInterval: minimumCheckInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.performCheck()
            }
        }
    }

    private func updateDaysSinceActivity() {
        let calendar = Calendar.current
        let days = calendar.dateComponents([.day], from: lastActivityDate, to: Date()).day ?? 0
        daysSinceActivity = max(0, days)
    }

    private func saveActivity() {
        userDefaults.set(lastActivityDate, forKey: activityKey)

        // Save to history (keep last 90 days)
        var history = userDefaults.array(forKey: historyKey) as? [Date] ?? []
        history.append(lastActivityDate)
        let ninetyDaysAgo = Date().addingTimeInterval(-90 * 24 * 60 * 60)
        history = history.filter { $0 > ninetyDaysAgo }
        userDefaults.set(history, forKey: historyKey)
    }

    private func checkForPendingUnlocks() {
        var newPendingUnlocks: [PendingUnlock] = []

        for item in vault.items {
            guard let config = item.timeLockConfig,
                  config.enabled else { continue }

            // Check inactivity-based unlock
            if let inactivityDays = config.inactivityDays {
                let daysUntilUnlock = inactivityDays - daysSinceActivity

                if daysUntilUnlock <= 0 {
                    // Should unlock now
                    Task {
                        try? await processAutoUnlock(item: item)
                    }
                } else if warningDays.contains(daysUntilUnlock) {
                    newPendingUnlocks.append(PendingUnlock(
                        itemId: item.id,
                        itemName: item.name,
                        daysUntilUnlock: daysUntilUnlock,
                        unlockType: .inactivity,
                        beneficiaryId: config.beneficiaryContactId
                    ))
                }
            }

            // Check fixed date unlock
            if let unlockDate = config.unlockDate {
                if Date() >= unlockDate {
                    Task {
                        try? await processAutoUnlock(item: item)
                    }
                } else {
                    let daysUntil = Calendar.current.dateComponents([.day], from: Date(), to: unlockDate).day ?? 0
                    if warningDays.contains(daysUntil) {
                        newPendingUnlocks.append(PendingUnlock(
                            itemId: item.id,
                            itemName: item.name,
                            daysUntilUnlock: daysUntil,
                            unlockType: .fixedDate(unlockDate),
                            beneficiaryId: config.beneficiaryContactId
                        ))
                    }
                }
            }
        }

        pendingUnlocks = newPendingUnlocks
    }

    private func processAutoUnlock(item: VaultItem) async throws {
        guard var config = item.timeLockConfig else { return }

        // Update status
        config.status = .unlocked
        try await vault.updateTimeLock(item.id, config: config)

        // Notify beneficiary if configured
        if let beneficiaryId = config.beneficiaryContactId {
            await notifyBeneficiary(beneficiaryId, about: item)
        }

        // Log the unlock event
        print("[InactivityMonitor] Auto-unlocked item: \(item.name)")
    }

    private func createKeyShards(
        for itemId: UUID,
        beneficiary: UUID,
        witnesses: [UUID]
    ) async throws -> [EncryptedKeyShard] {
        // Get the item's encryption key
        let itemKey = try await getItemEncryptionKey(itemId)

        // Split into shards (beneficiary + witnesses)
        let totalParties = 1 + witnesses.count
        let threshold = max(2, (totalParties / 2) + 1)

        let shares = try ShamirSecretSharing.split(
            secret: itemKey,
            threshold: threshold,
            totalShares: totalParties
        )

        // Create encrypted shards for each party
        var shards: [EncryptedKeyShard] = []

        // Beneficiary gets first shard
        shards.append(EncryptedKeyShard(
            shardIndex: 0,
            encryptedData: shares[0].value, // In production, encrypt with beneficiary's public key
            recipientContactId: beneficiary
        ))

        // Witnesses get remaining shards
        for (index, witnessId) in witnesses.enumerated() {
            shards.append(EncryptedKeyShard(
                shardIndex: index + 1,
                encryptedData: shares[index + 1].value,
                recipientContactId: witnessId
            ))
        }

        return shards
    }

    private func getItemEncryptionKey(_ itemId: UUID) async throws -> Data {
        // In production, retrieve the actual item key
        // For now, generate a placeholder
        let randomBytes = (0..<32).map { _ in UInt8.random(in: 0...255) }
        return Data(randomBytes)
    }

    private func notifyBeneficiary(_ beneficiaryId: UUID, about item: VaultItem) async {
        // In production, send a notification to the beneficiary
        // This could be via push notification, email, or the app's messaging system
        print("[InactivityMonitor] Would notify beneficiary \(beneficiaryId) about unlocked item: \(item.name)")
    }

    // MARK: - Notifications

    private func requestNotificationPermission() {
        notificationCenter.requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            if granted {
                print("[InactivityMonitor] Notification permission granted")
            }
        }
    }

    private func scheduleWarningNotifications() {
        for pending in pendingUnlocks {
            scheduleNotification(for: pending)
        }
    }

    private func scheduleNotification(for pending: PendingUnlock) {
        let content = UNMutableNotificationContent()
        content.title = "Vault Item Will Unlock Soon"
        content.body = "\"\(pending.itemName)\" will unlock in \(pending.daysUntilUnlock) day(s). Open the app to record activity."
        content.sound = .default
        content.categoryIdentifier = "VAULT_UNLOCK_WARNING"

        let trigger = UNTimeIntervalNotificationTrigger(
            timeInterval: 60, // Show soon (for testing; in production, space these out)
            repeats: false
        )

        let request = UNNotificationRequest(
            identifier: "vault-unlock-\(pending.itemId.uuidString)",
            content: content,
            trigger: trigger
        )

        notificationCenter.add(request)
    }

    private func cancelPendingNotifications() {
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
                return "Inactivity unlock"
            case .fixedDate(let date):
                return "Scheduled for \(date.formatted(date: .abbreviated, time: .omitted))"
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
            return "Active today"
        } else if daysSinceActivity == 1 {
            return "Last active yesterday"
        } else {
            return "Last active \(daysSinceActivity) days ago"
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
            return "Item is not configured for inactivity monitoring"
        case .unlockConditionsNotMet:
            return "Unlock conditions have not been met"
        case .shardCreationFailed:
            return "Failed to create key shards"
        }
    }
}
