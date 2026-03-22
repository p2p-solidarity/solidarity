//
//  ProximityIntegrationTests.swift
//  airmeishiTests
//
//  Integration tests for proximity sharing functionality
//

import XCTest
@testable import airmeishi

class ProximityIntegrationTests: XCTestCase {
    var proximityManager: ProximityManager!
    var airDropManager: AirDropManager!
    var deepLinkManager: DeepLinkManager!
    var testCard: BusinessCard!
    
    override func setUpWithError() throws {
        proximityManager = ProximityManager.shared
        airDropManager = AirDropManager.shared
        deepLinkManager = DeepLinkManager.shared
        
        testCard = BusinessCard(
            name: "Integration Test User",
            title: "Test Engineer",
            company: "Test Company",
            email: "test@integration.com",
            phone: "+1234567890",
            skills: [
                Skill(name: "Testing", category: "QA", proficiencyLevel: .expert)
            ],
            categories: ["Testing"]
        )
    }
    
    override func tearDownWithError() throws {
        proximityManager.disconnect()
        proximityManager = nil
        airDropManager = nil
        deepLinkManager = nil
        testCard = nil
    }
    
    // MARK: - Integration Tests
    
    func testProximityToDeepLinkIntegration() throws {
        // Test that proximity sharing creates proper URLs for deep linking
        
        // Create share URL
        let shareURL = deepLinkManager.createShareURL(for: testCard, sharingLevel: .professional)
        XCTAssertNotNil(shareURL)
        
        // Verify URL can be handled
        let handled = deepLinkManager.handleIncomingURL(shareURL!)
        XCTAssertTrue(handled)
    }
    
    func testAirDropToDeepLinkIntegration() throws {
        // Test that AirDrop sharing works with deep link URLs
        
        // Create App Clip URL
        let appClipURL = deepLinkManager.createAppClipURL(for: testCard, sharingLevel: .professional)
        XCTAssertNotNil(appClipURL)
        
        // Verify URL format is correct for App Clip
        XCTAssertTrue(appClipURL!.absoluteString.contains("clip"))
        XCTAssertTrue(appClipURL!.absoluteString.contains("card="))
    }
    
    func testQRCodeToProximityIntegration() throws {
        // Test that QR codes work with proximity sharing
        
        // Create share URL for QR code
        let shareURL = deepLinkManager.createShareURL(for: testCard, sharingLevel: .professional)
        XCTAssertNotNil(shareURL)
        
        // Test QR code handling
        let handled = deepLinkManager.handleQRCodeScan(shareURL!.absoluteString)
        XCTAssertTrue(handled)
    }
    
    func testEndToEndSharingFlow() throws {
        // Test complete sharing flow from creation to receipt
        
        // 1. Start advertising
        proximityManager.startAdvertising(with: testCard, sharingLevel: .professional)
        XCTAssertTrue(proximityManager.isAdvertising)
        
        // 2. Create shareable URL
        let shareURL = deepLinkManager.createShareURL(for: testCard, sharingLevel: .professional)
        XCTAssertNotNil(shareURL)
        
        // 3. Simulate receiving the URL
        let handled = deepLinkManager.handleIncomingURL(shareURL!)
        XCTAssertTrue(handled)
        
        // 4. Stop advertising
        proximityManager.stopAdvertising()
        XCTAssertFalse(proximityManager.isAdvertising)
    }
    
    func testSharingLevelConsistency() throws {
        // Test that sharing levels are consistent across all components
        
        for level in SharingLevel.allCases {
            // Create URL with specific sharing level
            let shareURL = deepLinkManager.createShareURL(for: testCard, sharingLevel: level)
            XCTAssertNotNil(shareURL)
            
            // Verify level is preserved in URL
            XCTAssertTrue(shareURL!.absoluteString.contains("level=\(level.rawValue)"))
            
            // Test proximity advertising with same level
            proximityManager.startAdvertising(with: testCard, sharingLevel: level)
            let status = proximityManager.getSharingStatus()
            XCTAssertEqual(status.sharingLevel, level)
            proximityManager.stopAdvertising()
        }
    }
    
    func testErrorHandling() throws {
        // Test error handling across components
        
        // Test invalid URL handling
        let invalidURL = URL(string: "https://invalid.com/test")!
        let handled = deepLinkManager.handleIncomingURL(invalidURL)
        XCTAssertFalse(handled)
        
        // Test AirDrop availability
        let canShare = airDropManager.canShareViaAirDrop()
        
        #if targetEnvironment(simulator)
        XCTAssertFalse(canShare)
        #else
        XCTAssertTrue(canShare)
        #endif
    }
    
    // MARK: - Performance Tests
    
    func testSharingPerformance() throws {
        measure {
            // Test performance of complete sharing cycle
            proximityManager.startAdvertising(with: testCard, sharingLevel: .professional)
            let _ = deepLinkManager.createShareURL(for: testCard, sharingLevel: .professional)
            proximityManager.stopAdvertising()
        }
    }
    
    func testURLCreationPerformance() throws {
        measure {
            // Test URL creation performance
            for _ in 0..<100 {
                let _ = deepLinkManager.createShareURL(for: testCard, sharingLevel: .professional)
            }
        }
    }
}