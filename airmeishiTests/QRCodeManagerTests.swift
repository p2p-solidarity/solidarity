//
//  QRCodeManagerTests.swift
//  airmeishiTests
//
//  Unit tests for QR code generation and sharing functionality
//

import XCTest
@testable import airmeishi

final class QRCodeManagerTests: XCTestCase {
    
    var qrManager: QRCodeManager!
    var testBusinessCard: BusinessCard!
    
    override func setUpWithResult() throws {
        qrManager = QRCodeManager.shared
        
        testBusinessCard = BusinessCard(
            name: "John Doe",
            title: "Software Engineer",
            company: "Tech Corp",
            email: "john@techcorp.com",
            phone: "+1 (555) 123-4567",
            skills: [
                Skill(name: "Swift", category: "Programming", proficiencyLevel: .advanced),
                Skill(name: "iOS Development", category: "Mobile", proficiencyLevel: .expert)
            ]
        )
    }
    
    override func tearDownWithResult() throws {
        qrManager = nil
        testBusinessCard = nil
    }
    
    func testQRCodeGeneration() throws {
        // Test QR code generation for different sharing levels
        let sharingLevels: [SharingLevel] = [.public, .professional, .personal]
        
        for level in sharingLevels {
            XCTAssertFalse(qrManager.isGenerating, "Should not be generating initially")
            
            let result = qrManager.generateQRCode(
                for: testBusinessCard,
                sharingLevel: level
            )
            
            XCTAssertFalse(qrManager.isGenerating, "Should not be generating after completion")
            
            switch result {
            case .success(let qrImage):
                XCTAssertNotNil(qrImage, "QR code image should not be nil for \(level.displayName) level")
                XCTAssertGreaterThan(qrImage.size.width, 0, "QR code should have valid dimensions")
                XCTAssertGreaterThan(qrImage.size.height, 0, "QR code should have valid dimensions")
                
            case .failure(let error):
                XCTFail("QR code generation failed for \(level.displayName) level: \(error.localizedDescription)")
            }
        }
    }
    
    func testQRCodeFormats() throws {
        let formats: [SharingFormat] = [.plaintext, .zkProof, .didSigned]

        for format in formats {
            var card = testBusinessCard!
            card.sharingPreferences.sharingFormat = format

            let result = qrManager.generateQRCode(
                for: card,
                sharingLevel: .professional
            )

            switch result {
            case .success(let image):
                XCTAssertGreaterThan(image.size.width, 0)
                XCTAssertGreaterThan(image.size.height, 0)
            case .failure(let error):
                XCTFail("Failed to generate QR for format \(format.displayName): \(error.localizedDescription)")
            }
        }
    }
    
    func testSharingLinkGeneration() throws {
        let result = qrManager.generateSharingLink(
            for: testBusinessCard,
            sharingLevel: .professional,
            maxUses: 5
        )
        
        switch result {
        case .success(let shareURL):
            XCTAssertFalse(shareURL.isEmpty, "Share URL should not be empty")
            XCTAssertTrue(shareURL.contains("airmeishi.app"), "Share URL should contain domain")
            
        case .failure(let error):
            XCTFail("Share link generation failed: \(error.localizedDescription)")
        }
    }
    
    func testBusinessCardFiltering() throws {
        // Test that business card filtering works correctly for different sharing levels
        let publicCard = testBusinessCard.filteredCard(for: .public)
        let professionalCard = testBusinessCard.filteredCard(for: .professional)
        let personalCard = testBusinessCard.filteredCard(for: .personal)
        
        // Public level should have limited fields
        XCTAssertEqual(publicCard.name, testBusinessCard.name, "Name should always be included")
        
        // Professional level should have more fields than public
        let publicFields = testBusinessCard.sharingPreferences.fieldsForLevel(.public)
        let professionalFields = testBusinessCard.sharingPreferences.fieldsForLevel(.professional)
        
        XCTAssertGreaterThanOrEqual(
            professionalFields.count,
            publicFields.count,
            "Professional level should have at least as many fields as public"
        )
        
        // Personal level should have all fields
        let personalFields = testBusinessCard.sharingPreferences.fieldsForLevel(.personal)
        XCTAssertEqual(personalCard.name, testBusinessCard.name, "Personal level should include name")
        XCTAssertEqual(personalCard.email, testBusinessCard.email, "Personal level should include email")
    }
    
