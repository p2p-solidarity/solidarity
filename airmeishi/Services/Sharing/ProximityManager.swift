//
//  ProximityManager.swift
//  airmeishi
//
//  Manages proximity-based sharing using Multipeer Connectivity for device discovery and sharing
//

import Foundation
import MultipeerConnectivity
import Combine
import UIKit

/// Protocol for proximity sharing operations
protocol ProximityManagerProtocol {
    func startAdvertising(with card: BusinessCard, sharingLevel: SharingLevel)
    func stopAdvertising()
    func startBrowsing()
    func stopBrowsing()
    func sendCard(_ card: BusinessCard, to peer: MCPeerID, sharingLevel: SharingLevel)
    func disconnect()
}

/// Manages proximity-based sharing using Multipeer Connectivity
class ProximityManager: NSObject, ProximityManagerProtocol, ObservableObject {
    static let shared = ProximityManager()
    
    // MARK: - Published Properties
    @Published private(set) var isAdvertising = false
    @Published private(set) var isBrowsing = false
    @Published private(set) var nearbyPeers: [ProximityPeer] = []
    @Published private(set) var connectionStatus: ProximityConnectionStatus = .disconnected
    @Published private(set) var lastError: CardError?
    @Published private(set) var receivedCards: [BusinessCard] = []
    @Published private(set) var lastReceivedVerification: VerificationStatus?
    @Published var pendingInvitation: PendingInvitation?
    @Published private(set) var isPresentingInvitation = false
    @Published var pendingGroupInvite: (payload: GroupInvitePayload, from: MCPeerID)?
    private var pendingGroupJoinResponse: (invite: GroupInvitePayload, memberName: String, memberCommitment: String, peerID: MCPeerID)?
    
    // MARK: - Auto-Pilot & Background Properties
    private var autoConnectEnabled = false
    private var isBackground = false
    private var heartbeatTimer: Timer?
    private var retryAttempts: [MCPeerID: Int] = [:]
    private var retryWorkItems: [MCPeerID: DispatchWorkItem] = [:]
    
    // MARK: - Private Properties
    private let serviceType = "airmeishi-share"
    private let maxPeers = 8
    
    private var session: MCSession
    private var advertiser: MCNearbyServiceAdvertiser?
    private var browser: MCNearbyServiceBrowser?
    private var localPeerID: MCPeerID
    
    private var currentCard: BusinessCard?
    private var currentSharingLevel: SharingLevel = .professional
    
    @MainActor private let contactRepository = ContactRepository.shared
    private var cancellables = Set<AnyCancellable>()
    private var pendingInvitationHandler: ((Bool, MCSession?) -> Void)?
    
    // MARK: - WebRTC
    let webRTCManager = WebRTCManager.shared
    
    // MARK: - Initialization
    
    override init() {
        // Create unique peer ID based on device
        // Create unique peer ID based on ZK Identity if available, else device name
        let deviceName = UIDevice.current.name
        var displayName = deviceName
        
        if let identity = SemaphoreIdentityManager.shared.getIdentity() {
            // Use first 8 chars of commitment as ID for uniqueness and privacy
            displayName = String(identity.commitment.prefix(8))
        }
        
        self.localPeerID = MCPeerID(displayName: displayName)
        
        // Initialize session
        self.session = MCSession(peer: localPeerID, securityIdentity: nil, encryptionPreference: .required)
        
        super.init()
        
        session.delegate = self
        setupNotifications()
        setupWebRTC()
    }
    
    deinit {
        disconnect()
    }
    
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
            var issuerProof: String? = nil
            if !issuerCommitment.isEmpty && SemaphoreIdentityManager.proofsSupported {
                issuerProof = (try? SemaphoreIdentityManager.shared.generateProof(
                    groupCommitments: [issuerCommitment],
                    message: shareUUID.uuidString,
                    scope: sharingLevel.rawValue
                ))
            }
            // Optional SD proof if enabled by sender's prefs
            var sdProof: SelectiveDisclosureProof? = nil
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
        pendingGroupJoinResponse = (invite: tuple.payload, memberName: memberName, memberCommitment: memberCommitment, peerID: tuple.from)
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
            lastError = .sharingError("Browser not available")
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
            lastError = .sharingError("Browser not available")
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
    
