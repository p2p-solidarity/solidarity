//
//  TimeLockConfig.swift
//  airmeishi
//
//  Time-based access control for vault items - implements "digital inheritance"
//

import Foundation

/// Configuration for time-based access control
struct TimeLockConfig: Codable, Equatable {
    /// Whether time lock is enabled
    var enabled: Bool

    /// Fixed unlock date
    var unlockDate: Date?

    /// Inactivity period in days before auto-unlock
    var inactivityDays: Int?

    /// Contact ID of the beneficiary (for inheritance)
    var beneficiaryContactId: UUID?

    /// Additional witness contacts for inheritance
    var witnessContactIds: [UUID]

    /// Current status of the time lock
    var status: TimeLockStatus

    /// Key shards for emergency recovery (encrypted)
    var keyShards: [EncryptedKeyShard]

    /// Required shards to reconstruct the key
    var requiredShardCount: Int

    init(
        enabled: Bool = false,
        unlockDate: Date? = nil,
        inactivityDays: Int? = nil,
        beneficiaryContactId: UUID? = nil,
        witnessContactIds: [UUID] = [],
        keyShards: [EncryptedKeyShard] = [],
        requiredShardCount: Int = 2
    ) {
        self.enabled = enabled
        self.unlockDate = unlockDate
        self.inactivityDays = inactivityDays
        self.beneficiaryContactId = beneficiaryContactId
        self.witnessContactIds = witnessContactIds
        self.keyShards = keyShards
        self.requiredShardCount = requiredShardCount
        self.status = .locked
    }

    // MARK: - Computed Properties

    /// Whether the time lock has expired and item should be accessible
    var isCurrentlyLocked: Bool {
        guard enabled else { return false }

        // Check fixed unlock date
        if let date = unlockDate, Date() >= date {
            return false
        }

        // Inactivity-based unlock is checked by TimeLockService
        return true
    }

    /// Human-readable description
    var description: String {
        guard enabled else { return "Not configured" }

        if let date = unlockDate {
            return "Unlocks on \(date.formatted(date: .abbreviated, time: .shortened))"
        } else if let days = inactivityDays {
            return "Auto-unlock after \(days) days of inactivity"
        } else if !keyShards.isEmpty {
            return "Emergency recovery configured (\(keyShards.count) shards, \(requiredShardCount) required)"
        }

        return "Time locked"
    }

    /// Days until unlock (if applicable)
    var daysUntilUnlock: Int? {
        guard let date = unlockDate else { return nil }
        let calendar = Calendar.current
        let now = Date()
        return calendar.dateComponents([.day], from: now, to: date).day
    }

    /// Whether emergency recovery is configured
    var hasEmergencyRecovery: Bool {
        !keyShards.isEmpty
    }

    /// Status display name
    var statusDisplayName: String {
        switch status {
        case .locked: return "Locked"
        case .unlocked: return "Unlocked"
        case .pendingReview: return "Pending Review"
        case .released: return "Released to Beneficiary"
        case .failed: return "Recovery Failed"
        }
    }

    // MARK: - Time Lock Status

    enum TimeLockStatus: String, Codable {
        case locked
        case unlocked
        case pendingReview
        case released
        case failed

        var systemImage: String {
            switch self {
            case .locked: return "lock.fill"
            case .unlocked: return "lock.open.fill"
            case .pendingReview: return "clock.badge.exclamationmark"
            case .released: return "person.badge.key.fill"
            case .failed: return "exclamationmark.triangle.fill"
            }
        }
    }

    // MARK: - Codable

    enum CodingKeys: String, CodingKey {
        case enabled
        case unlockDate
        case inactivityDays
        case beneficiaryContactId
        case witnessContactIds
        case status
        case keyShards
        case requiredShardCount
    }
}

// MARK: - Encrypted Key Shard (for social recovery)

/// An encrypted shard of the vault key for emergency recovery
struct EncryptedKeyShard: Codable, Identifiable, Equatable {
    let id: UUID
    let shardIndex: Int
    let encryptedData: Data
    let recipientContactId: UUID
    let createdAt: Date
    var isDistributed: Bool
    var acknowledgedAt: Date?

    init(
        shardIndex: Int,
        encryptedData: Data,
        recipientContactId: UUID
    ) {
        self.id = UUID()
        self.shardIndex = shardIndex
        self.encryptedData = encryptedData
        self.recipientContactId = recipientContactId
        self.createdAt = Date()
        self.isDistributed = false
        self.acknowledgedAt = nil
    }
}

// MARK: - Escrow Request (for inheritance)

/// A request to release vault contents to a beneficiary
struct EscrowRequest: Identifiable, Codable {
    let id: UUID
    let vaultItemId: UUID
    let requesterId: UUID  // Beneficiary's contact ID
    let requestedAt: Date
    var status: EscrowStatus
    var submittedShardIds: [UUID]
    var reviewedAt: Date?
    var reviewNotes: String?

    enum EscrowStatus: String, Codable {
        case pending
        case approved
        case rejected
        case expired

        var displayName: String {
            switch self {
            case .pending: return "Pending Review"
            case .approved: return "Approved"
            case .rejected: return "Rejected"
            case .expired: return "Expired"
            }
        }
    }
}

// MARK: - Inactivity Tracker

/// Tracks user activity for inactivity-based unlock
struct InactivityTracker: Codable {
    var lastActivityDate: Date
    var activityHistory: [Date]
    var configuredDaysThreshold: Int

    var daysSinceLastActivity: Int {
        let calendar = Calendar.current
        return calendar.dateComponents([.day], from: lastActivityDate, to: Date()).day ?? 0
    }

    var shouldAutoUnlock: Bool {
        guard configuredDaysThreshold > 0 else { return false }
        return daysSinceLastActivity >= configuredDaysThreshold
    }

    mutating func recordActivity() {
        lastActivityDate = Date()
        activityHistory.append(Date())
        // Keep only last 30 days of history
        let thirtyDaysAgo = Date().addingTimeInterval(-30 * 24 * 60 * 60)
        activityHistory = activityHistory.filter { $0 > thirtyDaysAgo }
    }

    mutating func reset() {
        lastActivityDate = Date()
        activityHistory = [Date()]
    }
}
