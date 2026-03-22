//
//  ContactManagementTests.swift
//  airmeishiTests
//
//  Tests for contact management and cryptographic core functionality
//

import XCTest
@testable import airmeishi

@MainActor
final class ContactManagementTests: XCTestCase {
    
    var contactRepository: ContactRepository!
    var keyManager: KeyManager!
    var domainVerificationManager: DomainVerificationManager!
    var proofGenerationManager: ProofGenerationManager!
    var errorHandlingManager: ErrorHandlingManager!
    var offlineManager: OfflineManager!
    
    override func setUp() async throws {
        try await super.setUp()
        
        // Initialize managers
        contactRepository = ContactRepository.shared
        keyManager = KeyManager.shared
        domainVerificationManager = DomainVerificationManager.shared
        proofGenerationManager = ProofGenerationManager.shared
        errorHandlingManager = ErrorHandlingManager.shared
        offlineManager = OfflineManager.shared
        
        // Clear any existing data
        let _ = contactRepository.getAllContacts().map { contacts in
            contacts.forEach { contact in
                let _ = contactRepository.deleteContact(id: contact.id)
            }
        }
        
        // Initialize cryptographic keys
        let _ = keyManager.initializeKeys()
    }
    
    override func tearDown() async throws {
        // Clean up
        let _ = contactRepository.getAllContacts().map { contacts in
            contacts.forEach { contact in
                let _ = contactRepository.deleteContact(id: contact.id)
            }
        }
        
        try await super.tearDown()
    }
    
    // MARK: - Contact Management Tests
    
    func testAddContact() throws {
        // Given
        let businessCard = BusinessCard.sample
        let contact = Contact(
            businessCard: businessCard,
            source: .qrCode,
            tags: ["test", "colleague"]
        )
        
        // When
        let result = contactRepository.addContact(contact)
        
        // Then
        switch result {
        case .success(let addedContact):
            XCTAssertEqual(addedContact.id, contact.id)
            XCTAssertEqual(addedContact.businessCard.name, businessCard.name)
            XCTAssertEqual(addedContact.tags, ["test", "colleague"])
        case .failure(let error):
            XCTFail("Failed to add contact: \(error)")
        }
    }

    func testDuplicateContactRequiresMergeConfirmation() throws {
        let sharedCardId = UUID()
        let existing = Contact(
            businessCard: BusinessCard(id: sharedCardId, name: "Alice Existing"),
            source: .qrCode,
            tags: ["existing"]
        )
        let incoming = Contact(
            businessCard: BusinessCard(id: sharedCardId, name: "Alice Updated"),
            source: .proximity,
            tags: ["incoming"]
        )

        _ = contactRepository.addContact(existing)
        let duplicateResult = contactRepository.addContact(incoming)

        switch duplicateResult {
        case .success:
            XCTFail("Expected duplicate contact to require merge confirmation")
        case .failure(let error):
            if case .validationError(let message) = error {
                XCTAssertTrue(message.contains("Merge confirmation required"))
            } else {
                XCTFail("Expected validationError for duplicate merge confirmation")
            }
        }

        XCTAssertNotNil(contactRepository.pendingMergeProposal)

        let mergeResult = contactRepository.resolvePendingMerge(accept: true)
        switch mergeResult {
        case .success(let merged):
            guard let merged else {
                XCTFail("Expected merged contact after accepting merge")
                return
            }
            XCTAssertEqual(merged.businessCard.name, "Alice Updated")
            XCTAssertTrue(merged.tags.contains("existing"))
            XCTAssertTrue(merged.tags.contains("incoming"))
        case .failure(let error):
            XCTFail("Merge confirmation failed: \(error)")
        }
    }
    
    func testUpdateContact() throws {
        // Given
        let businessCard = BusinessCard.sample
        var contact = Contact(
            businessCard: businessCard,
            source: .qrCode
        )
        
        let _ = contactRepository.addContact(contact)
        
        // When
        contact.addTag("updated")
        contact.notes = "Updated notes"
        let result = contactRepository.updateContact(contact)
        
        // Then
        switch result {
        case .success(let updatedContact):
            XCTAssertTrue(updatedContact.tags.contains("updated"))
            XCTAssertEqual(updatedContact.notes, "Updated notes")
        case .failure(let error):
            XCTFail("Failed to update contact: \(error)")
        }
    }
    
    func testSearchContacts() throws {
        // Given
        let contact1 = Contact(
            businessCard: BusinessCard(name: "John Doe", company: "Apple Inc."),
            source: .qrCode
        )
        let contact2 = Contact(
            businessCard: BusinessCard(name: "Jane Smith", company: "Google LLC"),
            source: .proximity
        )
        
        let _ = contactRepository.addContact(contact1)
        let _ = contactRepository.addContact(contact2)
        
        // When
        let searchResult = contactRepository.searchContacts(query: "Apple")
        
        // Then
        switch searchResult {
        case .success(let contacts):
            XCTAssertEqual(contacts.count, 1)
            XCTAssertEqual(contacts.first?.businessCard.name, "John Doe")
        case .failure(let error):
            XCTFail("Failed to search contacts: \(error)")
        }
    }
    
