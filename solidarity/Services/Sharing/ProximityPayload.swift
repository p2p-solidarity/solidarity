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
  let signPubKey: String?  // Identity Key (Ed25519, messaging-only)

  // v2 DID-bound exchange signing fields. v1 (nil protocolVersion / nil senderDID) is
  // rejected by the receiver because it lacks DID-anchored authenticity.
  let protocolVersion: Int?
  let senderDID: String?
  let senderJWK: PublicKeyJWK?
  let receiverPeerName: String?
  let nonce: String?
  let didSignature: String?

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
    signPubKey: String?,
    protocolVersion: Int? = nil,
    senderDID: String? = nil,
    senderJWK: PublicKeyJWK? = nil,
    receiverPeerName: String? = nil,
    nonce: String? = nil,
    didSignature: String? = nil
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
    self.protocolVersion = protocolVersion
    self.senderDID = senderDID
    self.senderJWK = senderJWK
    self.receiverPeerName = receiverPeerName
    self.nonce = nonce
    self.didSignature = didSignature
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

  // v2 DID-bound exchange signing fields. v1 payloads (nil protocolVersion) are rejected.
  let protocolVersion: Int?
  let senderDID: String?
  let senderJWK: PublicKeyJWK?
  let receiverPeerName: String?
  let nonce: String?
  let didSignature: String?

  init(
    requestId: UUID,
    senderID: String,
    timestamp: Date,
    selectedFields: [BusinessCardField],
    cardPreview: BusinessCard,
    myEphemeralMessage: String?,
    myExchangeSignature: String,
    signPubKey: String? = nil,
    protocolVersion: Int? = nil,
    senderDID: String? = nil,
    senderJWK: PublicKeyJWK? = nil,
    receiverPeerName: String? = nil,
    nonce: String? = nil,
    didSignature: String? = nil
  ) {
    self.requestId = requestId
    self.senderID = senderID
    self.timestamp = timestamp
    self.selectedFields = selectedFields
    self.cardPreview = cardPreview
    self.myEphemeralMessage = myEphemeralMessage
    self.myExchangeSignature = myExchangeSignature
    self.signPubKey = signPubKey
    self.protocolVersion = protocolVersion
    self.senderDID = senderDID
    self.senderJWK = senderJWK
    self.receiverPeerName = receiverPeerName
    self.nonce = nonce
    self.didSignature = didSignature
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

  // v2 DID-bound exchange signing fields. v1 payloads (nil protocolVersion) are rejected.
  let protocolVersion: Int?
  let senderDID: String?
  let senderJWK: PublicKeyJWK?
  let receiverPeerName: String?
  let nonce: String?
  let didSignature: String?

  init(
    requestId: UUID,
    senderID: String,
    timestamp: Date,
    selectedFields: [BusinessCardField],
    cardPreview: BusinessCard,
    theirEphemeralMessage: String?,
    exchangeSignature: String,
    sealedRoute: String?,
    pubKey: String?,
    signPubKey: String?,
    protocolVersion: Int? = nil,
    senderDID: String? = nil,
    senderJWK: PublicKeyJWK? = nil,
    receiverPeerName: String? = nil,
    nonce: String? = nil,
    didSignature: String? = nil
  ) {
    self.requestId = requestId
    self.senderID = senderID
    self.timestamp = timestamp
    self.selectedFields = selectedFields
    self.cardPreview = cardPreview
    self.theirEphemeralMessage = theirEphemeralMessage
    self.exchangeSignature = exchangeSignature
    self.sealedRoute = sealedRoute
    self.pubKey = pubKey
    self.signPubKey = signPubKey
    self.protocolVersion = protocolVersion
    self.senderDID = senderDID
    self.senderJWK = senderJWK
    self.receiverPeerName = receiverPeerName
    self.nonce = nonce
    self.didSignature = didSignature
  }
}

/// Payload for inviting a nearby peer to join a Semaphore group.
/// `inviterPublicKey` is the Ed25519 raw public key bytes (base64 in transit when needed).
/// `inviterSignature` covers the canonical bytes returned by `canonicalBytes()`.
/// Receivers MUST verify both the signature and that `timestamp` is within ``Self.maxAge``.
struct GroupInvitePayload: Codable {
  static let maxAge: TimeInterval = 5 * 60

  let groupId: UUID
  let groupName: String
  let groupRoot: String?
  let inviterName: String
  let timestamp: Date
  let inviterPublicKey: Data
  let inviterSignature: Data

  /// Deterministic byte representation used to sign / verify the invite.
  /// Format: `groupId|groupName|groupRoot|ISO8601(timestamp)`. Empty `groupRoot`
  /// is encoded as the empty string.
  static func canonicalBytes(
    groupId: UUID,
    groupName: String,
    groupRoot: String?,
    timestamp: Date
  ) -> Data {
    let formatter = ISO8601DateFormatter()
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let stamp = formatter.string(from: timestamp)
    let canonical = [
      groupId.uuidString,
      groupName,
      groupRoot ?? "",
      stamp
    ].joined(separator: "|")
    return Data(canonical.utf8)
  }

  func canonicalBytes() -> Data {
    Self.canonicalBytes(groupId: groupId, groupName: groupName, groupRoot: groupRoot, timestamp: timestamp)
  }
}

/// Payload for responding to a group invite with the recipient's commitment.
/// Signed with the joiner's Ed25519 identity key over the canonical join bytes
/// to bind the commitment to a specific identity. Unsigned join payloads are
/// rejected by ``ProximityManager+SessionDelegate``.
struct GroupJoinResponsePayload: Codable {
  static let maxAge: TimeInterval = 5 * 60

  let groupId: UUID
  let memberCommitment: String
  let memberName: String
  let timestamp: Date
  let memberPublicKey: Data?
  let memberSignature: Data?

  static func canonicalBytes(
    groupId: UUID,
    memberCommitment: String,
    memberName: String,
    timestamp: Date
  ) -> Data {
    let formatter = ISO8601DateFormatter()
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let stamp = formatter.string(from: timestamp)
    let canonical = [
      groupId.uuidString,
      memberCommitment,
      memberName,
      stamp
    ].joined(separator: "|")
    return Data(canonical.utf8)
  }

  func canonicalBytes() -> Data {
    Self.canonicalBytes(
      groupId: groupId,
      memberCommitment: memberCommitment,
      memberName: memberName,
      timestamp: timestamp
    )
  }
}
