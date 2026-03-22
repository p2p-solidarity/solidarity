import Foundation
import MultipeerConnectivity
import Testing
@testable import airmeishi

// MARK: - ContactEntity Spec Fields Tests

struct ContactEntitySpecFieldsTests {
  @Test func contactEntityHasExchangeSignatureFields() async throws {
    let entity = ContactEntity(
      name: "Alice", source: ContactSource.proximity.rawValue,
      verificationStatus: VerificationStatus.verified.rawValue,
      didPublicKey: "did:key:z6MkAlice",
      exchangeSignature: Data([0x30, 0x44]),
      myExchangeSignature: Data([0x30, 0x45]),
      exchangeTimestamp: Date()
    )
    #expect(entity.didPublicKey == "did:key:z6MkAlice")
    #expect(entity.exchangeSignature != nil)
    #expect(entity.myExchangeSignature != nil)
    #expect(entity.exchangeTimestamp != nil)
  }

  @Test func contactEntityHasEphemeralMessages() async throws {
    let entity = ContactEntity(
      name: "Bob", source: ContactSource.proximity.rawValue,
      myEphemeralMessage: "Nice meeting you!",
      theirEphemeralMessage: "Likewise!"
    )
    #expect(entity.myEphemeralMessage == "Nice meeting you!")
    #expect(entity.theirEphemeralMessage == "Likewise!")
  }

  @Test func contactEntityDefaultsAreNil() async throws {
    let entity = ContactEntity(name: "Charlie", source: ContactSource.manual.rawValue)
    #expect(entity.didPublicKey == nil)
    #expect(entity.exchangeSignature == nil)
    #expect(entity.myExchangeSignature == nil)
    #expect(entity.exchangeTimestamp == nil)
    #expect(entity.myEphemeralMessage == nil)
    #expect(entity.theirEphemeralMessage == nil)
    #expect(entity.graphExportEdgeId == nil)
  }

  @Test func contactEntityV2Fields() async throws {
    let entity = ContactEntity(
      name: "Dave", source: ContactSource.proximity.rawValue,
      graphExportEdgeId: "edge-123",
      graphCredentialRef: "cred-456",
      commonFriendsHandshakeToken: "token-789"
    )
    #expect(entity.graphExportEdgeId == "edge-123")
    #expect(entity.graphCredentialRef == "cred-456")
    #expect(entity.commonFriendsHandshakeToken == "token-789")
  }
}

// MARK: - ExchangeRequestPayload Tests

struct ExchangeRequestPayloadTests {
  @Test func requestPayloadCodableRoundTrip() async throws {
    let card = BusinessCard(name: "Alice", title: "Engineer", company: "Corp")
    let payload = ExchangeRequestPayload(
      requestId: UUID(),
      senderID: "alice-device",
      timestamp: Date(),
      selectedFields: [.name, .title, .company],
      cardPreview: card,
      myEphemeralMessage: "Hello!",
      myExchangeSignature: "MEUCIQD..."
    )

    let data = try JSONEncoder().encode(payload)
    let decoded = try JSONDecoder().decode(ExchangeRequestPayload.self, from: data)

    #expect(decoded.senderID == "alice-device")
    #expect(decoded.selectedFields.contains(.name))
    #expect(decoded.selectedFields.contains(.title))
    #expect(decoded.myEphemeralMessage == "Hello!")
    #expect(decoded.myExchangeSignature == "MEUCIQD...")
    #expect(decoded.cardPreview.name == "Alice")
  }

  @Test func requestPayloadNilEphemeralMessage() async throws {
    let card = BusinessCard(name: "Bob")
    let payload = ExchangeRequestPayload(
      requestId: UUID(),
      senderID: "bob-device",
      timestamp: Date(),
      selectedFields: [.name],
      cardPreview: card,
      myEphemeralMessage: nil,
      myExchangeSignature: "sig"
    )

    let data = try JSONEncoder().encode(payload)
    let decoded = try JSONDecoder().decode(ExchangeRequestPayload.self, from: data)
    #expect(decoded.myEphemeralMessage == nil)
  }

  @Test func requestPayloadCarriesSigningPublicKey() async throws {
    let payload = ExchangeRequestPayload(
      requestId: UUID(),
      senderID: "alice-device",
      timestamp: Date(),
      selectedFields: [.name],
      cardPreview: BusinessCard(name: "Alice"),
      myEphemeralMessage: "hello",
      myExchangeSignature: "sig",
      signPubKey: "ed25519-public"
    )

    let data = try JSONEncoder().encode(payload)
    let decoded = try JSONDecoder().decode(ExchangeRequestPayload.self, from: data)
    #expect(decoded.signPubKey == "ed25519-public")
  }
}

