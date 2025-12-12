//
//  ProximityManager+Actions.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import Foundation
import MultipeerConnectivity

extension ProximityManager {
    
    /// Send business card to a specific peer
    func sendCard(_ card: BusinessCard, to peer: MCPeerID, sharingLevel: SharingLevel) {
        guard session.connectedPeers.contains(peer) else {
            lastError = .sharingError("Peer is not connected")
            return
        }
        
        do {
            // Filter card based on sharing level
            let filteredCard = card.filteredCard(for: sharingLevel)
            
            // Create sharing payload with ZK issuer info
            let shareUUID = UUID()
            let identityBundle = SemaphoreIdentityManager.shared.getIdentity() ?? (try? SemaphoreIdentityManager.shared.loadOrCreateIdentity())
            let issuerCommitment = identityBundle?.commitment ?? ""
            var issuerProof: String?
            if !issuerCommitment.isEmpty && SemaphoreIdentityManager.proofsSupported {
                issuerProof = (try? SemaphoreIdentityManager.shared.generateProof(
                    groupCommitments: [issuerCommitment],
                    message: shareUUID.uuidString,
                    scope: sharingLevel.rawValue
                ))
            }
            // Optional SD proof if enabled by sender's prefs
            var sdProof: SelectiveDisclosureProof?
            if card.sharingPreferences.useZK {
                let allowed = card.sharingPreferences.fieldsForLevel(sharingLevel)
                let sdResult = ProofGenerationManager.shared.generateSelectiveDisclosureProof(
                    businessCard: card,
                    selectedFields: allowed,
                    recipientId: peer.displayName
                )
                if case .success(let proof) = sdResult { sdProof = proof }
            }
            let payload = ProximitySharingPayload(
                card: filteredCard,
                sharingLevel: sharingLevel,
                timestamp: Date(),
                senderID: localPeerID.displayName,
                shareId: shareUUID,
                issuerCommitment: issuerCommitment.isEmpty ? nil : issuerCommitment,
                issuerProof: issuerProof,
                sdProof: sdProof,
                sealedRoute: SecureKeyManager.shared.mySealedRoute,
                pubKey: SecureKeyManager.shared.myEncPubKey,
                signPubKey: SecureKeyManager.shared.mySignPubKey
            )
            
            print("[ProximityManager] Sending card to \(peer.displayName)")
            print("[ProximityManager] Sealed Route: \(String(describing: SecureKeyManager.shared.mySealedRoute))")
            print("[ProximityManager] Pub Key: \(String(describing: SecureKeyManager.shared.myEncPubKey))")
            
            let data = try JSONEncoder().encode(payload)
            
            try session.send(data, toPeers: [peer], with: .reliable)
            
            print("Sent business card to \(peer.displayName)")
            
        } catch {
            lastError = .sharingError("Failed to send card: \(error.localizedDescription)")
            print("Failed to send card: \(error)")
        }
    }
    
    /// Send a group invite to a specific peer
    func sendGroupInvite(to peer: MCPeerID, group: SemaphoreGroupManager.ManagedGroup, inviterName: String) {
        guard session.connectedPeers.contains(peer) else {
            lastError = .sharingError("Peer is not connected")
            return
        }
        let payload = GroupInvitePayload(
            groupId: group.id,
            groupName: group.name,
            groupRoot: group.root,
            inviterName: inviterName,
            timestamp: Date()
        )
        do {
            let data = try JSONEncoder().encode(payload)
            try session.send(data, toPeers: [peer], with: .reliable)
            print("Sent group invite to \(peer.displayName) for group: \(group.name)")
        } catch {
            lastError = .sharingError("Failed to send group invite: \(error.localizedDescription)")
            print("Failed to send group invite: \(error)")
        }
    }
    
    /// Accept a pending group invite and send back join response with user's commitment
    func acceptGroupInvite(_ invite: GroupInvitePayload, to peer: MCPeerID, memberName: String, memberCommitment: String) {
        let response = GroupJoinResponsePayload(
            groupId: invite.groupId,
            memberCommitment: memberCommitment,
            memberName: memberName,
            timestamp: Date()
        )
        do {
            let data = try JSONEncoder().encode(response)
            try session.send(data, toPeers: [peer], with: .reliable)
            print("Sent group join response to \(peer.displayName) for group: \(invite.groupName)")
        } catch {
            lastError = .sharingError("Failed to send join response: \(error.localizedDescription)")
            print("Failed to send join response: \(error)")
        }
    }
    
    /// Disconnect from all peers and stop all services
    func disconnect() {
        autoConnectEnabled = false
        stopAdvertising()
        stopBrowsing()
        stopHeartbeat()
        cancelAllRetries()
        
        session.disconnect()
        nearbyPeers.removeAll()
        connectionStatus = .disconnected
        
        print("Disconnected from all peers")
    }
    
