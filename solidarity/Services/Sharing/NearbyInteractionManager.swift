//
//  NearbyInteractionManager.swift
//  solidarity
//
//  Manages UWB Nearby Interaction sessions as a spatial trigger layer
//  on top of the existing MultipeerConnectivity data channel.
//
//  Architecture:
//  - NIDiscoveryToken exchange piggybacks on the MC session (tagged with "NI_TOKEN:" prefix)
//  - Distance updates drive a debounced state machine (idle → approaching → confirmed → exchanging → cooldown)
//  - On confirmed contact, fires `onSpatialTrigger` callback so the caller can invoke existing exchange logic
//  - Zero disruption: if UWB is unavailable, all existing MC flows work unchanged
//

import Combine
import Foundation
import MultipeerConnectivity
import NearbyInteraction

class NearbyInteractionManager: NSObject, ObservableObject {
    static let shared = NearbyInteractionManager()

    // MARK: - Published State

    @Published var spatialState: SpatialState = .idle
    @Published var currentDistance: Float?
    @Published private(set) var isSupported: Bool = false

    // MARK: - Configuration

    var config = SpatialConfig()

    // MARK: - Callbacks

    /// Called when debounce confirms contact. Parameter is the connected peer's MCPeerID.
    var onSpatialTrigger: ((MCPeerID) -> Void)?

    // MARK: - Internal Properties

    internal var niSession: NISession?
    internal var connectedPeerID: MCPeerID?
    internal var cooldownTimer: Timer?

    /// Weak reference to ProximityManager to send NI tokens over MC session
    internal weak var proximityManager: ProximityManager?

    // Tag prefix for NI token messages sent over MC
    static let tokenPrefix = Data("NI_TOKEN:".utf8)
    private static var supportsNearbyInteraction: Bool {
        if #available(iOS 16.0, *) {
            return NISession.deviceCapabilities.supportsPreciseDistanceMeasurement
        } else {
            return NISession.isSupported
        }
    }

    // MARK: - Init

    override init() {
        super.init()
        self.isSupported = Self.supportsNearbyInteraction
    }

    // MARK: - Session Lifecycle

    /// Call this when MC session connects to a peer.
    /// Initializes NISession, grabs local token, and sends it via MC.
    func startSession(with peerID: MCPeerID, via proximityManager: ProximityManager) {
        guard Self.supportsNearbyInteraction else {
            DispatchQueue.main.async {
                self.spatialState = .unavailable(reason: "UWB not supported on this device")
            }
            return
        }

        // Clean up any previous session
        niSession?.invalidate()

        self.proximityManager = proximityManager
        self.connectedPeerID = peerID

        let session = NISession()
        session.delegate = self
        self.niSession = session

        guard let myToken = session.discoveryToken else {
            DispatchQueue.main.async {
                self.spatialState = .unavailable(reason: "Failed to obtain discovery token")
            }
            return
        }

        sendDiscoveryToken(myToken, to: peerID)
        print("[NI] Session created, token sent to \(peerID.displayName)")
    }

    /// Call this after receiving the peer's NIDiscoveryToken to start ranging.
    func activateRanging(with peerToken: NIDiscoveryToken) {
        let peerConfig = NINearbyPeerConfiguration(peerToken: peerToken)
        niSession?.run(peerConfig)
        DispatchQueue.main.async {
            self.spatialState = .idle
        }
        print("[NI] Ranging activated")
    }

    /// Pause UWB to save power (e.g. exchange complete, app backgrounding).
    func pauseSession() {
        niSession?.pause()
        DispatchQueue.main.async {
            self.spatialState = .idle
            self.currentDistance = nil
        }
    }

    /// Fully tear down the NI session and reset all state.
    func invalidateSession() {
        niSession?.invalidate()
        niSession = nil
        connectedPeerID = nil
        cooldownTimer?.invalidate()
        cooldownTimer = nil
        DispatchQueue.main.async {
            self.spatialState = .idle
            self.currentDistance = nil
        }
    }

    // MARK: - Token Exchange via MC

    internal func sendDiscoveryToken(_ token: NIDiscoveryToken, to peerID: MCPeerID) {
        guard let pm = proximityManager else {
            print("[NI] No proximityManager reference, cannot send token")
            return
        }

        do {
            let tokenData = try NSKeyedArchiver.archivedData(
                withRootObject: token,
                requiringSecureCoding: true
            )
            var tagged = Self.tokenPrefix
            tagged.append(tokenData)
            try pm.session.send(tagged, toPeers: [peerID], with: .reliable)
            print("[NI] Discovery token sent to \(peerID.displayName)")
        } catch {
            print("[NI] Failed to send discovery token: \(error)")
        }
    }

    /// Attempt to decode an incoming MC data packet as an NI discovery token.
    /// Returns true if the data was an NI token (consumed), false otherwise.
    static func decodeDiscoveryToken(from data: Data) -> NIDiscoveryToken? {
        guard data.starts(with: tokenPrefix) else { return nil }
        let tokenData = data.dropFirst(tokenPrefix.count)
        return try? NSKeyedUnarchiver.unarchivedObject(
            ofClass: NIDiscoveryToken.self,
            from: Data(tokenData)
        )
    }

    // MARK: - Distance State Machine

    /// Called by NISessionDelegate on every ranging update.
    internal func processDistanceUpdate(_ distance: Float?) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.currentDistance = distance

            switch self.spatialState {
            case .idle:
                if let d = distance, d < self.config.triggerDistance {
                    self.spatialState = .approaching(framesInRange: 1)
                }

            case .approaching(let frames):
                guard let d = distance else {
                    // Signal lost, reset
                    self.spatialState = .idle
                    return
                }
                if d > self.config.resetDistance {
                    // Moved away past hysteresis band, reset
                    self.spatialState = .idle
                } else if d < self.config.triggerDistance {
                    let next = frames + 1
                    if next >= self.config.requiredFrames {
                        self.spatialState = .confirmed
                        self.handleConfirmedContact()
                    } else {
                        self.spatialState = .approaching(framesInRange: next)
                    }
                }
                // Distance between triggerDistance and resetDistance: hold current frame count

            case .confirmed, .exchanging:
                // Locked, ignore updates until exchange completes
                break

            case .cooldown:
                // In cooldown period, ignore all updates
                break

            case .unavailable:
                break
            }
        }
    }

    // MARK: - Trigger & Completion

    private func handleConfirmedContact() {
        spatialState = .exchanging

        // Haptic feedback: strong tap to signal "contact detected"
        HapticFeedbackManager.shared.heavyImpact()

        // Fire the trigger callback
        if let peerID = connectedPeerID {
            onSpatialTrigger?(peerID)
        }
    }

    /// Call this after the DID exchange completes successfully.
    /// Enters cooldown to prevent re-triggering.
    func exchangeDidComplete() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            HapticFeedbackManager.shared.successNotification()
            self.spatialState = .cooldown

            self.cooldownTimer?.invalidate()
            self.cooldownTimer = Timer.scheduledTimer(
                withTimeInterval: self.config.cooldownDuration,
                repeats: false
            ) { [weak self] _ in
                DispatchQueue.main.async {
                    self?.spatialState = .idle
                }
            }
        }
    }

    /// Call this if the DID exchange fails. Resets to idle so user can retry.
    func exchangeDidFail() {
        DispatchQueue.main.async { [weak self] in
            HapticFeedbackManager.shared.errorNotification()
            self?.spatialState = .idle
        }
    }
}