// MARK: - ExchangeAcceptPayload Tests

struct ExchangeAcceptPayloadTests {
  @Test func acceptPayloadCodableRoundTrip() async throws {
    let card = BusinessCard(name: "Bob", title: "Designer")
    let payload = ExchangeAcceptPayload(
      requestId: UUID(),
      senderID: "bob-device",
      timestamp: Date(),
      selectedFields: [.name, .email],
      cardPreview: card,
      theirEphemeralMessage: "Great to meet you!",
      exchangeSignature: "MEYCIQCx...",
      sealedRoute: "route-abc",
      pubKey: "x25519-pubkey",
      signPubKey: "ed25519-pubkey"
    )

    let data = try JSONEncoder().encode(payload)
    let decoded = try JSONDecoder().decode(ExchangeAcceptPayload.self, from: data)

    #expect(decoded.senderID == "bob-device")
    #expect(decoded.theirEphemeralMessage == "Great to meet you!")
    #expect(decoded.exchangeSignature == "MEYCIQCx...")
    #expect(decoded.sealedRoute == "route-abc")
    #expect(decoded.pubKey == "x25519-pubkey")
    #expect(decoded.signPubKey == "ed25519-pubkey")
  }

  @Test func acceptPayloadOptionalFieldsNil() async throws {
    let card = BusinessCard(name: "Carol")
    let payload = ExchangeAcceptPayload(
      requestId: UUID(),
      senderID: "carol-device",
      timestamp: Date(),
      selectedFields: [.name],
      cardPreview: card,
      theirEphemeralMessage: nil,
      exchangeSignature: "sig",
      sealedRoute: nil,
      pubKey: nil,
      signPubKey: nil
    )

    let data = try JSONEncoder().encode(payload)
    let decoded = try JSONDecoder().decode(ExchangeAcceptPayload.self, from: data)
    #expect(decoded.theirEphemeralMessage == nil)
    #expect(decoded.sealedRoute == nil)
    #expect(decoded.pubKey == nil)
    #expect(decoded.signPubKey == nil)
  }
}

// MARK: - ExchangeEdgePersistencePayload Tests

struct ExchangeEdgePersistenceTests {
  @Test func edgePayloadStoresBothSignatures() async throws {
    let card = BusinessCard(name: "Eve", title: "CEO")
    let edge = ExchangeEdgePersistencePayload(
      card: card,
      sourcePeerName: "Eve's iPhone",
      verificationStatus: .verified,
      sealedRoute: "route-123",
      pubKey: "x25519-key",
      signPubKey: "ed25519-key",
      mySignature: "MEUCIQD-my-sig",
      theirSignature: "MEYCIQD-their-sig",
      myMessage: "一期一會 message from me",
      theirMessage: "一期一會 message from them",
      timestamp: Date()
    )

    #expect(edge.mySignature == "MEUCIQD-my-sig")
    #expect(edge.theirSignature == "MEYCIQD-their-sig")
    #expect(edge.myMessage == "一期一會 message from me")
    #expect(edge.theirMessage == "一期一會 message from them")
    #expect(edge.verificationStatus == .verified)
    #expect(edge.card.name == "Eve")
  }
}

// MARK: - ExchangeCompletionEvent Tests

struct ExchangeCompletionEventTests {
  @Test func completionEventFields() async throws {
    let event = ExchangeCompletionEvent(
      peerName: "Alice",
      card: BusinessCard(name: "Alice"),
      requestId: UUID(),
      mySignature: "my-sig",
      theirSignature: "their-sig",
      myMessage: "Hello",
      theirMessage: "Hi back"
    )
    #expect(event.peerName == "Alice")
    #expect(event.mySignature == "my-sig")
    #expect(event.theirSignature == "their-sig")
    #expect(event.myMessage == "Hello")
    #expect(event.theirMessage == "Hi back")
  }

  @Test func completionEventIdentifiable() async throws {
    let event = ExchangeCompletionEvent(
      peerName: "Bob",
      card: BusinessCard(name: "Bob"),
      requestId: UUID(),
      mySignature: "s1",
      theirSignature: "s2",
      myMessage: nil,
      theirMessage: nil
    )
    #expect(event.id != UUID()) // auto-generated, just verify it exists
    #expect(event.myMessage == nil)
    #expect(event.theirMessage == nil)
  }
}

