import Combine
import Foundation
import SwiftData

@MainActor
final class IdentityDataStore: ObservableObject {
  struct ExchangeMetadataPatch {
    let contactID: String
    let mySignature: Data?
    let theirSignature: Data?
    let timestamp: Date
    let myMessage: String?
    let theirMessage: String?
  }

  static let shared = IdentityDataStore()

  @Published private(set) var contacts: [ContactEntity] = []
  @Published private(set) var identityCards: [IdentityCardEntity] = []
  @Published private(set) var provableClaims: [ProvableClaimEntity] = []

  let modelContainer: ModelContainer
  let modelContext: ModelContext

  private let migrationMarker = "solidarity.identity.swiftdata.migrated.v1"
  private let refreshSubject = PassthroughSubject<Void, Never>()
  private var refreshCancellable: AnyCancellable?

  private init() {
    let url = URL.documentsDirectory.appending(path: "SolidarityIdentity_v1.store")
    let configuration = ModelConfiguration(url: url, cloudKitDatabase: .none)

    do {
      modelContainer = try ModelContainer(
        for: ContactEntity.self,
        IdentityCardEntity.self,
        ProvableClaimEntity.self,
        configurations: configuration
      )
      modelContext = modelContainer.mainContext
    } catch {
      let memoryConfiguration = ModelConfiguration(isStoredInMemoryOnly: true, cloudKitDatabase: .none)
      do {
        modelContainer = try ModelContainer(
          for: ContactEntity.self,
          IdentityCardEntity.self,
          ProvableClaimEntity.self,
          configurations: memoryConfiguration
        )
        modelContext = modelContainer.mainContext
      } catch {
        fatalError("Failed to initialize IdentityDataStore: \(error)")
      }
    }

    // Debounce rapid writes — coalesce refreshes within 100ms
    refreshCancellable = refreshSubject
      .debounce(for: .milliseconds(100), scheduler: RunLoop.main)
      .sink { [weak self] in
        self?.performRefresh()
      }

    performRefresh()
  }

  func refreshAll() {
    refreshSubject.send()
  }

  private func performRefresh() {
    contacts = fetch(FetchDescriptor<ContactEntity>())
    identityCards = fetch(FetchDescriptor<IdentityCardEntity>())
    provableClaims = fetch(FetchDescriptor<ProvableClaimEntity>())
      .sorted { $0.updatedAt > $1.updatedAt }
  }

  func runInitialMigrationIfNeeded() {
    guard !UserDefaults.standard.bool(forKey: migrationMarker) else {
      performRefresh()
      return
    }

    migrateContactsFromEncryptedStore()
    migrateCredentialsFromLibrary()

    try? modelContext.save()
    UserDefaults.standard.set(true, forKey: migrationMarker)
    performRefresh()
  }

  func upsertContact(_ contact: ContactEntity) {
    if let existing = findContact(by: contact.id) {
      existing.name = contact.name
      existing.title = contact.title
      existing.company = contact.company
      existing.email = contact.email
      existing.phone = contact.phone
      existing.verificationStatus = contact.verificationStatus
      existing.source = contact.source
      existing.receivedAt = contact.receivedAt
      existing.lastInteraction = contact.lastInteraction
      existing.tags = contact.tags
      existing.notes = contact.notes
      existing.sealedRoute = contact.sealedRoute
      existing.pubKey = contact.pubKey
      existing.signPubKey = contact.signPubKey
      existing.didPublicKey = contact.didPublicKey
      existing.exchangeSignature = contact.exchangeSignature
      existing.myExchangeSignature = contact.myExchangeSignature
      existing.exchangeTimestamp = contact.exchangeTimestamp
      existing.myEphemeralMessage = contact.myEphemeralMessage
      existing.theirEphemeralMessage = contact.theirEphemeralMessage
      existing.graphExportEdgeId = contact.graphExportEdgeId
      existing.graphCredentialRef = contact.graphCredentialRef
      existing.commonFriendsHandshakeToken = contact.commonFriendsHandshakeToken
      existing.credentialIds = contact.credentialIds
    } else {
      modelContext.insert(contact)
    }

    try? modelContext.save()
    refreshAll()
  }

  /// Attaches a credential ID reference to a contact. ContactProfile only
  /// stores references to the credential vault, never the VC contents.
  func attachCredential(contactID: String, credentialID: String) {
    guard let contact = findContact(by: contactID) else { return }
    if !contact.credentialIds.contains(credentialID) {
      contact.credentialIds.append(credentialID)
      try? modelContext.save()
      refreshAll()
    }
  }

  func updateExchangeMetadata(_ patch: ExchangeMetadataPatch) {
    guard let contact = findContact(by: patch.contactID) else { return }
    contact.myExchangeSignature = patch.mySignature
    contact.exchangeSignature = patch.theirSignature
    contact.exchangeTimestamp = patch.timestamp
    contact.myEphemeralMessage = patch.myMessage
    contact.theirEphemeralMessage = patch.theirMessage
    try? modelContext.save()
    refreshAll()
  }

  func addIdentityCard(_ card: IdentityCardEntity) {
    if let existing = findIdentityCard(by: card.id) {
      existing.type = card.type
      existing.issuerType = card.issuerType
      existing.trustLevel = card.trustLevel
      existing.title = card.title
      existing.issuerDid = card.issuerDid
      existing.holderDid = card.holderDid
      existing.issuedAt = card.issuedAt
      existing.expiresAt = card.expiresAt
      existing.status = card.status
      existing.sourceReference = card.sourceReference
      existing.rawCredentialJWT = card.rawCredentialJWT
      existing.metadataTags = card.metadataTags
      existing.updatedAt = Date()
    } else {
      modelContext.insert(card)
    }
    try? modelContext.save()
    refreshAll()
  }

