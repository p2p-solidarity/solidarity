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
    @Published var isAdvertising = false
    @Published var isBrowsing = false
    @Published var nearbyPeers: [ProximityPeer] = []
    @Published var activeConnections: [MCPeerID: ProximityConnectionStatus] = [:]
    @Published var connectionStatus: ProximityConnectionStatus = .disconnected
    @Published var lastError: CardError?
    @Published var receivedCards: [BusinessCard] = []
    @Published var lastReceivedVerification: VerificationStatus?
    @Published var pendingInvitation: PendingInvitation?
    @Published var pendingInvitations: [PendingInvitation] = []
    @Published var isPresentingInvitation = false
    @Published var pendingGroupInvite: (payload: GroupInvitePayload, from: MCPeerID)?
    @Published var matchingInfoMessage: String? // User-friendly status message for UI
    @Published var discoveryState: DiscoveryState = .idle
    @Published var currentSession: MCSession? = nil // Corrected type for MCSession?
    
    internal var pendingGroupJoinResponse: PendingGroupJoinResponse?
    
    // MARK: - Auto-Pilot & Background Properties
    internal var autoConnectEnabled = false
    internal var isBackground = false
    internal var heartbeatTimer: Timer?
    internal var retryAttempts: [MCPeerID: Int] = [:]
    internal var retryWorkItems: [MCPeerID: DispatchWorkItem] = [:]
    
    // MARK: - Internal Properties
    internal let serviceType = "airmeishi-share"
    internal let maxPeers = 8
    
    internal var session: MCSession
    internal var advertiser: MCNearbyServiceAdvertiser?
    internal var browser: MCNearbyServiceBrowser?
    internal var localPeerID: MCPeerID
    
    internal var currentCard: BusinessCard?
    internal var currentSharingLevel: SharingLevel = .professional
    
    @MainActor internal let contactRepository = ContactRepository.shared
    internal var cancellables = Set<AnyCancellable>()
    internal var pendingInvitationHandler: ((Bool, MCSession?) -> Void)?
    
    // MARK: - WebRTC
    internal let webRTCManager = WebRTCManager.shared
    
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
    
    internal func updateConnectionStatus() {
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
    
    internal func createDetailedErrorMessage(for error: Error) -> String {
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
    
    internal func startHeartbeat() {
        stopHeartbeat()
        // 30s heartbeat
        heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 30.0, repeats: true) { [weak self] _ in
            self?.sendHeartbeat()
        }
    }
    
    internal func stopHeartbeat() {
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
    }
    
    internal func sendHeartbeat() {
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
    
    internal func scheduleRetry(for peerID: MCPeerID) {
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
    
    internal func cancelRetry(for peerID: MCPeerID) {
        retryWorkItems[peerID]?.cancel()
        retryWorkItems[peerID] = nil
        retryAttempts[peerID] = nil
    }
    
    internal func cancelAllRetries() {
        retryWorkItems.values.forEach { $0.cancel() }
        retryWorkItems.removeAll()
        retryAttempts.removeAll()
    }
}
