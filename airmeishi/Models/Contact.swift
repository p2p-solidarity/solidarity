//
//  Contact.swift
//  airmeishi
//
//  Data model for received business cards with metadata and verification status
//

import Foundation

/// Represents a received business card with additional metadata
struct Contact: Codable, Identifiable, Equatable {
    let id: UUID
    var businessCard: BusinessCard
    var receivedAt: Date
    var source: ContactSource
    var tags: [String]
    var notes: String?
    var verificationStatus: VerificationStatus
    var lastInteraction: Date?
    
    // Secure Messaging Fields
    var sealedRoute: String?
    var pubKey: String?
    var signPubKey: String?
    
    /// Check if this contact supports Sakura (Secure Messaging)
    var canReceiveSakura: Bool {
        return sealedRoute != nil && pubKey != nil && signPubKey != nil
    }
    
    init(
        id: UUID = UUID(),
        businessCard: BusinessCard,
        receivedAt: Date = Date(),
        source: ContactSource,
        tags: [String] = [],
        notes: String? = nil,
        verificationStatus: VerificationStatus = .unverified,
        lastInteraction: Date? = nil,
        sealedRoute: String? = nil,
        pubKey: String? = nil,
        signPubKey: String? = nil
    ) {
        self.id = id
        self.businessCard = businessCard
        self.receivedAt = receivedAt
        self.source = source
        self.tags = tags
        self.notes = notes
        self.verificationStatus = verificationStatus
        self.lastInteraction = lastInteraction
        self.sealedRoute = sealedRoute
        self.pubKey = pubKey
        self.signPubKey = signPubKey
    }
    
    /// Update last interaction timestamp
    mutating func updateInteraction() {
        self.lastInteraction = Date()
    }
    
    /// Add a tag if it doesn't already exist
    mutating func addTag(_ tag: String) {
        let trimmedTag = tag.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedTag.isEmpty && !tags.contains(trimmedTag) {
            tags.append(trimmedTag)
        }
    }
    
    /// Remove a tag
    mutating func removeTag(_ tag: String) {
        tags.removeAll { $0 == tag }
    }
    
    /// Check if contact matches search criteria
    func matches(searchText: String) -> Bool {
        let lowercaseSearch = searchText.lowercased()
        
        return businessCard.name.lowercased().contains(lowercaseSearch) ||
               businessCard.company?.lowercased().contains(lowercaseSearch) == true ||
               businessCard.title?.lowercased().contains(lowercaseSearch) == true ||
               businessCard.email?.lowercased().contains(lowercaseSearch) == true ||
               tags.contains { $0.lowercased().contains(lowercaseSearch) } ||
               notes?.lowercased().contains(lowercaseSearch) == true
    }
}

/// Source of how the contact was received
enum ContactSource: String, Codable, CaseIterable, Hashable {
    case qrCode = "QR Code"
    case proximity = "Proximity"
    case appClip = "App Clip"
    case manual = "Manual"
    case airdrop = "AirDrop"
    
    var displayName: String {
        return self.rawValue
    }
    
    var systemImageName: String {
        switch self {
        case .qrCode: return "qrcode"
        case .proximity: return "wave.3.right"
        case .appClip: return "appclip"
        case .manual: return "person.badge.plus"
        case .airdrop: return "airplayaudio"
        }
    }
}

/// Verification status of the contact's authenticity
enum VerificationStatus: String, Codable, CaseIterable, Hashable {
    case verified = "Verified"
    case unverified = "Unverified"
    case failed = "Failed"
    case pending = "Pending"
    
    var displayName: String {
        return self.rawValue
    }
    
    var systemImageName: String {
        switch self {
        case .verified: return "checkmark.seal.fill"
        case .unverified: return "questionmark.circle"
        case .failed: return "xmark.seal.fill"
        case .pending: return "clock.circle"
        }
    }
    
    var color: String {
        switch self {
        case .verified: return "green"
        case .unverified: return "gray"
        case .failed: return "red"
        case .pending: return "orange"
        }
    }
}

// MARK: - Extensions

extension ContactSource: Identifiable {
    var id: String { self.rawValue }
}

extension VerificationStatus: Identifiable {
    var id: String { self.rawValue }
}