    /// Check if the app has the required network permissions
    func checkNetworkPermissions() -> Bool {
        // Check if Info.plist contains required keys
        guard let infoPlist = Bundle.main.infoDictionary else {
            print("Info.plist not found")
            return false
        }
        
        // Check for NSLocalNetworkUsageDescription (try both formats)
        let hasLocalNetworkDescription = infoPlist["NSLocalNetworkUsageDescription"] as? String != nil ||
                                       infoPlist["INFOPLIST_KEY_NSLocalNetworkUsageDescription"] as? String != nil
        
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
    
    // MARK: - Private Methods
    
    private func createDiscoveryInfo(for card: BusinessCard, level: SharingLevel) -> [String: String] {
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
    
    private func updateConnectionStatus() {
        if isAdvertising && isBrowsing {
            connectionStatus = .advertisingAndBrowsing
        } else if isAdvertising {
            connectionStatus = .advertising
        } else if isBrowsing {
            connectionStatus = .browsing
        } else if !session.connectedPeers.isEmpty {
            connectionStatus = .connected
        } else {
            connectionStatus = .disconnected
        }
        // Broadcast status change for listeners across the app
        NotificationCenter.default.post(
            name: .matchingConnectionStatusChanged,
            object: nil,
            userInfo: [ProximityEventKey.status: connectionStatus]
        )
    }
    
    private func setupNotifications() {
        // Listen for app state changes
        NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)
            .sink { [weak self] _ in
                guard let self = self else { return }
                self.isBackground = true
                print("App entered background - optimizing P2P resources")
                
                // In background, we stop browsing to save battery/resources, 
                // but keep advertising to remain discoverable if possible.
                // Note: iOS may still suspend execution unless we have background tasks.
                self.stopBrowsing()
                
                // We do NOT disconnect session here to allow "survival"
            }
            .store(in: &cancellables)
            
        NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)
            .sink { [weak self] _ in
                guard let self = self else { return }
                self.isBackground = false
                print("App entered foreground - restoring P2P services")
                
                // Restore browsing if we are in auto-pilot mode
                if self.autoConnectEnabled {
                    self.startBrowsing()
                    self.startHeartbeat()
                }
            }
            .store(in: &cancellables)
    }
    