    /// Respond to the most recent pending invitation
    func respondToPendingInvitation(accept: Bool) {
        guard let handler = pendingInvitationHandler else { return }
        handler(accept, session)
        pendingInvitation = nil
        pendingInvitationHandler = nil
        isPresentingInvitation = false
    }
    
    /// Accept the most recent pending group invite and defer sending the join response until connected
    func acceptPendingGroupInvite(memberName: String, memberCommitment: String) {
        guard let tuple = pendingGroupInvite else { return }
        pendingGroupJoinResponse = PendingGroupJoinResponse(
            invite: tuple.payload,
            memberName: memberName,
            memberCommitment: memberCommitment,
            peerID: tuple.from
        )
        // Accept the Multipeer invitation to establish the session
        respondToPendingInvitation(accept: true)
    }
    
    /// Decline the most recent pending group invite
    func declinePendingGroupInvite() {
        respondToPendingInvitation(accept: false)
        pendingGroupInvite = nil
        pendingGroupJoinResponse = nil
    }
    
    /// Attempt to exclusively present the invitation popup. Returns true if acquired.
    func tryAcquireInvitationPresentation() -> Bool {
        if isPresentingInvitation { return false }
        isPresentingInvitation = true
        return true
    }
    
    /// Release the presentation lock for invitation popup.
    func releaseInvitationPresentation() {
        isPresentingInvitation = false
    }
    
    /// Get current sharing status
    func getSharingStatus() -> ProximitySharingStatus {
        return ProximitySharingStatus(
            isAdvertising: isAdvertising,
            isBrowsing: isBrowsing,
            connectedPeersCount: session.connectedPeers.count,
            nearbyPeersCount: nearbyPeers.count,
            currentCard: currentCard,
            sharingLevel: currentSharingLevel
        )
    }
    
    /// Connect to a specific peer
    func connectToPeer(_ peer: ProximityPeer) {
        guard let browser = browser else {
            // Strategy B: Auto-restart browsing + Soft UI hint
            print("Browser was nil in connectToPeer. Restarting browsing...")
            startBrowsing()
            matchingInfoMessage = "Reconnecting... Please wait a moment, then try connecting again."
            return
        }
        
        browser.invitePeer(peer.peerID, to: session, withContext: nil, timeout: 30)
        
        // Update peer status
        if let index = nearbyPeers.firstIndex(where: { $0.id == peer.id }) {
            nearbyPeers[index].status = .connecting
        }
        
        print("Connecting to peer: \(peer.name)")
    }
    
    /// Invite a peer to join a group using the Multipeer invitation context (no manual connect first)
    func invitePeerToGroup(_ peer: ProximityPeer, group: SemaphoreGroupManager.ManagedGroup, inviterName: String) {
        guard let browser = browser else {
            // Strategy B: Auto-restart browsing + Soft UI hint
            print("Browser was nil in invitePeerToGroup. Restarting browsing...")
            startBrowsing()
            matchingInfoMessage = "Reconnecting... Please wait a moment, then try connecting again."
            return
        }
        let payload = GroupInvitePayload(
            groupId: group.id,
            groupName: group.name,
            groupRoot: group.root,
            inviterName: inviterName,
            timestamp: Date()
        )
        do {
            let context = try JSONEncoder().encode(payload)
            browser.invitePeer(peer.peerID, to: session, withContext: context, timeout: 30)
            print("Invited \(peer.name) to group via context: \(group.name)")
        } catch {
            lastError = .sharingError("Failed to encode invite: \(error.localizedDescription)")
        }
    }
    
    /// Clear received cards
    func clearReceivedCards() {
        receivedCards.removeAll()
    }
    
    func handleReceivedCard(
        _ card: BusinessCard,
        from senderName: String,
        status: VerificationStatus,
        sealedRoute: String? = nil,
        pubKey: String? = nil,
        signPubKey: String? = nil
    ) {
        // Add to received cards
        receivedCards.append(card)
        
        // Save to contact repository on main actor
        Task { @MainActor in
            let contact = Contact(
                businessCard: card,
                source: .proximity,
                verificationStatus: status,
                sealedRoute: sealedRoute,
                pubKey: pubKey,
                signPubKey: signPubKey
            )
            
            let result = contactRepository.addContact(contact)
            
            switch result {
            case .success:
                print("Received and saved business card from \(senderName)")
                
                // If this is a Group VC, update messaging data for the member
                if let groupContext = card.groupContext,
                   case .group(let info) = groupContext,
                   let _ = sealedRoute,
                   let _ = pubKey,
                   let _ = signPubKey {
                    
                    print("Detected Group VC for group \(info.groupId). Updating member messaging data.")
                     // Note: Logic for updating CloudKit for group members is delegated to owner
                }
                
            case .failure(let error):
                print("Failed to save received card: \(error)")
                self.lastError = error
            }
        }
    }
}
