import Foundation
import SwiftData

@Model
final class ContactEntity {
  @Attribute(.unique) var id: String
  var cardId: String
  var name: String
  var title: String?
  var company: String?
  var email: String?
  var phone: String?
  var source: String
  var verificationStatus: String
  var receivedAt: Date
  var lastInteraction: Date?
  var tags: [String]
  var notes: String?

  var sealedRoute: String?
  var pubKey: String?
  var signPubKey: String?

  // Spec-aligned exchange metadata
  var didPublicKey: String?
  var exchangeSignature: Data?
  var myExchangeSignature: Data?
  var exchangeTimestamp: Date?
  var myEphemeralMessage: String?
  var theirEphemeralMessage: String?

  // v2 prep hooks
  var graphExportEdgeId: String?
  var graphCredentialRef: String?
  var commonFriendsHandshakeToken: String?

  // ContactProfile → CredentialVault references.
  // ContactProfile does NOT own VC contents. It only stores credential IDs
  // (VCLibrary.StoredCredential.id or IdentityCardEntity.id) that back
  // any verified claim about this contact. Read verified fields via
  // VerifiedClaimIndex, not the raw name/email/phone columns.
  var credentialIds: [String] = []

  init(
    id: String = UUID().uuidString,
    cardId: String = UUID().uuidString,
    name: String,
    title: String? = nil,
    company: String? = nil,
    email: String? = nil,
    phone: String? = nil,
    source: String,
    verificationStatus: String = VerificationStatus.unverified.rawValue,
    receivedAt: Date = Date(),
    lastInteraction: Date? = nil,
    tags: [String] = [],
    notes: String? = nil,
    sealedRoute: String? = nil,
    pubKey: String? = nil,
    signPubKey: String? = nil,
    didPublicKey: String? = nil,
    exchangeSignature: Data? = nil,
    myExchangeSignature: Data? = nil,
    exchangeTimestamp: Date? = nil,
    myEphemeralMessage: String? = nil,
    theirEphemeralMessage: String? = nil,
    graphExportEdgeId: String? = nil,
    graphCredentialRef: String? = nil,
    commonFriendsHandshakeToken: String? = nil,
    credentialIds: [String] = []
  ) {
    self.id = id
    self.cardId = cardId
    self.name = name
    self.title = title
    self.company = company
    self.email = email
    self.phone = phone
    self.source = source
    self.verificationStatus = verificationStatus
    self.receivedAt = receivedAt
    self.lastInteraction = lastInteraction
    self.tags = tags
    self.notes = notes
    self.sealedRoute = sealedRoute
    self.pubKey = pubKey
    self.signPubKey = signPubKey
    self.didPublicKey = didPublicKey
    self.exchangeSignature = exchangeSignature
    self.myExchangeSignature = myExchangeSignature
    self.exchangeTimestamp = exchangeTimestamp
    self.myEphemeralMessage = myEphemeralMessage
    self.theirEphemeralMessage = theirEphemeralMessage
    self.graphExportEdgeId = graphExportEdgeId
    self.graphCredentialRef = graphCredentialRef
    self.commonFriendsHandshakeToken = commonFriendsHandshakeToken
    self.credentialIds = credentialIds
  }
}

@Model
final class IdentityCardEntity {
  @Attribute(.unique) var id: String
  var type: String
  var issuerType: String
  var trustLevel: String
  var title: String
  var issuerDid: String
  var holderDid: String
  var issuedAt: Date
  var expiresAt: Date?
  var status: String
  var sourceReference: String?
  var rawCredentialJWT: String?
  var metadataTags: [String]
  var createdAt: Date
  var updatedAt: Date

