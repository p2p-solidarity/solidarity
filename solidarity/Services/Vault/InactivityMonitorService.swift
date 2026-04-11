//
//  InactivityMonitorService.swift
//  solidarity
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

    // MARK: - Internal Properties

    let vault = SovereignVaultService.shared
    let notificationCenter = UNUserNotificationCenter.current()
    let warningDays = [7, 3, 1]

    // MARK: - Private Properties

    private let userDefaults = UserDefaults.standard
    private let activityKey = "com.solidarity.vault.lastActivity"
    private let historyKey = "com.solidarity.vault.activityHistory"
    private var cancellables = Set<AnyCancellable>()
    private var checkTimer: Timer?
    private let minimumCheckInterval: TimeInterval = 3600

    // MARK: - Initialization

    private init() {
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

    deinit {
        checkTimer?.invalidate()
        checkTimer = nil
    }

    // MARK: - Public API

    func recordActivity() {
        lastActivityDate = Date()
        daysSinceActivity = 0
        saveActivity()
        cancelPendingNotifications()
        pendingUnlocks.removeAll()
        print("[InactivityMonitor] Activity recorded at \(lastActivityDate)")
    }

    func performCheck() {
        updateDaysSinceActivity()
        checkForPendingUnlocks()
        scheduleWarningNotifications()
    }

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

    func initiateRecoveryProcess(for itemId: UUID) async throws {
        guard let item = vault.items.first(where: { $0.id == itemId }),
              let config = item.timeLockConfig,
              config.enabled else {
            throw InactivityError.itemNotConfigured
        }

        if let inactivityDays = config.inactivityDays,
           daysSinceActivity >= inactivityDays {
            try await processAutoUnlock(item: item)
        } else if let unlockDate = config.unlockDate,
                  Date() >= unlockDate {
            try await processAutoUnlock(item: item)
        } else {
            throw InactivityError.unlockConditionsNotMet
        }
    }

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
        NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)
            .sink { [weak self] _ in
                self?.performCheck()
            }
            .store(in: &cancellables)

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

            if let inactivityDays = config.inactivityDays {
                let daysUntilUnlock = inactivityDays - daysSinceActivity

                if daysUntilUnlock <= 0 {
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
}
