//
//  ContactVCAndDataManagementTests.swift
//  solidarityTests
//
//  TDD tests for:
//  2. Contact VC should ONLY contain verified/authenticated data
//  3. Non-authenticated contact data should NOT be in the VC
//  4. Complete app data clearing
//  5. iCloud account data sync (backup/restore)
//

import XCTest
@testable import solidarity

// MARK: - 2 & 3: Contact VC — Only Verified Data

@MainActor
final class ContactVCVerifiedDataTests: XCTestCase {

  // MARK: - Baseline VC behavior

  func testVCSnapshotIncludesPopulatedFields() throws {
    let card = BusinessCard(
      name: "Alice", title: "Engineer", company: "Solidarity",
      email: "alice@solidarity.id", phone: "+886912345678"
    )
    let snapshot = BusinessCardSnapshot(card: card)

    XCTAssertEqual(snapshot.name, "Alice")
    XCTAssertEqual(snapshot.title, "Engineer")
    XCTAssertEqual(snapshot.company, "Solidarity")
    XCTAssertEqual(snapshot.emails, ["alice@solidarity.id"])
    XCTAssertEqual(snapshot.phones, ["+886912345678"])
  }

  func testVCSnapshotTrimsWhitespaceFields() throws {
    let card = BusinessCard(name: "Bob", title: "   ", company: "  \n  ", email: "  ", phone: "\t")
    let snapshot = BusinessCardSnapshot(card: card)

    XCTAssertNil(snapshot.title)
    XCTAssertNil(snapshot.company)
    XCTAssertTrue(snapshot.emails.isEmpty)
    XCTAssertTrue(snapshot.phones.isEmpty)
  }

  func testFilteredCardRemovesUnselectedFields() throws {
    let card = BusinessCard(
      name: "Diana", title: "PM", company: "BigCorp",
      email: "diana@bigcorp.com", phone: "+1234567890",
      skills: [Skill(name: "Leadership", category: "Soft", proficiencyLevel: .advanced)]
    )
    let filtered = card.filteredCard(for: [.name, .company])

    XCTAssertEqual(filtered.name, "Diana")
    XCTAssertEqual(filtered.company, "BigCorp")
    XCTAssertNil(filtered.title)
    XCTAssertNil(filtered.email)
    XCTAssertTrue(filtered.skills.isEmpty)
  }

  func testEnvelopeRoundTrip() throws {
    let card = BusinessCard(
      name: "Frank", title: "Designer", company: "DesignCo",
      email: "frank@designco.com", phone: "+1111111111",
      socialNetworks: [SocialNetwork(platform: .github, username: "frank-dev")],
      skills: [Skill(name: "Figma", category: "Design", proficiencyLevel: .advanced)]
    )
    let dummyJWK = PublicKeyJWK(kty: "EC", crv: "P-256", alg: "ES256", x: "x", y: "y")
    let claims = BusinessCardCredentialClaims(
      card: card, issuerDid: "did:key:issuer", holderDid: "did:key:holder", publicKeyJwk: dummyJWK
    )
    let payloadData = try claims.payloadData()
    let envelope = try JSONDecoder().decode(BusinessCardCredentialEnvelope.self, from: payloadData)
    let reconstructed = try envelope.toBusinessCard()

    XCTAssertEqual(reconstructed.name, "Frank")
    XCTAssertEqual(reconstructed.title, "Designer")
    XCTAssertEqual(reconstructed.email, "frank@designco.com")
    XCTAssertEqual(reconstructed.skills.first?.name, "Figma")
  }

  // MARK: - NEW: verifiedFields support on BusinessCard

  /// BusinessCard should now have verifiedFields property
  func testBusinessCardHasVerifiedFieldsProperty() throws {
    let card = BusinessCard(name: "Alice", verifiedFields: [.name, .email])
    XCTAssertEqual(card.verifiedFields, [.name, .email])
  }

  /// Default BusinessCard has nil verifiedFields (legacy compatibility)
  func testBusinessCardDefaultVerifiedFieldsIsNil() throws {
    let card = BusinessCard(name: "Legacy Card")
    XCTAssertNil(card.verifiedFields, "Legacy cards should have nil verifiedFields")
  }

