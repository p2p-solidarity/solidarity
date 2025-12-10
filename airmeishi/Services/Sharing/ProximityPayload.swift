//
//  ProximityPayload.swift
//  airmeishi
//
//  Defines the payload used for proximity-based sharing, including ZK info.
//

import Foundation

struct ProximitySharingPayload: Codable {
    let card: BusinessCard
    let sharingLevel: SharingLevel
    let timestamp: Date
    let senderID: String
    let shareId: UUID
    let issuerCommitment: String?
    let issuerProof: String?
    let sdProof: SelectiveDisclosureProof?
    
    // Secure Messaging Fields (Optional for backward compatibility)
    let sealedRoute: String?
    let pubKey: String?      // Encryption Key (X25519)
    let signPubKey: String?  // Identity Key (Ed25519)
}


/// Payload for inviting a nearby peer to join a Semaphore group
struct GroupInvitePayload: Codable {
    let groupId: UUID
    let groupName: String
    let groupRoot: String?
    let inviterName: String
    let timestamp: Date
}

/// Payload for responding to a group invite with the recipient's commitment
struct GroupJoinResponsePayload: Codable {
    let groupId: UUID
    let memberCommitment: String
    let memberName: String
    let timestamp: Date
}