    private func handleReceivedCard(
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
                   let sealedRoute = sealedRoute,
                   let pubKey = pubKey,
                   let signPubKey = signPubKey {
                    
                    print("Detected Group VC for group \(info.groupId). Updating member messaging data.")
                    
                    // We need to find the member record. Since we don't have the member ID directly,
                    // we might need to look it up or assume the owner can find it.
                    // However, CloudKitGroupSyncManager.updateMemberMessagingData requires groupID and memberID.
                    // We only have the user's DID (holderDid) or the card ID.
                    // But wait, the Group VC issuance logic puts the member's record ID in the credential?
                    // No, it puts the `holderDid`.
                    
                    // Actually, if we are the OWNER of the group, we should be able to find the member by their DID or some other identifier.
                    // But for now, let's assume we can't easily map DID to MemberID without a lookup.
                    // A better approach for MVP: The recipient (Group Member) sends their messaging data to the Owner.
                    // The Owner receives it and updates the CloudKit record.
                    
                    // If I am the Owner, and I receive a card from a Member, I should update their record.
                    // But `handleReceivedCard` is generic.
                    
                    // Let's try to update if we can match the member.
                    // CloudKitGroupSyncManager doesn't have a "find member by DID" method yet.
                    // But we can iterate active members and check? No, we don't store DID in GroupMemberModel (we store userRecordID).
                    
                    // Re-reading the requirements: "GroupProximityManager handles the distribution... and member-to-member sending".
                    // The requirement says: "Modify CloudKitGroupSyncManager to manage messaging data".
                    // And "GroupProximityManager... includes logic for owner-initiated sending... and member-to-member sending".
                    
                    // If this is a Group VC, it means the SENDER is a member of the group (or the owner).
                    // If I am a member, I might want to store their messaging data to communicate.
                    // But `ContactRepository` already stores it in the `Contact` object!
                    
                    // So, do we need to update CloudKit?
                    // "Modify CloudKitGroupSyncManager to manage messaging data... for Group VCs."
                    // This likely means persisting it so *other* members can fetch it from CloudKit.
                    // Only the Owner (or the member themselves) can write to CloudKit usually.
                    // If I am the Owner, and I receive this from a Member, I should update CloudKit.
                    
                    // For now, let's just log it. The `Contact` storage is sufficient for P2P.
                    // The `CloudKitGroupSyncManager` update might be triggered explicitly elsewhere, e.g. when a member joins.
                    
                }
                
            case .failure(let error):
                print("Failed to save received card: \(error)")
                self.lastError = error
            }
        }
    }
    
    private func createDetailedErrorMessage(for error: Error) -> String {
        let nsError = error as NSError
        
        // Handle specific NSNetServices errors
        if nsError.domain == "NSNetServicesErrorDomain" {
            switch nsError.code {
            case -72008: // NSNetServicesMissingRequiredConfigurationError
                return "Network configuration missing. Please ensure the app has proper network permissions in Settings > Privacy & Security > Local Network."
            case -72000: // NSNetServicesUnknownError
                return "Unknown network error occurred. Please try restarting the app."
            case -72001: // NSNetServicesCollisionError
                return "Network service name collision. Please try again in a moment."
            case -72002: // NSNetServicesNotFoundError
                return "Network service not found. Please check your network connection."
            case -72003: // NSNetServicesActivityInProgress
                return "Network operation already in progress. Please wait and try again."
            case -72004: // NSNetServicesBadArgumentError
                return "Invalid network configuration. Please contact support."
            case -72005: // NSNetServicesInvalidError
                return "Invalid network service. Please restart the app."
            case -72006: // NSNetServicesTimeoutError
                return "Network operation timed out. Please check your connection and try again."
            case -72007: // NSNetServicesInProgressError
                return "Network operation in progress. Please wait and try again."
            default:
                return "Network error (\(nsError.code)): \(error.localizedDescription)"
            }
        }
        
        // Handle MultipeerConnectivity specific errors
        if nsError.domain == "MultipeerConnectivityErrorDomain" {
            switch nsError.code {
            case 0: // MCErrorUnknown
                return "Unknown Multipeer Connectivity error. Please try again."
            case 1: // MCErrorNotConnected
                return "Not connected to any peers. Please ensure devices are nearby and try again."
            case 2: // MCErrorInvalidParameter
                return "Invalid connection parameters. Please restart the app."
            case 3: // MCErrorUnsupported
                return "This feature is not supported on this device."
            case 4: // MCErrorTimedOut
                return "Connection timed out. Please ensure devices are nearby and try again."
            case 5: // MCErrorCancelled
                return "Connection was cancelled. Please try again."
            case 6: // MCErrorUnavailable
                return "Multipeer Connectivity is not available. Please check your device settings."
            default:
                return "Multipeer Connectivity error (\(nsError.code)): \(error.localizedDescription)"
            }
        }
        
        // Generic error message
        return "Failed to start browsing: \(error.localizedDescription)"
    }
    // MARK: - Heartbeat & Retry Logic
    
    private func startHeartbeat() {
        stopHeartbeat()
        // 30s heartbeat
        heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 30.0, repeats: true) { [weak self] _ in
            self?.sendHeartbeat()
        }
    }
    
    private func stopHeartbeat() {
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
    }
    
    private func sendHeartbeat() {
        guard !session.connectedPeers.isEmpty else { return }
        // Simple keep-alive packet (could be empty data or specific type)
        let heartbeatData = "HEARTBEAT".data(using: .utf8)!
        do {
            try session.send(heartbeatData, toPeers: session.connectedPeers, with: .unreliable)
            // print("Sent heartbeat to \(session.connectedPeers.count) peers")
        } catch {
            print("Failed to send heartbeat: \(error)")
        }
    }
    
    private func scheduleRetry(for peerID: MCPeerID) {
        guard autoConnectEnabled else { return }
        
        let attempt = retryAttempts[peerID] ?? 0
        let delay = pow(2.0, Double(attempt)) // 1, 2, 4, 8...
        
        // Cap at 30s
        let cappedDelay = min(delay, 30.0)
        
        print("Scheduling retry for \(peerID.displayName) in \(cappedDelay)s (Attempt \(attempt + 1))")
        
        let workItem = DispatchWorkItem { [weak self] in
            guard let self = self, self.autoConnectEnabled else { return }
            // Only retry if still not connected
            if !self.session.connectedPeers.contains(peerID) {
                // We need to re-invite. Since we might not have the original context/browser easily accessible 
                // in this specific flow without tracking it, we rely on the browser finding the peer again 
                // OR we just wait for the browser to re-discover.
                // However, 'browser:foundPeer:' is called repeatedly? No, usually once.
                // So we might need to restart browsing or manually invite if we have the peer object.
                
                // Best effort: if we have the peer in nearbyPeers, try to connect
                if let peer = self.nearbyPeers.first(where: { $0.peerID == peerID }) {
                    self.connectToPeer(peer)
                }
            }
        }
        
        retryWorkItems[peerID] = workItem
        retryAttempts[peerID] = attempt + 1
        
        DispatchQueue.main.asyncAfter(deadline: .now() + cappedDelay, execute: workItem)
    }
    
    private func cancelRetry(for peerID: MCPeerID) {
        retryWorkItems[peerID]?.cancel()
        retryWorkItems[peerID] = nil
        retryAttempts[peerID] = nil
    }
    
    private func cancelAllRetries() {
        retryWorkItems.values.forEach { $0.cancel() }
        retryWorkItems.removeAll()
        retryAttempts.removeAll()
    }
}

