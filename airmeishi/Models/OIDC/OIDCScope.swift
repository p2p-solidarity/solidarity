//
//  OIDCScope.swift
//  airmeishi
//
//  OIDC scope definitions for The Sovereign Vault
//

import Foundation

/// OIDC scopes supported by Solidarity Vault
enum OIDCScope: String, CaseIterable, Codable {
    case backupWrite = "backup_write"
    case backupRead = "backup_read"
    case preferences = "preferences"
    case ageOver18 = "age_over_18"
    case decryptContent = "decrypt_content"
    case configSync = "config_sync"

    var displayName: String {
        switch self {
        case .backupWrite: return "Write Backup"
        case .backupRead: return "Read Backup"
        case .preferences: return "Preferences"
        case .ageOver18: return "Age Verification"
        case .decryptContent: return "Decrypt Content"
        case .configSync: return "Config Sync"
        }
    }

    var description: String {
        switch self {
        case .backupWrite:
            return "Write encrypted backup data to your vault"
        case .backupRead:
            return "Read your encrypted backup data"
        case .preferences:
            return "Read and write app preferences"
        case .ageOver18:
            return "Verify you are over 18 without revealing your birthdate"
        case .decryptContent:
            return "Decrypt shared content you have access to"
        case .configSync:
            return "Sync configuration across apps"
        }
    }

    var requiresUserConfirmation: Bool {
        switch self {
        case .backupWrite, .decryptContent: return true
        case .ageOver18: return true
        default: return false
        }
    }

    var iconName: String {
        switch self {
        case .backupWrite: return "square.and.arrow.up"
        case .backupRead: return "square.and.arrow.down"
        case .preferences: return "gearshape"
        case .ageOver18: return "checkmark.shield"
        case .decryptContent: return "lock.open"
        case .configSync: return "arrow.triangle.2.circlepath"
        }
    }

    var riskLevel: RiskLevel {
        switch self {
        case .backupWrite: return .high
        case .backupRead: return .high
        case .decryptContent: return .medium
        case .preferences: return .low
        case .configSync: return .low
        case .ageOver18: return .low
        }
    }

    enum RiskLevel: String {
        case low, medium, high

        var color: String {
            switch self {
            case .low: return "green"
            case .medium: return "orange"
            case .high: return "red"
            }
        }
    }
}

/// OIDC client information
struct OIDCClientInfo: Codable {
    let clientId: String
    var displayName: String?
    var iconURL: URL?
    var trusted: Bool
    var lastUsed: Date?

    var id: String { clientId }

    init(clientId: String, displayName: String? = nil, iconURL: URL? = nil, trusted: Bool = false) {
        self.clientId = clientId
        self.displayName = displayName
        self.iconURL = iconURL
        self.trusted = trusted
        self.lastUsed = nil
    }
}

/// Permission decision from user
enum PermissionDecision: String, Codable {
    case approved
    case denied
    case cancelled

    var isApproved: Bool {
        self == .approved
    }
}

/// Permission request to present to user
struct PermissionRequest: Identifiable {
    let id: UUID
    let clientInfo: OIDCClientInfo
    let scopes: [OIDCScope]
    let resourceHint: String?
    let requestedAt: Date
    var requiresExplicitConsent: Bool

    var highRiskScopes: [OIDCScope] {
        scopes.filter { $0.riskLevel == .high }
    }

    var mediumRiskScopes: [OIDCScope] {
        scopes.filter { $0.riskLevel == .medium }
    }

    var totalRiskLevel: OIDCScope.RiskLevel {
        if highRiskScopes.isEmpty, mediumRiskScopes.isEmpty { return .low }
        if !highRiskScopes.isEmpty { return .high }
        return .medium
    }
}

/// OIDC authorization request (incoming)
struct OIDCAuthorizationRequest: Codable, Identifiable {
    let id: UUID
    let clientId: String
    let redirectUri: String
    let state: String
    let nonce: String
    let scopes: [OIDCScope]
    let presentationDefinition: PresentationDefinition?
    let requestedAt: Date

    struct PresentationDefinition: Codable {
        let id: String
        let inputDescriptors: [InputDescriptor]

        struct InputDescriptor: Codable {
            let id: String
            let name: String?
            let purpose: String?
        }
    }
}

/// OIDC authorization response
struct OIDCAuthorizationResponse: Codable {
    let state: String
    let code: String?
    let idToken: String?
    let vpToken: String?
    let grantedScopes: [OIDCScope]
    let grantedAt: Date

    init(
        state: String,
        code: String? = nil,
        idToken: String? = nil,
        vpToken: String? = nil,
        grantedScopes: [OIDCScope]
    ) {
        self.state = state
        self.code = code
        self.idToken = idToken
        self.vpToken = vpToken
        self.grantedScopes = grantedScopes
        self.grantedAt = Date()
    }
}
