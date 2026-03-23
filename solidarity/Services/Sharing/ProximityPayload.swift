//
//  ProximityPayload.swift
//  solidarity
//
//  Defines the payload used for proximity-based sharing, including ZK info.
//

import Foundation

struct ProximitySharingPayload: Codable {
  let card: BusinessCard
  /// Legacy field retained for backward compatibility. Do not use for proof scope binding.
  let sharingLevel: SharingLevel
  let selectedFields: [BusinessCardField]?
  /// Canonical proof scope bound to selected fields.
  let scope: String?
  let timestamp: Date
  let senderID: String
  let shareId: UUID
  let issuerCommitment: String?
  let issuerProof: String?
  let sdProof: SelectiveDisclosureProof?
  let payloadSignature: String?

  // Secure Messaging Fields (Optional for backward compatibility)
  let sealedRoute: String?
  let pubKey: String?  // Encryption Key (X25519)
  let signPubKey: String?  // Identity Key (Ed25519)

  init(
    card: BusinessCard,
    sharingLevel: SharingLevel,
    selectedFields: [BusinessCardField]? = nil,
    scope: String? = nil,
    timestamp: Date,
    senderID: String,
    shareId: UUID,
    issuerCommitment: String?,
    issuerProof: String?,
    sdProof: SelectiveDisclosureProof?,
    payloadSignature: String? = nil,
    sealedRoute: String?,
    pubKey: String?,
    signPubKey: String?
  ) {
    self.card = card
    self.sharingLevel = sharingLevel
    self.selectedFields = selectedFields
    self.scope = scope
    self.timestamp = timestamp
    self.senderID = senderID
    self.shareId = shareId
    self.issuerCommitment = issuerCommitment
    self.issuerProof = issuerProof
    self.sdProof = sdProof
    self.payloadSignature = payloadSignature
    self.sealedRoute = sealedRoute
    self.pubKey = pubKey
    self.signPubKey = signPubKey
  }
}

struct ExchangeRequestPayload: Codable {
  let requestId: UUID
  let senderID: String
  let timestamp: Date
  let selectedFields: [BusinessCardField]
  let cardPreview: BusinessCard
  let myEphemeralMessage: String?
  let myExchangeSignature: String
  let signPubKey: String?

  init(
    requestId: UUID,
    senderID: String,
    timestamp: Date,
    selectedFields: [BusinessCardField],
    cardPreview: BusinessCard,
    myEphemeralMessage: String?,
    myExchangeSignature: String,
    signPubKey: String? = nil
  ) {
    self.requestId = requestId
    self.senderID = senderID
    self.timestamp = timestamp
    self.selectedFields = selectedFields
    self.cardPreview = cardPreview
    self.myEphemeralMessage = myEphemeralMessage
    self.myExchangeSignature = myExchangeSignature
    self.signPubKey = signPubKey
  }
}

struct ExchangeAcceptPayload: Codable {
  let requestId: UUID
  let senderID: String
  let timestamp: Date
  let selectedFields: [BusinessCardField]
  let cardPreview: BusinessCard
  let theirEphemeralMessage: String?
  let exchangeSignature: String

  // Secure messaging compatibility
  let sealedRoute: String?
  let pubKey: String?
  let signPubKey: String?
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