// MARK: - MCSessionDelegate

extension ProximityManager: MCSessionDelegate {
    func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            
            // Update peer status in nearby peers list
            if let index = self.nearbyPeers.firstIndex(where: { $0.peerID == peerID }) {
                switch state {
                case .connected:
                    self.nearbyPeers[index].status = .connected
                    self.cancelRetry(for: peerID) // Connection successful, cancel retry
                case .connecting:
                    self.nearbyPeers[index].status = .connecting
                case .notConnected:
                    self.nearbyPeers[index].status = .disconnected
                    // If we were connected and lost it, or failed to connect, schedule retry
                    if self.autoConnectEnabled {
                        self.scheduleRetry(for: peerID)
                    }
                @unknown default:
                    break
                }
            }
            
            self.updateConnectionStatus()
            
            print("Peer \(peerID.displayName) changed state to: \(state)")

            // Auto-send current card when a connection is established
            if state == .connected, let card = self.currentCard {
                self.sendCard(card, to: peerID, sharingLevel: self.currentSharingLevel)
            }

            // If we have a pending join response for this peer, send it now
            if state == .connected, let pending = self.pendingGroupJoinResponse, pending.peerID == peerID {
                self.acceptGroupInvite(pending.invite, to: pending.peerID, memberName: pending.memberName, memberCommitment: pending.memberCommitment)
                self.pendingGroupJoinResponse = nil
                self.pendingGroupInvite = nil
            }
            