    func testFilterContactsBySource() throws {
        // Given
        let contact1 = Contact(
            businessCard: BusinessCard(name: "QR Contact"),
            source: .qrCode
        )
        let contact2 = Contact(
            businessCard: BusinessCard(name: "Proximity Contact"),
            source: .proximity
        )
        
        let _ = contactRepository.addContact(contact1)
        let _ = contactRepository.addContact(contact2)
        
        // When
        let filterResult = contactRepository.getContactsBySource(.qrCode)
        
        // Then
        switch filterResult {
        case .success(let contacts):
            XCTAssertEqual(contacts.count, 1)
            XCTAssertEqual(contacts.first?.businessCard.name, "QR Contact")
        case .failure(let error):
            XCTFail("Failed to filter contacts: \(error)")
        }
    }
    
    // MARK: - Key Management Tests
    
    func testKeyInitialization() throws {
        // When
        let result = keyManager.initializeKeys()
        
        // Then
        switch result {
        case .success:
            // Verify keys can be retrieved
            let masterKeyResult = keyManager.getMasterKey()
            XCTAssertTrue(masterKeyResult.isSuccess)
            
            let signingKeyResult = keyManager.getSigningKeyPair()
            XCTAssertTrue(signingKeyResult.isSuccess)
            
        case .failure(let error):
            XCTFail("Failed to initialize keys: \(error)")
        }
    }
    
    func testKeyDerivation() throws {
        // Given
        let masterKeyResult = keyManager.getMasterKey()
        guard case .success(let masterKey) = masterKeyResult else {
            XCTFail("Failed to get master key")
            return
        }
        
        // When
        let derivedKeyResult = keyManager.deriveKey(
            from: masterKey,
            purpose: "test",
            context: "unit_test"
        )
        
        // Then
        switch derivedKeyResult {
        case .success(let derivedKey):
            XCTAssertNotEqual(
                masterKey.withUnsafeBytes { Data($0) },
                derivedKey.withUnsafeBytes { Data($0) }
            )
        case .failure(let error):
            XCTFail("Failed to derive key: \(error)")
        }
    }
    
    func testPublicKeyExport() throws {
        // When
        let result = keyManager.exportPublicKeys()
        
        // Then
        switch result {
        case .success(let bundle):
            XCTAssertFalse(bundle.keyId.isEmpty)
            XCTAssertEqual(bundle.signingPublicKey.count, 64) // P256 public key size
            XCTAssertFalse(bundle.isExpired)
        case .failure(let error):
            XCTFail("Failed to export public keys: \(error)")
        }
    }
    
    // MARK: - Domain Verification Tests
    
    func testDomainExtraction() throws {
        // When
        let result1 = domainVerificationManager.verifyDomain(for: "test@apple.com")
        let result2 = domainVerificationManager.verifyDomain(for: "invalid-email")
        
        // Then
        switch result1 {
        case .success(let verification):
            XCTAssertEqual(verification.domain, "apple.com")
            XCTAssertTrue(verification.isVerified) // apple.com is in trusted list
        case .failure(let error):
            XCTFail("Failed to verify domain: \(error)")
        }
        
        switch result2 {
        case .success:
            XCTFail("Should have failed for invalid email")
        case .failure:
            // Expected to fail
            break
        }
    }
    
    func testDomainProofGeneration() throws {
        // When
        let result = domainVerificationManager.generateDomainProof(for: "test@example.com")
        
        // Then
        switch result {
        case .success(let proof):
            XCTAssertEqual(proof.domain, "example.com")
            XCTAssertFalse(proof.commitment.isEmpty)
            XCTAssertFalse(proof.domainHash.isEmpty)
            XCTAssertFalse(proof.isExpired)
        case .failure(let error):
            XCTFail("Failed to generate domain proof: \(error)")
        }
    }
    
    func testGroupMembershipProof() throws {
        // When
        let result = domainVerificationManager.generateGroupMembershipProof(
            userEmail: "employee@company.com",
            groupDomain: "company.com",
            groupId: "engineering"
        )
        
        // Then
        switch result {
        case .success(let proof):
            XCTAssertEqual(proof.groupDomain, "company.com")
            XCTAssertEqual(proof.groupId, "engineering")
            XCTAssertFalse(proof.anonymousId.isEmpty)
            XCTAssertFalse(proof.isExpired)
        case .failure(let error):
            XCTFail("Failed to generate group membership proof: \(error)")
        }
    }
    
    // MARK: - Proof Generation Tests
    