  func addProvableClaim(_ claim: ProvableClaimEntity) {
    if let existing = findClaim(by: claim.id) {
      existing.claimType = claim.claimType
      existing.title = claim.title
      existing.issuerType = claim.issuerType
      existing.trustLevel = claim.trustLevel
      existing.source = claim.source
      existing.payload = claim.payload
      existing.sourceField = claim.sourceField
      existing.isPresentable = claim.isPresentable
      existing.updatedAt = Date()
    } else {
      modelContext.insert(claim)
    }
    try? modelContext.save()
    refreshAll()
  }

  func deleteContact(by id: String) {
    guard let contact = findContact(by: id) else { return }
    modelContext.delete(contact)
    try? modelContext.save()
    refreshAll()
  }

  func clearAllContacts() {
    for contact in contacts {
      modelContext.delete(contact)
    }
    try? modelContext.save()
    refreshAll()
  }

  func clearAllIdentityData() {
    for card in identityCards {
      modelContext.delete(card)
    }
    for claim in provableClaims {
      modelContext.delete(claim)
    }
    try? modelContext.save()
    refreshAll()
  }

  func removePassportCredentials() {
    let passportCards = identityCards.filter { $0.type == "passport" }
    for card in passportCards {
      let relatedClaims = provableClaims.filter { $0.identityCardId == card.id }
      for claim in relatedClaims {
        modelContext.delete(claim)
      }
      modelContext.delete(card)
    }
    try? modelContext.save()
    refreshAll()
  }

  func markClaimPresented(_ claimID: String) {
    guard let claim = findClaim(by: claimID) else { return }
    claim.lastPresentedAt = Date()
    claim.updatedAt = Date()
    try? modelContext.save()
    refreshAll()
  }

  // MARK: - Migration

  private func migrateContactsFromEncryptedStore() {
    switch StorageManager.shared.loadContacts() {
    case .failure:
      return
    case .success(let legacyContacts):
      legacyContacts.forEach { legacy in
        let entity = ContactEntity.fromLegacy(legacy)
        if findContact(by: entity.id) == nil {
          modelContext.insert(entity)
        }
      }
    }
  }

  private func migrateCredentialsFromLibrary() {
    switch VCLibrary.shared.list() {
    case .failure:
      return
    case .success(let records):
      records.forEach { record in
        let cardID = record.id.uuidString
        if findIdentityCard(by: cardID) == nil {
          let trustLevel = deriveTrustLevel(issuerDid: record.issuerDid)
          let identityCard = IdentityCardEntity(
            id: cardID,
            type: "business_card",
            issuerType: trustLevel.issuerType,
            trustLevel: trustLevel.trustLevel,
            title: record.snapshot.name,
            issuerDid: record.issuerDid,
            holderDid: record.holderDid,
            issuedAt: record.issuedAt,
            expiresAt: record.expiresAt,
            status: record.status.rawValue,
            sourceReference: record.snapshot.cardId.uuidString,
            rawCredentialJWT: record.jwt,
            metadataTags: record.metadata.tags
          )
          modelContext.insert(identityCard)
        }

        let claimID = "profile-card-\(cardID)"
        if findClaim(by: claimID) == nil {
          let payload = encodePayload([
            "name": record.snapshot.name,
            "email": record.snapshot.emails.first ?? "",
            "company": record.snapshot.company ?? "",
          ])
          let trustLevel = deriveTrustLevel(issuerDid: record.issuerDid)
          let claim = ProvableClaimEntity(
            id: claimID,
            identityCardId: cardID,
            claimType: "profile_card",
            title: "Profile Card",
            issuerType: trustLevel.issuerType,
            trustLevel: trustLevel.trustLevel,
            source: "VC Library",
            payload: payload
          )
          modelContext.insert(claim)
        }
      }
    }
  }

  private func deriveTrustLevel(issuerDid: String) -> (issuerType: String, trustLevel: String) {
    if issuerDid.contains("gov") || issuerDid.contains("passport") {
      return ("government", "green")
    }
    if issuerDid.contains("edu") || issuerDid.contains("institution") {
      return ("institution", "blue")
    }
    return ("self", "white")
  }

  private func encodePayload(_ dictionary: [String: String]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: dictionary, options: [.sortedKeys]),
      let json = String(data: data, encoding: .utf8)
    else {
      return "{}"
    }
    return json
  }

  // MARK: - Internal helpers

  private func findContact(by id: String) -> ContactEntity? {
    let descriptor = FetchDescriptor<ContactEntity>(predicate: #Predicate { $0.id == id })
    return (try? modelContext.fetch(descriptor))?.first
  }

  private func findIdentityCard(by id: String) -> IdentityCardEntity? {
    let descriptor = FetchDescriptor<IdentityCardEntity>(predicate: #Predicate { $0.id == id })
    return (try? modelContext.fetch(descriptor))?.first
  }

  private func findClaim(by id: String) -> ProvableClaimEntity? {
    let descriptor = FetchDescriptor<ProvableClaimEntity>(predicate: #Predicate { $0.id == id })
    return (try? modelContext.fetch(descriptor))?.first
  }

  private func fetch<T: PersistentModel>(_ descriptor: FetchDescriptor<T>) -> [T] {
    (try? modelContext.fetch(descriptor)) ?? []
  }
}
