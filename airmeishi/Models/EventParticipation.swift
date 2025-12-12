//
//  EventParticipation.swift
//  airmeishi
//
//  Represents a verified participation in an event (e.g., Luma) stored locally
//

import Foundation

struct EventParticipation: Codable, Identifiable, Hashable {
    let id: String
    var eventId: String
    var eventName: String
    var organizer: String?
    var eventDate: Date
    var location: String?
    var sourceEmail: String?
    var verificationMethod: VerificationMethod
    var isVerified: Bool
    var proofDataPath: String?
    var createdAt: Date
    var updatedAt: Date
    var notes: String?
    
    enum VerificationMethod: String, Codable {
        case manual
    }
}

extension Array where Element == EventParticipation {
    func sortedByEventDateDesc() -> [EventParticipation] {
        return self.sorted { $0.eventDate > $1.eventDate }
    }
}