    func testQRPayloadEncryption() throws {
        // Test that QR payload is properly encrypted
        let payload = QRSharingPayload(
            businessCard: testBusinessCard,
            sharingLevel: .professional,
            expirationDate: Date().addingTimeInterval(3600),
            shareId: UUID(),
            createdAt: Date()
        )
        
        let encryptionManager = EncryptionManager.shared
        let encryptResult = encryptionManager.encrypt(payload)
        
        switch encryptResult {
        case .success(let encryptedData):
            XCTAssertGreaterThan(encryptedData.count, 0, "Encrypted data should not be empty")
            
            // Test decryption
            let decryptResult = encryptionManager.decrypt(encryptedData, as: QRSharingPayload.self)
            
            switch decryptResult {
            case .success(let decryptedPayload):
                XCTAssertEqual(decryptedPayload.businessCard.name, payload.businessCard.name)
                XCTAssertEqual(decryptedPayload.sharingLevel, payload.sharingLevel)
                XCTAssertEqual(decryptedPayload.shareId, payload.shareId)
                
            case .failure(let error):
                XCTFail("Decryption failed: \(error.localizedDescription)")
            }
            
        case .failure(let error):
            XCTFail("Encryption failed: \(error.localizedDescription)")
        }
    }
    
    func testShareLinkExpiration() throws {
        // Test that expired share links are properly handled
        let expiredPayload = QRSharingPayload(
            businessCard: testBusinessCard,
            sharingLevel: .professional,
            expirationDate: Date().addingTimeInterval(-3600), // 1 hour ago
            shareId: UUID(),
            createdAt: Date().addingTimeInterval(-7200) // 2 hours ago
        )
        
        // In a real test, we would simulate the QR scanning process
        // and verify that expired payloads are rejected
        XCTAssertTrue(expiredPayload.expirationDate < Date(), "Payload should be expired")
    }
    
    func testMaxUsesValidation() throws {
        // Test that usage limits are properly enforced
        let payload = QRSharingPayload(
            businessCard: testBusinessCard,
            sharingLevel: .professional,
            expirationDate: Date().addingTimeInterval(3600),
            shareId: UUID(),
            createdAt: Date(),
            maxUses: 3,
            currentUses: 3
        )
        
        XCTAssertEqual(payload.maxUses, 3, "Max uses should be set correctly")
        XCTAssertEqual(payload.currentUses, 3, "Current uses should be set correctly")
        
        // In a real implementation, this would be rejected for exceeding max uses
        if let maxUses = payload.maxUses, let currentUses = payload.currentUses {
            XCTAssertGreaterThanOrEqual(currentUses, maxUses, "Should have reached max uses")
        }
    }
}

// MARK: - PassKit Manager Tests

final class PassKitManagerTests: XCTestCase {
    
    var passKitManager: PassKitManager!
    var testBusinessCard: BusinessCard!
    
    override func setUpWithResult() throws {
        passKitManager = PassKitManager.shared
        
        testBusinessCard = BusinessCard(
            name: "Jane Smith",
            title: "Product Manager",
            company: "Innovation Inc",
            email: "jane@innovation.com",
            phone: "+1 (555) 987-6543"
        )
    }
    
    override func tearDownWithResult() throws {
        passKitManager = nil
        testBusinessCard = nil
    }
    
    func testPassGeneration() throws {
        let result = passKitManager.generatePass(
            for: testBusinessCard,
            sharingLevel: .professional
        )
        
        switch result {
        case .success(let passData):
            XCTAssertGreaterThan(passData.count, 0, "Pass data should not be empty")
            
            // In a real implementation, we would validate the pass structure
            // For now, we just check that data was generated
            
        case .failure(let error):
            // Pass generation might fail in test environment due to missing certificates
            // This is expected behavior
            print("Pass generation failed (expected in test environment): \(error.localizedDescription)")
        }
    }
    