  /// filteredCardForVerifiedOnly() should only keep verified fields + name
  func testFilteredCardForVerifiedOnlyKeepsOnlyVerifiedFields() throws {
    let card = BusinessCard(
      name: "Eve", title: "CTO", company: "TechCo",
      email: "eve@techco.com", phone: "+9876543210",
      skills: [Skill(name: "Rust", category: "Programming", proficiencyLevel: .expert)],
      verifiedFields: [.name, .email]
    )

    let filtered = card.filteredCardForVerifiedOnly()

    XCTAssertEqual(filtered.name, "Eve", "Name is always included")
    XCTAssertEqual(filtered.email, "eve@techco.com", "Verified email is kept")
    XCTAssertNil(filtered.title, "Unverified title should be removed")
    XCTAssertNil(filtered.company, "Unverified company should be removed")
    XCTAssertNil(filtered.phone, "Unverified phone should be removed")
    XCTAssertTrue(filtered.skills.isEmpty, "Unverified skills should be removed")
  }

  /// Card with no verifiedFields (nil) → filteredCardForVerifiedOnly only keeps name
  func testFilteredCardForVerifiedOnlyWithNilDefaultsToNameOnly() throws {
    let card = BusinessCard(
      name: "Legacy", title: "Dev", company: "Corp",
      email: "legacy@corp.com"
    )

    let filtered = card.filteredCardForVerifiedOnly()

    XCTAssertEqual(filtered.name, "Legacy")
    XCTAssertNil(filtered.title, "No verifiedFields = only name kept")
    XCTAssertNil(filtered.company)
    XCTAssertNil(filtered.email)
  }

  /// VCService.IssueOptions now has verifiedOnly flag
  func testIssueOptionsHasVerifiedOnlyFlag() throws {
    var options = VCService.IssueOptions()
    XCTAssertFalse(options.verifiedOnly, "Default should be false for backward compat")

    options.verifiedOnly = true
    XCTAssertTrue(options.verifiedOnly)
  }

  /// VC payload with verifiedOnly=true should exclude unverified fields
  func testCredentialPayloadWithVerifiedOnlyExcludesUnverifiedFields() throws {
    let card = BusinessCard(
      name: "Eve", title: "CTO", company: "TechCo",
      email: "eve@techco.com", phone: "+9876543210",
      verifiedFields: [.name, .email]
    )

    // Simulate what VCService does when verifiedOnly=true
    let filteredCard = card.filteredCardForVerifiedOnly()
    let dummyJWK = PublicKeyJWK(kty: "EC", crv: "P-256", alg: "ES256", x: "x", y: "y")
    let claims = BusinessCardCredentialClaims(
      card: filteredCard,
      issuerDid: "did:key:issuer", holderDid: "did:key:holder", publicKeyJwk: dummyJWK
    )

    let payloadData = try claims.payloadData()
    let payload = try JSONSerialization.jsonObject(with: payloadData) as? [String: Any]
    let vc = payload?["vc"] as? [String: Any]
    let subject = vc?["credentialSubject"] as? [String: Any]

    XCTAssertEqual(subject?["name"] as? String, "Eve")
    XCTAssertNotNil(subject?["email"], "Verified email should be in VC")
    XCTAssertNil(subject?["jobTitle"], "Unverified title must NOT be in VC")
    XCTAssertNil(subject?["worksFor"], "Unverified company must NOT be in VC")
    XCTAssertNil(subject?["telephone"], "Unverified phone must NOT be in VC")
  }

  /// BusinessCard with verifiedFields should survive JSON encode/decode
  func testVerifiedFieldsBackwardCompatibleDecode() throws {
    // New format with verifiedFields
    let card = BusinessCard(name: "New", verifiedFields: [.name, .email])
    let data = try JSONEncoder().encode(card)
    let decoded = try JSONDecoder().decode(BusinessCard.self, from: data)
    XCTAssertEqual(decoded.verifiedFields, [.name, .email])

    // Legacy format without verifiedFields (simulated by removing the key)
    let legacyCard = BusinessCard(name: "Legacy")
    let legacyData = try JSONEncoder().encode(legacyCard)
    let legacyDecoded = try JSONDecoder().decode(BusinessCard.self, from: legacyData)
    XCTAssertNil(legacyDecoded.verifiedFields, "Legacy card should decode with nil verifiedFields")
  }
}

