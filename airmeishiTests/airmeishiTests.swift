//
//  airmeishiTests.swift
//  airmeishiTests
//
//  Created by kidneyweak on 2025/09/09.
//

import Testing
@testable import airmeishi

struct airmeishiTests {
    
    @Test func testBusinessCardCreation() async throws {
        // Clear any existing data
        _ = StorageManager.shared.clearAllData()
        
        let card = BusinessCard(
            name: "John Doe",
            title: "Software Engineer",
            company: "Tech Corp",
            email: "john@techcorp.com",
            phone: "+1234567890"
        )
        
        let cardManager = CardManager.shared
        let result = cardManager.createCard(card)
        
        switch result {
        case .success(let createdCard):
            #expect(createdCard.name == "John Doe")
            #expect(createdCard.title == "Software Engineer")
            #expect(createdCard.company == "Tech Corp")
        case .failure(let error):
            Issue.record("Failed to create card: \(error.localizedDescription)")
        }
    }
    
    @Test func testEncryption() async throws {
        let encryptionManager = EncryptionManager.shared
        let testData = "Hello, World!"
        
        let encryptResult = encryptionManager.encrypt(testData)
        
        switch encryptResult {
        case .success(let encryptedData):
            let decryptResult = encryptionManager.decrypt(encryptedData, as: String.self)
            
            switch decryptResult {
            case .success(let decryptedData):
                #expect(decryptedData == testData)
            case .failure(let error):
                Issue.record("Decryption failed: \(error.localizedDescription)")
            }
        case .failure(let error):
            Issue.record("Encryption failed: \(error.localizedDescription)")
        }
    }
    
    @Test @MainActor func testContactRepository() async throws {
        // Clear any existing data
        _ = StorageManager.shared.clearAllData()
        
        let businessCard = BusinessCard(
            name: "Jane Smith",
            title: "Designer",
            company: "Design Studio"
        )
        
        let contact = Contact(
            businessCard: businessCard,
            source: .qrCode,
            tags: ["colleague", "designer"]
        )
        
        let contactRepository = ContactRepository.shared
        let result = contactRepository.addContact(contact)
        
        switch result {
        case .success(let addedContact):
            #expect(addedContact.businessCard.name == "Jane Smith")
            #expect(addedContact.source == .qrCode)
            #expect(addedContact.tags.contains("colleague"))
        case .failure(let error):
            Issue.record("Failed to add contact: \(error.localizedDescription)")
        }
    }

}
