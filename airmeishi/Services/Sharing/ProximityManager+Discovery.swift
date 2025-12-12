//
//  ProximityManager+Discovery.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import Foundation
import MultipeerConnectivity
import UIKit

extension ProximityManager {
    
    // MARK: - Public Methods
    
    /// Start auto-pilot matching (Advertising + Browsing) with automatic connection and retries
    func startMatching(with card: BusinessCard?, sharingLevel: SharingLevel = .professional) {
        autoConnectEnabled = true
        
        if let card = card {
            startAdvertising(with: card, sharingLevel: sharingLevel)
        } else {
            startAdvertisingIdentity()
        }
        
        startBrowsing()
        startHeartbeat()
        
        print("Started Auto-Pilot Matching")
    }
    
    /// Start advertising the current business card for proximity sharing
    func startAdvertising(with card: BusinessCard, sharingLevel: SharingLevel) {
        guard !isAdvertising else { return }
        
        currentCard = card
        currentSharingLevel = sharingLevel
        
        // Create discovery info with card preview
        let discoveryInfo = createDiscoveryInfo(for: card, level: sharingLevel)
        
        advertiser = MCNearbyServiceAdvertiser(
            peer: localPeerID,
            discoveryInfo: discoveryInfo,
            serviceType: serviceType
        )
        
        advertiser?.delegate = self
        advertiser?.startAdvertisingPeer()
        
        isAdvertising = true
        connectionStatus = .advertising
        
        print("Started advertising business card: \(card.name)")
    }
    
    /// Start advertising identity-only (no business card), so peers can still find and invite
    func startAdvertisingIdentity(displayName: String? = nil) {
        guard !isAdvertising else { return }
        
        currentCard = nil
        currentSharingLevel = .public
        
        var info: [String: String] = [:]
        let name = displayName ?? UIDevice.current.name
        info["name"] = name
        info["level"] = SharingLevel.public.rawValue
        info["idOnly"] = "1"
        info["timestamp"] = String(Int(Date().timeIntervalSince1970))
        
        advertiser = MCNearbyServiceAdvertiser(
            peer: localPeerID,
            discoveryInfo: info,
            serviceType: serviceType
        )
        advertiser?.delegate = self
        advertiser?.startAdvertisingPeer()
        
        isAdvertising = true
        updateConnectionStatus()
        
        print("Started advertising identity-only: \(name)")
    }
    
    /// Stop advertising
    func stopAdvertising() {
        guard isAdvertising else { return }
        
        advertiser?.stopAdvertisingPeer()
        advertiser = nil
        
        isAdvertising = false
        currentCard = nil
        
        updateConnectionStatus()
        
        print("Stopped advertising")
    }
    
    /// Start browsing for nearby peers
    func startBrowsing() {
        guard !isBrowsing else { return }
        
        browser = MCNearbyServiceBrowser(peer: localPeerID, serviceType: serviceType)
        browser?.delegate = self
        browser?.startBrowsingForPeers()
        
        isBrowsing = true
        connectionStatus = .browsing
        
        print("Started browsing for nearby peers")
        
        // Clear any previous status message since we are starting fresh
        matchingInfoMessage = nil
    }
    
    /// Stop browsing
    func stopBrowsing() {
        guard isBrowsing else { return }
        
        browser?.stopBrowsingForPeers()
        browser = nil
        
        isBrowsing = false
        nearbyPeers.removeAll()
        
        updateConnectionStatus()
        
        print("Stopped browsing")
    }
    
    /// Check if the app has the required network permissions
    func checkNetworkPermissions() -> Bool {
        // Check if Info.plist contains required keys
        guard let infoPlist = Bundle.main.infoDictionary else {
            print("Info.plist not found")
            return false
        }
        
        // Check for NSLocalNetworkUsageDescription (try both formats)
        let hasLocalNetworkDescription = infoPlist["NSLocalNetworkUsageDescription"] is String ||
                                       infoPlist["INFOPLIST_KEY_NSLocalNetworkUsageDescription"] is String
        
        guard hasLocalNetworkDescription else {
            print("NSLocalNetworkUsageDescription not found in Info.plist")
            return false
        }
        
        // Check for NSBonjourServices (try both formats)
        let bonjourServices: [String]?
        if let directServices = infoPlist["NSBonjourServices"] as? [String] {
            bonjourServices = directServices
        } else if let keyServices = infoPlist["INFOPLIST_KEY_NSBonjourServices"] as? [String] {
            bonjourServices = keyServices
        } else {
            bonjourServices = nil
        }
        
        guard let services = bonjourServices else {
            print("NSBonjourServices not found in Info.plist")
            return false
        }
        
        // Check if our service type is declared
        let expectedService = "_airmeishi-share._tcp."
        let hasService = services.contains(expectedService)
        
        if !hasService {
            print("Expected service \(expectedService) not found in NSBonjourServices: \(services)")
        }
        
        return hasService
    }
    