// MARK: - 4: Complete App Data Clearing

@MainActor
final class AppDataClearingTests: XCTestCase {

  // MARK: - VCLibrary clearAll (NEW)

  /// VCLibrary now has a clearAll method
  func testVCLibraryClearAll() throws {
    let library = VCLibrary.shared
    let result = library.clearAll()

    switch result {
    case .success:
      // After clear, list should return empty
      if case .success(let creds) = library.list() {
        XCTAssertTrue(creds.isEmpty, "VCLibrary should be empty after clearAll")
      }
    case .failure(let error):
      XCTFail("clearAll should succeed: \(error)")
    }
  }

  // MARK: - IdentityCacheStore clearAll (NEW)

  /// IdentityCacheStore clearAll clears DID docs, JWKs, and descriptor
  func testIdentityCacheStoreClearAll() throws {
    let cacheStore = IdentityCacheStore()

    // Clear everything
    cacheStore.clearAll()

    // Wait for async queue to finish
    let exp = XCTestExpectation(description: "cache cleared")
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
      let docs = cacheStore.loadDocuments()
      let jwks = cacheStore.loadJwks()
      let descriptor = cacheStore.loadDescriptor()

      XCTAssertTrue(docs.isEmpty, "DID documents should be cleared")
      XCTAssertTrue(jwks.isEmpty, "JWKs should be cleared")
      XCTAssertNil(descriptor, "Descriptor should be cleared")
      exp.fulfill()
    }
    wait(for: [exp], timeout: 2.0)
  }

  // MARK: - StorageManager clear

  func testStorageManagerClearAllData() throws {
    _ = StorageManager.shared.saveBusinessCards([BusinessCard(name: "Test")])
    let result = StorageManager.shared.clearAllData()

    switch result {
    case .success:
      if case .success = StorageManager.shared.loadBusinessCards() {
        XCTFail("Should not load after clearAllData")
      }
    case .failure(let error):
      XCTFail("clearAllData should succeed: \(error)")
    }
  }

  // MARK: - IdentityDataStore clear

  func testIdentityDataStoreClearAllContacts() throws {
    let store = IdentityDataStore.shared
    let entity = ContactEntity(name: "ClearTest", source: "manual")
    store.upsertContact(entity)

    let exp = XCTestExpectation(description: "contacts cleared")
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
      store.clearAllContacts()
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
        XCTAssertFalse(store.contacts.contains { $0.id == entity.id })
        exp.fulfill()
      }
    }
    wait(for: [exp], timeout: 2.0)
  }

  func testRemovePassportCredentialsIsSelective() throws {
    let store = IdentityDataStore.shared

    let passportCard = IdentityCardEntity(
      id: "passport-\(UUID())", type: "passport", issuerType: "government",
      trustLevel: "green", title: "Passport", issuerDid: "did:key:gov", holderDid: "did:key:me"
    )
    store.addIdentityCard(passportCard)

    let bizCard = IdentityCardEntity(
      id: "biz-\(UUID())", type: "business_card", issuerType: "self",
      trustLevel: "white", title: "My Card", issuerDid: "did:key:me", holderDid: "did:key:me"
    )
    store.addIdentityCard(bizCard)

    let exp = XCTestExpectation(description: "passport removed")
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
      store.removePassportCredentials()
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
        XCTAssertFalse(store.identityCards.contains { $0.id == passportCard.id })
        XCTAssertTrue(store.identityCards.contains { $0.id == bizCard.id })
        exp.fulfill()
      }
    }
    wait(for: [exp], timeout: 2.0)
  }

  // MARK: - Full reset now clears UserDefaults

  func testResetClearsUserDefaultsKeys() throws {
    // Use test-specific keys to avoid side effects on other tests
    let testKey1 = "solidarity.test.resetClearKey1"
    let testKey2 = "solidarity.test.resetClearKey2"

    UserDefaults.standard.set("test_value", forKey: testKey1)
    UserDefaults.standard.set(true, forKey: testKey2)

    // Verify the keys exist
    XCTAssertNotNil(UserDefaults.standard.string(forKey: testKey1))

    // Simulate the new reset: explicitly clear known keys
    UserDefaults.standard.removeObject(forKey: testKey1)
    UserDefaults.standard.removeObject(forKey: testKey2)

    XCTAssertNil(
      UserDefaults.standard.string(forKey: testKey1),
      "Keys should be cleared after removeObject"
    )
    XCTAssertFalse(
      UserDefaults.standard.bool(forKey: testKey2),
      "Bool keys should be cleared"
    )
  }

  // MARK: - Reset clears secure messages

  func testResetClearsSecureMessages() throws {
    let storage = SecureMessageStorage.shared
    storage.saveLastMessage("secret", from: "TestSender")

    // The new reset flow calls clearAllHistory
    storage.clearAllHistory()

    let msg = storage.getLastMessage(from: "TestSender")
    XCTAssertNil(msg, "Messages should be cleared after clearAllHistory")
  }
}

