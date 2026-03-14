//
//  ProximityManagerTests.swift
//  airmeishiTests
//
//  Unit tests for proximity sharing functionality
//

import XCTest
import MultipeerConnectivity
@testable import airmeishi

class ProximityManagerTests: XCTestCase {
    var proximityManager: ProximityManager!
    var testCard: BusinessCard!
    
    override func setUpWithError() throws {
        proximityManager = ProximityManager.shared
        
        // Create test business card
        testCard = BusinessCard(
            name: "Test User",
            title: "Software Engineer",
            company: "Test Company",
            email: "test@example.com",
            phone: "+1234567890",
            skills: [
                Skill(name: "iOS Development", category: "Programming", proficiencyLevel: .expert),
                Skill(name: "SwiftUI", category: "Framework", proficiencyLevel: .advanced)
            ],
            categories: ["Technology"]
        )
    }
    
    override func tearDownWithError() throws {
        proximityManager.disconnect()
        proximityManager = nil
        testCard = nil
    }
    
    // MARK: - Advertising Tests
    
    func testStartAdvertising() throws {
        // Given
        XCTAssertFalse(proximityManager.isAdvertising)
        
        // When
        proximityManager.startAdvertising(with: testCard, sharingLevel: .professional)
        
        // Then
        XCTAssertTrue(proximityManager.isAdvertising)
        XCTAssertEqual(proximityManager.connectionStatus, .advertising)
    }
    
    func testStopAdvertising() throws {
        // Given
        proximityManager.startAdvertising(with: testCard, sharingLevel: .professional)
        XCTAssertTrue(proximityManager.isAdvertising)
        
        // When
        proximityManager.stopAdvertising()
        
        // Then
        XCTAssertFalse(proximityManager.isAdvertising)
    }
    
    func testAdvertisingWithDifferentSharingLevels() throws {
        // Test public level
        proximityManager.startAdvertising(with: testCard, sharingLevel: .public)
        XCTAssertTrue(proximityManager.isAdvertising)
        proximityManager.stopAdvertising()
        
        // Test professional level
        proximityManager.startAdvertising(with: testCard, sharingLevel: .professional)
        XCTAssertTrue(proximityManager.isAdvertising)
        proximityManager.stopAdvertising()
        
        // Test personal level
        proximityManager.startAdvertising(with: testCard, sharingLevel: .personal)
        XCTAssertTrue(proximityManager.isAdvertising)
        proximityManager.stopAdvertising()
    }
    
    // MARK: - Browsing Tests
    
    func testStartBrowsing() throws {
        // Given
        XCTAssertFalse(proximityManager.isBrowsing)
        
        // When
        proximityManager.startBrowsing()
        
        // Then
        XCTAssertTrue(proximityManager.isBrowsing)
        XCTAssertEqual(proximityManager.connectionStatus, .browsing)
    }
    
    func testStopBrowsing() throws {
        // Given
        proximityManager.startBrowsing()
        XCTAssertTrue(proximityManager.isBrowsing)
        
        // When
        proximityManager.stopBrowsing()
        
        // Then
        XCTAssertFalse(proximityManager.isBrowsing)
    }
    
    func testAdvertisingAndBrowsingSimultaneously() throws {
        // When
        proximityManager.startAdvertising(with: testCard, sharingLevel: .professional)
        proximityManager.startBrowsing()
        
        // Then
        XCTAssertTrue(proximityManager.isAdvertising)
        XCTAssertTrue(proximityManager.isBrowsing)
        XCTAssertEqual(proximityManager.connectionStatus, .advertisingAndBrowsing)
    }
    
    // MARK: - Sharing Status Tests
    
    func testGetSharingStatus() throws {
        // Given
        proximityManager.startAdvertising(with: testCard, sharingLevel: .professional)
        
        // When
        let status = proximityManager.getSharingStatus()
        
        // Then
        XCTAssertTrue(status.isAdvertising)
        XCTAssertFalse(status.isBrowsing)
        XCTAssertEqual(status.connectedPeersCount, 0)
        XCTAssertEqual(status.nearbyPeersCount, 0)
        XCTAssertNotNil(status.currentCard)
        XCTAssertEqual(status.sharingLevel, .professional)
    }
    
    // MARK: - Disconnect Tests
    
    func testDisconnect() throws {
        // Given
        proximityManager.startAdvertising(with: testCard, sharingLevel: .professional)
        proximityManager.startBrowsing()
        
        // When
        proximityManager.disconnect()
        
        // Then
        XCTAssertFalse(proximityManager.isAdvertising)
        XCTAssertFalse(proximityManager.isBrowsing)
        XCTAssertEqual(proximityManager.connectionStatus, .disconnected)
        XCTAssertEqual(proximityManager.nearbyPeers.count, 0)
    }
    