    internal func createDiscoveryInfo(for card: BusinessCard, level: SharingLevel) -> [String: String] {
        let filteredCard = card.filteredCard(for: level)
        
        var info: [String: String] = [:]
        info["name"] = filteredCard.name
        
        if let title = filteredCard.title, !title.isEmpty {
            info["title"] = title
        }
        
        if let company = filteredCard.company, !company.isEmpty {
            info["company"] = company
        }
        
        info["level"] = level.rawValue
        info["timestamp"] = String(Int(Date().timeIntervalSince1970))
        // Announce ZK capability so browsers can show a badge before proof arrives
        info["zk"] = card.sharingPreferences.useZK ? "1" : "0"
        let allowedCount = card.sharingPreferences.fieldsForLevel(level).count
        info["zkf"] = String(allowedCount)
        
        return info
    }
}

// MARK: - MCNearbyServiceAdvertiserDelegate

extension ProximityManager: MCNearbyServiceAdvertiserDelegate {
    func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        // Decode group invite if present in context; otherwise treat as connection invite
        if let ctx = context, let invite = try? JSONDecoder().decode(GroupInvitePayload.self, from: ctx) {
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                self.pendingInvitationHandler = invitationHandler
                self.pendingGroupInvite = (invite, peerID)
                self.isPresentingInvitation = false
                NotificationCenter.default.post(
                    name: .groupInviteReceived,
                    object: nil,
                    userInfo: [ProximityEventKey.invite: invite, ProximityEventKey.peerID: peerID]
                )
                print("Received group invite from \(peerID.displayName) for group: \(invite.groupName)")
            }
            return
        }
        // Store and publish pending connection invitation for UI confirmation
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            self.pendingInvitationHandler = invitationHandler
            self.pendingInvitation = PendingInvitation(peerID: peerID, receivedAt: Date())
            self.isPresentingInvitation = false
            print("Received invitation from \(peerID.displayName)")
        }
    }
    
    func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) {
        DispatchQueue.main.async { [weak self] in
            let errorMessage = self?.createDetailedErrorMessage(for: error) ?? "Failed to start advertising: \(error.localizedDescription)"
            self?.lastError = .sharingError(errorMessage)
            self?.isAdvertising = false
        }
        
        print("Failed to start advertising: \(error)")
    }
}

// MARK: - MCNearbyServiceBrowserDelegate

extension ProximityManager: MCNearbyServiceBrowserDelegate {
    func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String: String]?) {
        
        let peer = ProximityPeer(
            peerID: peerID,
            discoveryInfo: info ?? [:],
            discoveredAt: Date()
        )
        
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            
            // Add peer if not already in list
            if !self.nearbyPeers.contains(where: { $0.peerID == peerID }) {
                self.nearbyPeers.append(peer)
                print("Found peer: \(peerID.displayName)")
                NotificationCenter.default.post(
                    name: .matchingPeerListUpdated,
                    object: nil,
                    userInfo: [ProximityEventKey.peers: self.nearbyPeers]
                )
                
                // Auto-Pilot: Connect automatically with random delay to avoid collision
                if self.autoConnectEnabled {
                    // Random delay 0.5 - 1.5s
                    let delay = Double.random(in: 0.5...1.5)
                    DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                        guard let self = self,
                              self.autoConnectEnabled,
                              !self.session.connectedPeers.contains(peerID) else { return }
                        
                        print("Auto-Pilot: Connecting to \(peerID.displayName)")
                        self.connectToPeer(peer)
                    }
                }
            }
        }
    }
    
    func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
        DispatchQueue.main.async { [weak self] in
            self?.nearbyPeers.removeAll { $0.peerID == peerID }
            print("Lost peer: \(peerID.displayName)")
            if let peers = self?.nearbyPeers {
                NotificationCenter.default.post(
                    name: .matchingPeerListUpdated,
                    object: nil,
                    userInfo: [ProximityEventKey.peers: peers]
                )
            }
        }
    }
    
    func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
        DispatchQueue.main.async { [weak self] in
            let errorMessage = self?.createDetailedErrorMessage(for: error) ?? "Failed to start browsing: \(error.localizedDescription)"
            self?.lastError = .sharingError(errorMessage)
            self?.isBrowsing = false
        }
        
        print("Failed to start browsing: \(error)")
    }
}