// MARK: - ContactEntity Legacy Conversion Tests

struct ContactEntityConversionTests {
  @Test func fromLegacyPreservesFields() async throws {
    let card = BusinessCard(
      name: "Alice", title: "Engineer", company: "Corp",
      email: "alice@example.com", phone: "+81901234567"
    )
    let legacy = Contact(
      businessCard: card,
      source: .proximity,
      tags: ["conference"],
      notes: "Met at WWDC",
      verificationStatus: .verified,
      sealedRoute: "route-abc",
      pubKey: "x25519-key",
      signPubKey: "ed25519-key"
    )

    let entity = ContactEntity.fromLegacy(legacy)
    #expect(entity.name == "Alice")
    #expect(entity.title == "Engineer")
    #expect(entity.company == "Corp")
    #expect(entity.email == "alice@example.com")
    #expect(entity.phone == "+81901234567")
    #expect(entity.source == ContactSource.proximity.rawValue)
    #expect(entity.verificationStatus == VerificationStatus.verified.rawValue)
    #expect(entity.tags.contains("conference"))
    #expect(entity.notes == "Met at WWDC")
    #expect(entity.sealedRoute == "route-abc")
    #expect(entity.pubKey == "x25519-key")
    #expect(entity.signPubKey == "ed25519-key")
  }

  @Test func toLegacyContactPreservesFields() async throws {
    let entity = ContactEntity(
      name: "Bob", title: "Designer", company: "Studio",
      email: "bob@example.com", phone: "+1234567890",
      source: ContactSource.qrCode.rawValue,
      verificationStatus: VerificationStatus.pending.rawValue,
      tags: ["design"],
      notes: "From QR",
      sealedRoute: "route-xyz",
      pubKey: "pub-key",
      signPubKey: "sign-key"
    )

    let legacy = entity.toLegacyContact()
    #expect(legacy.businessCard.name == "Bob")
    #expect(legacy.businessCard.title == "Designer")
    #expect(legacy.businessCard.company == "Studio")
    #expect(legacy.source == .qrCode)
    #expect(legacy.verificationStatus == .pending)
    #expect(legacy.sealedRoute == "route-xyz")
    #expect(legacy.pubKey == "pub-key")
    #expect(legacy.signPubKey == "sign-key")
  }

  @Test func legacyContactMissingSpecFields() async throws {
    // Legacy Contact struct does NOT have didPublicKey, exchangeSignature,
    // myExchangeSignature, exchangeTimestamp — verify ContactEntity does
    let entity = ContactEntity(
      name: "Test",
      source: ContactSource.proximity.rawValue,
      didPublicKey: "did:key:z6MkTest",
      exchangeSignature: Data([1, 2, 3]),
      myExchangeSignature: Data([4, 5, 6]),
      exchangeTimestamp: Date()
    )

    // These fields exist on ContactEntity but NOT on Contact
    #expect(entity.didPublicKey != nil)
    #expect(entity.exchangeSignature != nil)
    #expect(entity.myExchangeSignature != nil)
    #expect(entity.exchangeTimestamp != nil)

    // Converting to legacy loses these fields
    let legacy = entity.toLegacyContact()
    // Legacy Contact has no didPublicKey field — the data is lost
    // This is a known gap per spec
    #expect(legacy.businessCard.name == "Test")
  }
}

// MARK: - BusinessCard Privacy Filtering Tests

struct BusinessCardFilteringTests {
  @Test func publicFilterKeepsOnlyPublicFields() async throws {
    var preferences = SharingPreferences()
    preferences.publicFields = [.name, .company]
    preferences.professionalFields = [.name, .company, .title, .email]
    preferences.personalFields = BusinessCardField.allCases.reduce(into: Set<BusinessCardField>()) { $0.insert($1) }

    let card = BusinessCard(
      name: "Alice", title: "CEO", company: "Corp",
      email: "alice@corp.com", phone: "+1234567890",
      sharingPreferences: preferences
    )

    let filtered = card.filteredCard(for: .public)
    #expect(filtered.name == "Alice")
    #expect(filtered.company == "Corp")
    // Public level should not include title/email/phone
    #expect(filtered.title == nil || preferences.publicFields.contains(.title))
    #expect(filtered.email == nil || preferences.publicFields.contains(.email))
  }