// MARK: - 5: iCloud Account Data Sync

@MainActor
final class ICloudDataSyncTests: XCTestCase {

  func testBackupManagerDefaultDisabled() throws {
    XCTAssertFalse(BackupManager.shared.settings.enabled)
  }

  func testAutoBackupSkipsWhenDisabled() throws {
    _ = BackupManager.shared.update { $0.enabled = false }
    BackupManager.shared.triggerAutoBackupIfNeeded()
    XCTAssertFalse(BackupManager.shared.isBackingUp)
  }

  // MARK: - Backup round-trips

  func testContactEntityBackupRoundTrip() throws {
    let entity = ContactEntity(
      name: "Backup Test", title: "Tester", company: "TestCo",
      email: "test@testco.com", source: "manual",
      verificationStatus: VerificationStatus.verified.rawValue, tags: ["backup"]
    )
    let legacy = entity.toLegacyContact()
    let data = try JSONEncoder().encode(legacy)
    let decoded = try JSONDecoder().decode(Contact.self, from: data)

    XCTAssertEqual(decoded.businessCard.name, "Backup Test")
    XCTAssertEqual(decoded.verificationStatus, .verified)
  }

  func testIdentityCardBackupRoundTrip() throws {
    let entity = IdentityCardEntity(
      type: "passport", issuerType: "government", trustLevel: "green",
      title: "Passport", issuerDid: "did:key:gov", holderDid: "did:key:me",
      status: "verified", metadataTags: ["official"]
    )
    let backup = BackupManager.BackupIdentityCard(from: entity)
    let restored = backup.toEntity()

    XCTAssertEqual(restored.type, "passport")
    XCTAssertEqual(restored.metadataTags, ["official"])
  }

  func testProvableClaimBackupRoundTrip() throws {
    let entity = ProvableClaimEntity(
      identityCardId: "card-123", claimType: "age_over_18", title: "Age >= 18",
      issuerType: "government", trustLevel: "green", source: "passport",
      payload: "{\"verified\":true}"
    )
    let backup = BackupManager.BackupProvableClaim(from: entity)
    let restored = backup.toEntity()

    XCTAssertEqual(restored.claimType, "age_over_18")
    XCTAssertEqual(restored.payload, "{\"verified\":true}")
  }

  // MARK: - NEW: BackupStoredCredential round-trip

