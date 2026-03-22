//
//  NearbyInteractionManager+Delegate.swift
//  airmeishi
//
//  NISessionDelegate implementation: handles ranging updates, suspension, and errors.
//

import Foundation
import NearbyInteraction

extension NearbyInteractionManager: NISessionDelegate {

    func session(_ session: NISession, didUpdate nearbyObjects: [NINearbyObject]) {
        guard let nearest = nearbyObjects.first else { return }
        processDistanceUpdate(nearest.distance)
    }

    func session(
        _ session: NISession,
        didRemove nearbyObjects: [NINearbyObject],
        reason: NINearbyObject.RemovalReason
    ) {
        processDistanceUpdate(nil)

        switch reason {
        case .peerEnded:
            print("[NI] Peer ended session")
        case .timeout:
            print("[NI] Peer timed out, attempting to re-exchange tokens")
            // Re-send our token so ranging can restart
            if let token = self.niSession?.discoveryToken,
               let peerID = connectedPeerID {
                sendDiscoveryToken(token, to: peerID)
            }
        @unknown default:
            print("[NI] Peer removed for unknown reason")
        }
    }

    func sessionWasSuspended(_ session: NISession) {
        print("[NI] Session suspended (app backgrounded)")
        DispatchQueue.main.async { [weak self] in
            self?.spatialState = .idle
            self?.currentDistance = nil
        }
    }

    func sessionSuspensionEnded(_ session: NISession) {
        print("[NI] Session suspension ended, re-sending token for re-ranging")
        // After suspension, the session needs a fresh run() call.
        // Re-send our token so the peer can re-activate ranging on their end too.
        if let peerID = connectedPeerID,
           let token = session.discoveryToken {
            sendDiscoveryToken(token, to: peerID)
        }
    }

    func session(_ session: NISession, didInvalidateWith error: Error) {
        print("[NI] Session invalidated: \(error.localizedDescription)")
        DispatchQueue.main.async { [weak self] in
            self?.spatialState = .unavailable(reason: error.localizedDescription)
            self?.currentDistance = nil
        }
    }
}