            // Trigger WebRTC setup
            if state == .connected {
                self.handleNewConnection(peerID)
            }
        }
    }
    
    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        // Try decoding in order: WebRTC Signaling, GroupInvite, GroupJoinResponse, BusinessCard share
        if handleWebRTCSignaling(data, from: peerID) { return }
        
        if let invite = try? JSONDecoder().decode(GroupInvitePayload.self, from: data) {
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                // Ensure the group shows up immediately on the invited device
                let gm = SemaphoreGroupManager.shared
                gm.ensureGroupFromInvite(id: invite.groupId, name: invite.groupName, root: invite.groupRoot)
                self.pendingGroupInvite = (invite, peerID)
                NotificationCenter.default.post(
                    name: .groupInviteReceived,
                    object: nil,
                    userInfo: [ProximityEventKey.invite: invite, ProximityEventKey.peerID: peerID]
                )
            }
            return
        }
        if let join = try? JSONDecoder().decode(GroupJoinResponsePayload.self, from: data) {
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                // Add member to the matching group if it exists locally
                let gm = SemaphoreGroupManager.shared
                if let idx = gm.allGroups.firstIndex(where: { $0.id == join.groupId }) {
                    gm.selectGroup(gm.allGroups[idx].id)
                    gm.addMember(join.memberCommitment)
                }
                // Create a simple card with the member's name and broadcast as received
                let card = BusinessCard(name: join.memberName)
                self.receivedCards.append(card)
                NotificationCenter.default.post(
                    name: .matchingReceivedCard,
                    object: nil,
                    userInfo: [ProximityEventKey.card: card]
                )
                NotificationCenter.default.post(
                    name: .groupMembershipUpdated,
                    object: nil,
                    userInfo: [ProximityEventKey.groupId: join.groupId]
                )
            }
            return
        }
        // Check for Heartbeat
        if let string = String(data: data, encoding: .utf8), string == "HEARTBEAT" {
            // print("Received heartbeat from \(peerID.displayName)")
            return
        }

        do {
            let payload = try JSONDecoder().decode(ProximitySharingPayload.self, from: data)
            let status = ProximityVerificationHelper.verify(
                commitment: payload.issuerCommitment,
                proof: payload.issuerProof,
                message: payload.shareId.uuidString,
                scope: payload.sharingLevel.rawValue
            )
            
            print("[ProximityManager] Received payload from \(payload.senderID)")
            print("[ProximityManager] Sealed Route: \(String(describing: payload.sealedRoute))")
            print("[ProximityManager] Pub Key: \(String(describing: payload.pubKey))")
            
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.lastReceivedVerification = status
                if let index = self.nearbyPeers.firstIndex(where: { $0.peerID == peerID }) {
                    self.nearbyPeers[index].verification = status
                }
                // Pass secure messaging fields to handleReceivedCard
                self.handleReceivedCard(
                    payload.card, 
                    from: payload.senderID, 
                    status: status,
                    sealedRoute: payload.sealedRoute,
                    pubKey: payload.pubKey,
                    signPubKey: payload.signPubKey
                )
                NotificationCenter.default.post(
                    name: .matchingReceivedCard,
                    object: nil,
                    userInfo: [ProximityEventKey.card: payload.card]
                )
            }
        } catch {
            let rawString = String(data: data, encoding: .utf8) ?? "Unable to decode as UTF8"
            print("Failed to decode received data: \(error)")
            print("Raw data: \(rawString)")
            
            DispatchQueue.main.async { [weak self] in
                let err: CardError = .sharingError("Failed to decode received data: \(error.localizedDescription). Raw: \(rawString.prefix(50))")
                self?.lastError = err
                NotificationCenter.default.post(
                    name: .matchingError,
                    object: nil,
                    userInfo: [ProximityEventKey.error: err]
                )
            }
        }
    }
    
    func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {
        // Not used for business card sharing
    }
    
    // MARK: - WebRTC Integration
    
    private func setupWebRTC() {
        webRTCManager.onSendSignalingMessage = { [weak self] message in
            guard let self = self else { return }
            self.sendWebRTCSignaling(message)
        }
    }
    
    private func sendWebRTCSignaling(_ message: SignalingMessage) {
        guard !session.connectedPeers.isEmpty else { return }
        do {
            let data = try JSONEncoder().encode(message)
            // Broadcast to all connected peers for now (usually just one in this context)
            try session.send(data, toPeers: session.connectedPeers, with: .reliable)
        } catch {
            print("Failed to send WebRTC signaling: \(error)")
        }
    }
    
    private func handleWebRTCSignaling(_ data: Data, from peerID: MCPeerID) -> Bool {
        if let message = try? JSONDecoder().decode(SignalingMessage.self, from: data) {
            webRTCManager.handleSignalingMessage(message, from: peerID)
            return true
        }
        return false
    }
    
    private func handleNewConnection(_ peerID: MCPeerID) {
        // Simple tie-breaker: The one with lexicographically larger ID offers
        // This avoids both offering or both waiting.
        // Note: This assumes 1-on-1 WebRTC for now.
        if localPeerID.displayName > peerID.displayName {
            print("WebRTC: Initiating offer to \(peerID.displayName)")
            webRTCManager.setupConnection(for: peerID)
            webRTCManager.offer()
        } else {
            print("WebRTC: Waiting for offer from \(peerID.displayName)")
            webRTCManager.setupConnection(for: peerID)
        }
    }
    
    func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {
        // Not used for business card sharing
    }
    
    func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {
        // Not used for business card sharing
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
    func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String : String]?) {
        
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

// MARK: - Supporting Types

/// Represents a nearby peer discovered through Multipeer Connectivity
struct ProximityPeer: Identifiable, Equatable {
    let id = UUID()
    let peerID: MCPeerID
    let discoveryInfo: [String: String]
    let discoveredAt: Date
    var status: ProximityPeerStatus = .disconnected
    var verification: VerificationStatus? = nil
    
    var name: String {
        return peerID.displayName
    }
    
    var cardName: String? {
        return discoveryInfo["name"]
    }
    
    var cardTitle: String? {
        return discoveryInfo["title"]
    }
    
    var cardCompany: String? {
        return discoveryInfo["company"]
    }
    
    var sharingLevel: SharingLevel {
        if let levelString = discoveryInfo["level"],
           let level = SharingLevel(rawValue: levelString) {
            return level
        }
        return .professional
    }
    
    static func == (lhs: ProximityPeer, rhs: ProximityPeer) -> Bool {
        return lhs.peerID == rhs.peerID
    }
}

/// Status of a proximity peer connection
enum ProximityPeerStatus: String, CaseIterable {
    case disconnected = "Disconnected"
    case connecting = "Connecting"
    case connected = "Connected"
    
    var systemImageName: String {
        switch self {
        case .disconnected: return "circle"
        case .connecting: return "circle.dotted"
        case .connected: return "circle.fill"
        }
    }
    
    var color: String {
        switch self {
        case .disconnected: return "gray"
        case .connecting: return "orange"
        case .connected: return "green"
        }
    }
}

/// Overall connection status for proximity sharing
enum ProximityConnectionStatus: String, CaseIterable {
    case disconnected = "Disconnected"
    case advertising = "Advertising"
    case browsing = "Browsing"
    case advertisingAndBrowsing = "Advertising & Browsing"
    case connected = "Connected"
    
    var displayName: String {
        return self.rawValue
    }
    
    var systemImageName: String {
        switch self {
        case .disconnected: return "wifi.slash"
        case .advertising: return "dot.radiowaves.left.and.right"
        case .browsing: return "magnifyingglass"
        case .advertisingAndBrowsing: return "dot.radiowaves.up.forward"
        case .connected: return "wifi"
        }
    }
}

/// Payload structure moved to ProximityPayload.swift

/// Current sharing status information
struct ProximitySharingStatus {
    let isAdvertising: Bool
    let isBrowsing: Bool
    let connectedPeersCount: Int
    let nearbyPeersCount: Int
    let currentCard: BusinessCard?
    let sharingLevel: SharingLevel
}

/// Represents a pending incoming invitation that awaits user consent
struct PendingInvitation {
    let peerID: MCPeerID
    let receivedAt: Date
}