    func testSelectiveDisclosureProof() throws {
        // Given
        let businessCard = BusinessCard.sample
        let selectedFields: Set<BusinessCardField> = [.name, .company, .email]
        
        // When
        let result = proofGenerationManager.generateSelectiveDisclosureProof(
            businessCard: businessCard,
            selectedFields: selectedFields,
            recipientId: "test-recipient"
        )
        
        // Then
        switch result {
        case .success(let proof):
            XCTAssertEqual(proof.businessCardId, businessCard.id.uuidString)
            XCTAssertEqual(proof.disclosedFields.count, 3)
            XCTAssertTrue(proof.disclosedFields.keys.contains(.name))
            XCTAssertTrue(proof.disclosedFields.keys.contains(.company))
            XCTAssertTrue(proof.disclosedFields.keys.contains(.email))
            XCTAssertFalse(proof.isExpired)
        case .failure(let error):
            XCTFail("Failed to generate selective disclosure proof: \(error)")
        }
    }
    
    func testAttributeProof() throws {
        // Given
        let businessCard = BusinessCard.sample
        
        // When
        let result = proofGenerationManager.generateAttributeProof(
            businessCard: businessCard,
            attribute: .skill,
            value: "Swift"
        )
        
        // Then
        switch result {
        case .success(let proof):
            XCTAssertEqual(proof.businessCardId, businessCard.id.uuidString)
            XCTAssertEqual(proof.attributeType, .skill)
            XCTAssertFalse(proof.commitment.isEmpty)
            XCTAssertFalse(proof.isExpired)
        case .failure(let error):
            XCTFail("Failed to generate attribute proof: \(error)")
        }
    }
    
    func testRangeProof() throws {
        // Given
        let businessCard = BusinessCard.sample
        
        // When
        let result = proofGenerationManager.generateRangeProof(
            businessCard: businessCard,
            attribute: .skill,
            range: 1...5
        )
        
        // Then
        switch result {
        case .success(let proof):
            XCTAssertEqual(proof.businessCardId, businessCard.id.uuidString)
            XCTAssertEqual(proof.attributeType, .skill)
            XCTAssertTrue(proof.isInRange) // Sample has 3 skills, which is in range 1...5
            XCTAssertFalse(proof.isExpired)
        case .failure(let error):
            XCTFail("Failed to generate range proof: \(error)")
        }
    }
    
    // MARK: - Error Handling Tests
    
    func testErrorLogging() throws {
        // Given
        let error = CardError.validationError("Test validation error")
        
        // When
        errorHandlingManager.logError(error, operation: "test_operation")
        
        // Then
        let statistics = errorHandlingManager.getErrorStatistics()
        XCTAssertGreaterThan(statistics.totalErrors, 0)
        XCTAssertEqual(statistics.lastError?.operation, "test_operation")
    }
    
    func testErrorRetryLogic() async throws {
        // Given
        var attemptCount = 0
        let operation: () -> CardResult<String> = {
            attemptCount += 1
            if attemptCount < 3 {
                return .failure(.networkError("Simulated network error"))
            }
            return .success("Success on attempt \(attemptCount)")
        }
        
        // When
        let result = await errorHandlingManager.handleErrorWithRetry(
            operation: operation,
            maxRetries: 3,
            retryDelay: 0.1,
            operationName: "test_retry"
        )
        
        // Then
        switch result {
        case .success(let value):
            XCTAssertEqual(value, "Success on attempt 3")
            XCTAssertEqual(attemptCount, 3)
        case .failure(let error):
            XCTFail("Retry logic should have succeeded: \(error)")
        }
    }
    
    // MARK: - Offline Functionality Tests
    
    func testOfflineCapabilities() throws {
        // When
        let capabilities = offlineManager.getOfflineCapabilities()
        
        // Then
        XCTAssertGreaterThan(capabilities.totalOperations, 0)
        XCTAssertGreaterThan(capabilities.offlineOperations, 0)
        XCTAssertGreaterThan(capabilities.offlinePercentage, 0)
    }
    
    func testOperationQueuing() throws {
        // Given
        let operation = PendingOperation(
            type: .generateWalletPass,
            data: ["cardId": "test-card-id"]
        )
        
        // When
        let result = offlineManager.queueOperation(operation)
        
        // Then
        switch result {
        case .success:
            let capabilities = offlineManager.getOfflineCapabilities()
            XCTAssertGreaterThan(capabilities.pendingOperationsCount, 0)
        case .failure(let error):
            XCTFail("Failed to queue operation: \(error)")
        }
    }
    
    func testNetworkQuality() throws {
        // When
        let quality = offlineManager.getNetworkQuality()
        
        // Then
        XCTAssertNotNil(quality.connectionType)
        XCTAssertNotNil(quality.quality)
        XCTAssertGreaterThanOrEqual(quality.estimatedBandwidth, 0)
    }
}

// MARK: - Test Helpers

extension CardResult {
    var isSuccess: Bool {
        if case .success = self {
            return true
        }
        return false
    }
    
    var isFailure: Bool {
        return !isSuccess
    }
}
