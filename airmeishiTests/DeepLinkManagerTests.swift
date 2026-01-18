//
//  DeepLinkManagerTests.swift
//  airmeishiTests
//
//  Unit tests for deep linking functionality
//

import XCTest
@testable import airmeishi

class DeepLinkManagerTests: XCTestCase {
    var deepLinkManager: DeepLinkManager!
    var testCard: BusinessCard!
    
    override func setUpWithError() throws {
        deepLinkManager = DeepLinkManager.shared
        
        testCard = BusinessCard(
            name: "Test User",
            title: "Software Engineer",
            company: "Test Company",
            email: "test@example.com",
            phone: "+1234567890",
            skills: [
                Skill(name: "iOS Development", category: "Programming", proficiencyLevel: .expert)
            ],
            categories: ["Technology"]
        )
    }
    
    override func tearDownWithError() throws {
        deepLinkManager = nil
        testCard = nil
    }
    
    // MARK: - URL Creation Tests
    
    func testCreateShareURL() throws {
        // When
        let shareURL = deepLinkManager.createShareURL(for: testCard, sharingLevel: .professional)
        
        // Then
        XCTAssertNotNil(shareURL)
        XCTAssertTrue(shareURL?.absoluteString.contains("airmeishi.app") == true)
        XCTAssertTrue(shareURL?.absoluteString.contains("/share") == true)
        XCTAssertTrue(shareURL?.absoluteString.contains("card=") == true)
        XCTAssertTrue(shareURL?.absoluteString.contains("level=professional") == true)
    }
    
    func testCreateAppClipURL() throws {
        // When
        let appClipURL = deepLinkManager.createAppClipURL(for: testCard, sharingLevel: .professional)
        
        // Then
        XCTAssertNotNil(appClipURL)
        XCTAssertTrue(appClipURL?.absoluteString.contains("airmeishi.app/clip") == true)
        XCTAssertTrue(appClipURL?.absoluteString.contains("card=") == true)
        XCTAssertTrue(appClipURL?.absoluteString.contains("level=professional") == true)
        XCTAssertTrue(appClipURL?.absoluteString.contains("source=qr") == true)
    }
    
    func testCreateTemporaryShareLink() throws {
        // When
        let tempURL = deepLinkManager.createTemporaryShareLink(for: testCard, sharingLevel: .professional, expirationHours: 24)
        
        // Then
        XCTAssertNotNil(tempURL)
        XCTAssertTrue(tempURL?.absoluteString.contains("airmeishi.app") == true)
        XCTAssertTrue(tempURL?.absoluteString.contains("/temp") == true)
        XCTAssertTrue(tempURL?.absoluteString.contains("expires=") == true)
    }
    
    func testCreateShareURLWithDifferentSharingLevels() throws {
        // Test all sharing levels
        for level in SharingLevel.allCases {
            let shareURL = deepLinkManager.createShareURL(for: testCard, sharingLevel: level)
            
            XCTAssertNotNil(shareURL)
            XCTAssertTrue(shareURL?.absoluteString.contains("level=\(level.rawValue)") == true)
        }
    }
    
    // MARK: - URL Handling Tests
    
    func testHandleValidShareURL() throws {
        // Given
        guard let shareURL = deepLinkManager.createShareURL(for: testCard, sharingLevel: .professional) else {
            XCTFail("Failed to create share URL")
            return
        }
        
        // When
        let handled = deepLinkManager.handleIncomingURL(shareURL)
        
        // Then
        XCTAssertTrue(handled)
    }
    
    func testHandleInvalidURL() throws {
        // Given
        let invalidURL = URL(string: "https://example.com/invalid")!
        
        // When
        let handled = deepLinkManager.handleIncomingURL(invalidURL)
        
        // Then
        XCTAssertFalse(handled)
    }
    
    func testHandleQRCodeContent() throws {
        // Given - Create a valid share URL as QR content
        guard let shareURL = deepLinkManager.createShareURL(for: testCard, sharingLevel: .professional) else {
            XCTFail("Failed to create share URL")
            return
        }
        
        // When
        let handled = deepLinkManager.handleQRCodeScan(shareURL.absoluteString)
        
        // Then
        XCTAssertTrue(handled)
    }
    
    func testHandleDirectCardDataQR() throws {
        // Given - Create direct JSON card data
        let cardData = try JSONEncoder().encode(testCard)
        let jsonString = String(data: cardData, encoding: .utf8)!
        
        // When
        let handled = deepLinkManager.handleQRCodeScan(jsonString)
        
        // Then
        XCTAssertTrue(handled)
    }
    
    func testHandleInvalidQRContent() throws {
        // Given
        let invalidContent = "invalid qr content"
        
        // When
        let handled = deepLinkManager.handleQRCodeScan(invalidContent)
        
        // Then
        XCTAssertFalse(handled)
    }
    
    // MARK: - URL Scheme Tests
    
    func testURLSchemeConfig() throws {
        // When
        let schemeURL = URLSchemeConfig.createSchemeURL(
            path: "/share",
            parameters: ["id": "test123"]
        )
        
        // Then
        XCTAssertNotNil(schemeURL)
        XCTAssertEqual(schemeURL?.scheme, "airmeishi")
        XCTAssertEqual(schemeURL?.host, "share")
        XCTAssertTrue(schemeURL?.absoluteString.contains("id=test123") == true)
    }
    
    // MARK: - Deep Link Action Tests
    
    func testDeepLinkActions() throws {
        // Test different action types
        let showCardAction = DeepLinkAction.showReceivedCard(testCard)
        let showErrorAction = DeepLinkAction.showError("Test error")
        let navigateToSharingAction = DeepLinkAction.navigateToSharing
        let navigateToContactsAction = DeepLinkAction.navigateToContacts
        
        // Verify actions can be created
        switch showCardAction {
        case .showReceivedCard(let card):
            XCTAssertEqual(card.name, testCard.name)
        default:
            XCTFail("Unexpected action type")
        }
        
        switch showErrorAction {
        case .showError(let message):
            XCTAssertEqual(message, "Test error")
        default:
            XCTFail("Unexpected action type")
        }
    }
    
    // MARK: - Performance Tests
    
    func testURLCreationPerformance() throws {
        measure {
            _ = deepLinkManager.createShareURL(for: testCard, sharingLevel: .professional)
        }
    }
    
    func testURLHandlingPerformance() throws {
        // Given
        guard let shareURL = deepLinkManager.createShareURL(for: testCard, sharingLevel: .professional) else {
            XCTFail("Failed to create share URL")
            return
        }
        
        measure {
            _ = deepLinkManager.handleIncomingURL(shareURL)
        }
    }
    
    // MARK: - Edge Cases
    
    func testHandleExpiredShareLink() throws {
        // Given - Create a temporary link that expires immediately
        let expiredURL = deepLinkManager.createTemporaryShareLink(for: testCard, sharingLevel: .professional, expirationHours: -1)
        
        guard let url = expiredURL else {
            XCTFail("Failed to create expired URL")
            return
        }
        
        // When
        let handled = deepLinkManager.handleIncomingURL(url)
        
        // Then
        XCTAssertFalse(handled)
    }
    
    func testHandleEmptyCardData() throws {
        // Given
        let emptyCard = BusinessCard(name: "")
        
        // When
        let shareURL = deepLinkManager.createShareURL(for: emptyCard, sharingLevel: .professional)
        
        // Then - Should still create URL but might fail validation
        XCTAssertNotNil(shareURL)
    }
}