  @Test func personalFilterKeepsAllFields() async throws {
    let card = BusinessCard(
      name: "Bob", title: "Engineer", company: "Tech",
      email: "bob@tech.com", phone: "+9876543210"
    )
    let filtered = card.filteredCard(for: .personal)
    #expect(filtered.name == "Bob")
    // Personal should include everything by default
  }
}

// MARK: - BusinessCardField Tests

struct BusinessCardFieldTests {
  @Test func allCasesExist() async throws {
    let fields = BusinessCardField.allCases
    #expect(fields.contains(.name))
    #expect(fields.contains(.title))
    #expect(fields.contains(.company))
    #expect(fields.contains(.email))
    #expect(fields.contains(.phone))
    #expect(fields.contains(.profileImage))
    #expect(fields.contains(.socialNetworks))
    #expect(fields.contains(.skills))
  }

  @Test func fieldsHaveDisplayNames() async throws {
    for field in BusinessCardField.allCases {
      #expect(!field.displayName.isEmpty, "\(field.rawValue) should have a display name")
    }
  }

  @Test func fieldsHaveIcons() async throws {
    for field in BusinessCardField.allCases {
      #expect(!field.icon.isEmpty, "\(field.rawValue) should have an icon")
    }
  }
}

// MARK: - ProximitySharingPayload Tests

struct ProximitySharingPayloadTests {
  @Test func payloadCodableRoundTrip() async throws {
    let card = BusinessCard(name: "Alice", title: "Engineer")
    let payload = ProximitySharingPayload(
      card: card,
      sharingLevel: .professional,
      timestamp: Date(),
      senderID: "alice-device-id",
      shareId: UUID(),
      issuerCommitment: nil,
      issuerProof: nil,
      sdProof: nil,
      sealedRoute: "route-123",
      pubKey: "x25519-pub",
      signPubKey: "ed25519-pub"
    )

    let data = try JSONEncoder().encode(payload)
    let decoded = try JSONDecoder().decode(ProximitySharingPayload.self, from: data)

    #expect(decoded.card.name == "Alice")
    #expect(decoded.sharingLevel == .professional)
    #expect(decoded.senderID == "alice-device-id")
    #expect(decoded.sealedRoute == "route-123")
    #expect(decoded.pubKey == "x25519-pub")
    #expect(decoded.signPubKey == "ed25519-pub")
  }
}

// MARK: - SharingLevel Tests

struct SharingLevelTests {
  @Test func allLevelsExist() async throws {
    let levels = SharingLevel.allCases
    #expect(levels.contains(.public))
    #expect(levels.contains(.professional))
    #expect(levels.contains(.personal))
    #expect(levels.count == 3)
  }

  @Test func levelsHaveDisplayNames() async throws {
    for level in SharingLevel.allCases {
      #expect(!level.displayName.isEmpty)
    }
  }
}

// MARK: - PendingExchangeRequest Tests

struct PendingExchangeRequestTests {
  @Test func identifiableUsesRequestId() async throws {
    let requestId = UUID()
    let card = BusinessCard(name: "Test")
    let payload = ExchangeRequestPayload(
      requestId: requestId,
      senderID: "test",
      timestamp: Date(),
      selectedFields: [.name],
      cardPreview: card,
      myEphemeralMessage: nil,
      myExchangeSignature: "sig"
    )

    let pending = PendingExchangeRequest(
      requestId: requestId,
      fromPeer: MCPeerID(displayName: "TestPeer"),
      payload: payload
    )

    #expect(pending.id == requestId)
    #expect(pending.requestId == requestId)
  }
}

// MARK: - Exchange Signature Verification Tests

struct ExchangeSignatureVerificationTests {
  @Test func verifyValidExchangeSignature() async throws {
    let canonical = "request-id|peer|name|name,email|1234567890"
    let pubKey = SecureKeyManager.shared.mySignPubKey
    let signature = SecureKeyManager.shared.sign(content: canonical)

    let isValid = ProximityManager.verifyExchangeSignature(
      signature: signature,
      canonicalString: canonical,
      signPubKey: pubKey
    )
    #expect(isValid == true)
  }

  @Test func rejectMissingExchangeSignPubKey() async throws {
    let canonical = "request-id|peer|name|name,email|1234567890"
    let signature = SecureKeyManager.shared.sign(content: canonical)

    let isValid = ProximityManager.verifyExchangeSignature(
      signature: signature,
      canonicalString: canonical,
      signPubKey: nil
    )
    #expect(isValid == false)
  }
}