    // MARK: - Peer Tests
    
    func testProximityPeerCreation() throws {
        // Given
        let peerID = MCPeerID(displayName: "Test Peer")
        let discoveryInfo = [
            "name": "John Doe",
            "title": "Developer",
            "company": "Tech Corp",
            "level": "professional"
        ]
        
        // When
        let peer = ProximityPeer(peerID: peerID, discoveryInfo: discoveryInfo, discoveredAt: Date())
        
        // Then
        XCTAssertEqual(peer.name, "Test Peer")
        XCTAssertEqual(peer.cardName, "John Doe")
        XCTAssertEqual(peer.cardTitle, "Developer")
        XCTAssertEqual(peer.cardCompany, "Tech Corp")
        XCTAssertEqual(peer.sharingLevel, .professional)
        XCTAssertEqual(peer.status, .disconnected)
    }
    
    // MARK: - Payload Tests
    
    func testProximitySharingPayload() throws {
        // Given
        let timestamp = Date()
        let senderID = "Test Sender"
        
        // When
        let payload = ProximitySharingPayload(
            card: testCard,
            sharingLevel: .professional,
            timestamp: timestamp,
            senderID: senderID,
            shareId: UUID(),
            issuerCommitment: nil,
            issuerProof: nil,
            sdProof: nil,
            sealedRoute: nil,
            pubKey: nil,
            signPubKey: nil
        )

        // Then
        XCTAssertEqual(payload.card.name, testCard.name)
        XCTAssertEqual(payload.sharingLevel, SharingLevel.professional)
        XCTAssertEqual(payload.timestamp, timestamp)
        XCTAssertEqual(payload.senderID, senderID)
    }

    func testPayloadSerialization() throws {
        // Given
        let payload = ProximitySharingPayload(
            card: testCard,
            sharingLevel: .professional,
            timestamp: Date(),
            senderID: "Test Sender",
            shareId: UUID(),
            issuerCommitment: nil,
            issuerProof: nil,
            sdProof: nil,
            sealedRoute: nil,
            pubKey: nil,
            signPubKey: nil
        )
        
        // When
        let data = try JSONEncoder().encode(payload)
        let decodedPayload = try JSONDecoder().decode(ProximitySharingPayload.self, from: data)
        
        // Then
        XCTAssertEqual(decodedPayload.card.name, payload.card.name)
        XCTAssertEqual(decodedPayload.sharingLevel.rawValue, payload.sharingLevel.rawValue)
        XCTAssertEqual(decodedPayload.senderID, payload.senderID)
    }
    
    // MARK: - Performance Tests
    
    func testAdvertisingPerformance() throws {
        measure {
            proximityManager.startAdvertising(with: testCard, sharingLevel: .professional)
            proximityManager.stopAdvertising()
        }
    }
    
    func testBrowsingPerformance() throws {
        measure {
            proximityManager.startBrowsing()
            proximityManager.stopBrowsing()
        }
    }
}

// MARK: - AirDrop Manager Tests

class AirDropManagerTests: XCTestCase {
    var airDropManager: AirDropManager!
    var testCard: BusinessCard!
    
    override func setUpWithError() throws {
        airDropManager = AirDropManager.shared
        
        testCard = BusinessCard(
            name: "Test User",
            title: "Software Engineer",
            company: "Test Company",
            email: "test@example.com",
            phone: "+1234567890"
        )
    }
    
    override func tearDownWithError() throws {
        airDropManager = nil
        testCard = nil
    }
    
    func testCanShareViaAirDrop() throws {
        // This will return false in simulator, true on device
        let canShare = airDropManager.canShareViaAirDrop()
        
        #if targetEnvironment(simulator)
        XCTAssertFalse(canShare)
        #else
        XCTAssertTrue(canShare)
        #endif
    }
    
    func testAirDropItemTypes() throws {
        // Test different AirDrop item types
        let businessCardItem = AirDropItem.businessCard(testCard, .professional)
        let textItem = AirDropItem.text("Test text")
        
        // Verify items can be created
        switch businessCardItem {
        case .businessCard(let card, let level):
            XCTAssertEqual(card.name, testCard.name)
            XCTAssertEqual(level, .professional)
        default:
            XCTFail("Unexpected item type")
        }
        
        switch textItem {
        case .text(let text):
            XCTAssertEqual(text, "Test text")
        default:
            XCTFail("Unexpected item type")
        }
    }
    
    // AirDropSharingOptions was removed from the codebase — test disabled
    // func testAirDropSharingOptions() throws { ... }
}