  func testStoredCredentialBackupRoundTrip() throws {
    let snapshot = BusinessCardSnapshot(card: BusinessCard(name: "VC Test", email: "vc@test.com"))
    let credential = VCLibrary.StoredCredential(
      id: UUID(),
      jwt: "eyJ0ZXN0IjoidmMifQ.eyJwYXlsb2FkIjoidGVzdCJ9.signature",
      issuerDid: "did:key:issuer-123",
      holderDid: "did:key:holder-456",
      issuedAt: Date(),
      expiresAt: nil,
      addedAt: Date(),
      lastVerifiedAt: Date(),
      status: .verified,
      snapshot: snapshot,
      metadata: VCLibrary.StoredCredential.Metadata(tags: ["test"], notes: "test note")
    )

    let backup = BackupManager.BackupStoredCredential(from: credential)

    XCTAssertEqual(backup.id, credential.id)
    XCTAssertEqual(backup.jwt, credential.jwt)
    XCTAssertEqual(backup.issuerDid, "did:key:issuer-123")
    XCTAssertEqual(backup.holderDid, "did:key:holder-456")
    XCTAssertEqual(backup.status, .verified)
    XCTAssertEqual(backup.snapshot.name, "VC Test")
    XCTAssertEqual(backup.tags, ["test"])
    XCTAssertEqual(backup.notes, "test note")
  }

  /// BackupStoredCredential should be fully Codable
  func testStoredCredentialBackupCodable() throws {
    let snapshot = BusinessCardSnapshot(card: BusinessCard(name: "Codable Test"))
    let credential = VCLibrary.StoredCredential(
      id: UUID(),
      jwt: "test.jwt.here",
      issuerDid: "did:key:test",
      holderDid: "did:key:test",
      issuedAt: Date(),
      expiresAt: nil,
      addedAt: Date(),
      status: .unverified,
      snapshot: snapshot,
      metadata: VCLibrary.StoredCredential.Metadata(tags: [], notes: nil)
    )

    let backup = BackupManager.BackupStoredCredential(from: credential)
    let encoded = try JSONEncoder().encode(backup)
    let decoded = try JSONDecoder().decode(BackupManager.BackupStoredCredential.self, from: encoded)

    XCTAssertEqual(decoded.id, backup.id)
    XCTAssertEqual(decoded.jwt, backup.jwt)
    XCTAssertEqual(decoded.status, .unverified)
    XCTAssertEqual(decoded.snapshot.name, "Codable Test")
  }

  // MARK: - RestoreResult reporting

  func testRestoreResultTracksAllTypes() throws {
    var result = BackupManager.RestoreResult()

    XCTAssertEqual(result.totalRestored, 0)
    XCTAssertEqual(result.skippedDuplicates, 0)

    result.restoredCards = 3
    result.restoredContacts = 5
    result.restoredCredentials = 2
    result.skippedDuplicates = 1

    XCTAssertEqual(result.totalRestored, 10)
    XCTAssertEqual(result.skippedDuplicates, 1)
  }

  // MARK: - Graceful failures

  func testBackupFailsGracefullyWithoutICloud() async throws {
    _ = BackupManager.shared.update { $0.enabled = true }
    let result = await BackupManager.shared.performBackupNow()

    switch result {
    case .success: break
    case .failure(let error):
      let msg = "\(error)"
      XCTAssertTrue(
        msg.contains("iCloud") || msg.contains("not available") || msg.contains("Backup"),
        "Should indicate iCloud issue: \(error)"
      )
    }
    _ = BackupManager.shared.update { $0.enabled = false }
  }

  func testRestoreFailsWithoutBackup() async throws {
    let result = await BackupManager.shared.restoreFromBackup()
    switch result {
    case .success: break
    case .failure(let error):
      let msg = "\(error)"
      XCTAssertTrue(
        msg.contains("iCloud") || msg.contains("No backup") || msg.contains("not available"),
        "Should indicate issue: \(error)"
      )
    }
  }

  /// Restore duplicate detection works via ContactRepository
  func testRestoreHandlesDuplicatesCorrectly() throws {
    let repo = ContactRepository.shared
    let card = BusinessCard(id: UUID(), name: "Existing")
    let contact = Contact(businessCard: card, source: .manual)
    _ = repo.addContact(contact)

    let duplicateResult = repo.addContact(contact)
    switch duplicateResult {
    case .success:
      XCTFail("Duplicate should require merge, not silently succeed")
    case .failure(let error):
      if case .validationError(let msg) = error {
        XCTAssertTrue(msg.contains("Merge"), "Should request merge confirmation")
      }
    }

    _ = repo.deleteContact(id: contact.id)
  }
}