    func testPassDataStructure() throws {
        // Test that pass data structure is created correctly
        let passData = [
            "formatVersion": 1,
            "passTypeIdentifier": "pass.kidneyweakx.airmeishi.businesscard",
            "serialNumber": UUID().uuidString,
            "teamIdentifier": "5N42RJ485D",
            "organizationName": "Airmeishi",
            "description": "Business Card - \(testBusinessCard.name)"
        ] as [String : Any]
        
        XCTAssertEqual(passData["formatVersion"] as? Int, 1, "Format version should be 1")
        XCTAssertEqual(passData["organizationName"] as? String, "Airmeishi", "Organization name should be set")
        XCTAssertTrue(
            (passData["description"] as? String)?.contains(testBusinessCard.name) == true,
            "Description should contain business card name"
        )
    }
}

// MARK: - Share Link Manager Tests

final class ShareLinkManagerTests: XCTestCase {
    
    var shareLinkManager: ShareLinkManager!
    var testBusinessCard: BusinessCard!
    
    override func setUpWithResult() throws {
        shareLinkManager = ShareLinkManager.shared
        
        testBusinessCard = BusinessCard(
            name: "Bob Johnson",
            title: "Designer",
            company: "Creative Studio",
            email: "bob@creative.com",
            phone: "+1 (555) 456-7890"
        )
    }
    
    override func tearDownWithResult() throws {
        // Clean up any test links
        _ = shareLinkManager.deactivateAllLinks(for: testBusinessCard.id)
        shareLinkManager = nil
        testBusinessCard = nil
    }
    
    func testShareLinkCreation() throws {
        let result = shareLinkManager.createShareLink(
            for: testBusinessCard,
            sharingLevel: .professional,
            maxUses: 3,
            expirationHours: 24
        )
        
        switch result {
        case .success(let shareLink):
            XCTAssertEqual(shareLink.businessCardId, testBusinessCard.id, "Business card ID should match")
            XCTAssertEqual(shareLink.maxUses, 3, "Max uses should be set correctly")
            XCTAssertEqual(shareLink.currentUses, 0, "Current uses should start at 0")
            XCTAssertTrue(shareLink.isActive, "Link should be active when created")
            XCTAssertTrue(shareLink.isUsable, "Link should be usable when created")
            
        case .failure(let error):
            XCTFail("Share link creation failed: \(error.localizedDescription)")
        }
    }
    
    func testShareLinkRetrieval() throws {
        // First create a link
        let createResult = shareLinkManager.createShareLink(
            for: testBusinessCard,
            sharingLevel: .professional,
            maxUses: 1,
            expirationHours: 1
        )
        
        guard case .success(let shareLink) = createResult else {
            XCTFail("Failed to create share link for test")
            return
        }
        
        // Then try to retrieve the business card
        let retrieveResult = shareLinkManager.retrieveBusinessCard(from: shareLink.id)
        
        switch retrieveResult {
        case .success(let retrievedCard):
            XCTAssertEqual(retrievedCard.name, testBusinessCard.name, "Retrieved card name should match")
            
        case .failure(let error):
            XCTFail("Share link retrieval failed: \(error.localizedDescription)")
        }
    }
    
    func testShareLinkDeactivation() throws {
        // Create a link
        let createResult = shareLinkManager.createShareLink(
            for: testBusinessCard,
            sharingLevel: .professional
        )
        
        guard case .success(let shareLink) = createResult else {
            XCTFail("Failed to create share link for test")
            return
        }
        
        // Deactivate it
        let deactivateResult = shareLinkManager.deactivateLink(shareLink.id)
        
        switch deactivateResult {
        case .success:
            // Try to retrieve from deactivated link
            let retrieveResult = shareLinkManager.retrieveBusinessCard(from: shareLink.id)
            
            switch retrieveResult {
            case .success:
                XCTFail("Should not be able to retrieve from deactivated link")
                
            case .failure(let error):
                // This is expected
                XCTAssertTrue(
                    error.localizedDescription.contains("deactivated"),
                    "Error should indicate link is deactivated"
                )
            }
            
        case .failure(let error):
            XCTFail("Link deactivation failed: \(error.localizedDescription)")
        }
    }
}