  init(
    id: String = UUID().uuidString,
    type: String,
    issuerType: String,
    trustLevel: String,
    title: String,
    issuerDid: String,
    holderDid: String,
    issuedAt: Date = Date(),
    expiresAt: Date? = nil,
    status: String = "verified",
    sourceReference: String? = nil,
    rawCredentialJWT: String? = nil,
    metadataTags: [String] = [],
    createdAt: Date = Date(),
    updatedAt: Date = Date()
  ) {
    self.id = id
    self.type = type
    self.issuerType = issuerType
    self.trustLevel = trustLevel
    self.title = title
    self.issuerDid = issuerDid
    self.holderDid = holderDid
    self.issuedAt = issuedAt
    self.expiresAt = expiresAt
    self.status = status
    self.sourceReference = sourceReference
    self.rawCredentialJWT = rawCredentialJWT
    self.metadataTags = metadataTags
    self.createdAt = createdAt
    self.updatedAt = updatedAt
  }
}

@Model
final class ProvableClaimEntity {
  @Attribute(.unique) var id: String
  /// ID of the credential (IdentityCardEntity / VCLibrary.StoredCredential)
  /// that backs this claim. Every VerifiedClaimIndex entry MUST have one —
  /// claims without a source credential are not presentable.
  var identityCardId: String
  var claimType: String
  var title: String
  var issuerType: String
  var trustLevel: String
  var source: String
  var payload: String
  /// Optional BusinessCardField.rawValue this claim verifies
  /// (e.g. "email", "name"). Used by VerifiedClaimIndex to answer
  /// "is field X verified for this holder?". nil for non-field claims
  /// like "age_over_18" or "is_human".
  var sourceField: String?
  var isPresentable: Bool
  var lastPresentedAt: Date?
  var createdAt: Date
  var updatedAt: Date

  /// Semantic alias for `identityCardId`. ProvableClaim is indexed by the
  /// source credential ID — never modify the claim independently of its
  /// source VC.
  var sourceCredentialId: String {
    get { identityCardId }
    set { identityCardId = newValue }
  }

  init(
    id: String = UUID().uuidString,
    identityCardId: String,
    claimType: String,
    title: String,
    issuerType: String,
    trustLevel: String,
    source: String,
    payload: String,
    sourceField: String? = nil,
    isPresentable: Bool = true,
    lastPresentedAt: Date? = nil,
    createdAt: Date = Date(),
    updatedAt: Date = Date()
  ) {
    self.id = id
    self.identityCardId = identityCardId
    self.claimType = claimType
    self.title = title
    self.issuerType = issuerType
    self.trustLevel = trustLevel
    self.source = source
    self.payload = payload
    self.sourceField = sourceField
    self.isPresentable = isPresentable
    self.lastPresentedAt = lastPresentedAt
    self.createdAt = createdAt
    self.updatedAt = updatedAt
  }
}

extension ContactEntity {
  static func fromLegacy(_ legacy: Contact) -> ContactEntity {
    ContactEntity(
      id: legacy.id.uuidString,
      cardId: legacy.businessCard.id.uuidString,
      name: legacy.businessCard.name,
      title: legacy.businessCard.title,
      company: legacy.businessCard.company,
      email: legacy.businessCard.email,
      phone: legacy.businessCard.phone,
      source: legacy.source.rawValue,
      verificationStatus: legacy.verificationStatus.rawValue,
      receivedAt: legacy.receivedAt,
      lastInteraction: legacy.lastInteraction,
      tags: legacy.tags,
      notes: legacy.notes,
      sealedRoute: legacy.sealedRoute,
      pubKey: legacy.pubKey,
      signPubKey: legacy.signPubKey,
      didPublicKey: legacy.signPubKey
    )
  }

  func toLegacyContact() -> Contact {
    let card = BusinessCard(
      id: UUID(uuidString: cardId) ?? UUID(),
      name: name,
      title: title,
      company: company,
      email: email,
      phone: phone
    )
    return Contact(
      id: UUID(uuidString: id) ?? UUID(),
      businessCard: card,
      receivedAt: receivedAt,
      source: ContactSource(rawValue: source) ?? .manual,
      tags: tags,
      notes: notes,
      verificationStatus: VerificationStatus(rawValue: verificationStatus) ?? .unverified,
      lastInteraction: lastInteraction,
      sealedRoute: sealedRoute,
      pubKey: pubKey,
      signPubKey: signPubKey
    )
  }
}
