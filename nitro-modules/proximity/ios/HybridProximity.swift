//
//  HybridProximity.swift
//  @solidarity/nitro-proximity (iOS)
//
//  Wraps MultipeerConnectivity (peer discovery + transport) and
//  NearbyInteraction (UWB ranging) behind the cross-platform spec
//  declared in src/specs/Proximity.nitro.ts.
//
//  The protocol this class extends — `HybridProximitySpec` — is generated
//  by `bunx nitrogen` from the TS spec. Run that command once after
//  `bun install` (or rely on the Xcode Cloud post-clone script which does
//  it automatically). Until codegen runs, SourceKit will show
//  "Cannot find type 'HybridProximitySpec' in scope" — expected.
//
//  Wire-format note: payload + data are passed across the bridge as
//  ArrayBuffer / Data. We translate to/from Foundation `Data` only at the
//  boundary; internal buffers stay zero-copy.
//

import Foundation
import MultipeerConnectivity
import NearbyInteraction
import NitroModules

final class HybridProximity: HybridProximitySpec {

  // MARK: - State

  private var peerID: MCPeerID?
  private var session: MCSession?
  private var advertiser: MCNearbyServiceAdvertiser?
  private var browser: MCNearbyServiceBrowser?

  private var niSessions: [String: NISession] = [:]

  private var listeners: [(ProximityEvent) -> Void] = []
  private let eventQueue = DispatchQueue(label: "gg.solidarity.proximity.events")

  // MARK: - Advertise / Browse

  func startAdvertising(
    displayName: String,
    serviceType: String,
    info: [String: String]
  ) throws {
    let peer = MCPeerID(displayName: displayName)
    let session = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .required)
    session.delegate = sessionDelegate

    let adv = MCNearbyServiceAdvertiser(
      peer: peer,
      discoveryInfo: info,
      serviceType: serviceType
    )
    adv.delegate = advertiserDelegate
    adv.startAdvertisingPeer()

    self.peerID = peer
    self.session = session
    self.advertiser = adv
  }

  func stopAdvertising() {
    advertiser?.stopAdvertisingPeer()
    advertiser = nil
  }

  func startBrowsing(serviceType: String) {
    guard let peer = peerID else { return }
    let br = MCNearbyServiceBrowser(peer: peer, serviceType: serviceType)
    br.delegate = browserDelegate
    br.startBrowsingForPeers()
    self.browser = br
  }

  func stopBrowsing() {
    browser?.stopBrowsingForPeers()
    browser = nil
  }

  // MARK: - Invitation / data

  func invitePeer(peerId: String, payload: ArrayBuffer, timeoutSec: Double) async throws -> Bool {
    // Lookup peer by displayName-as-id; real impl maintains an id↔MCPeerID map.
    // Stubbed: log + always resolve false until peer map is wired (parity with
    // Swift ProximityManager+Discovery.swift comes in Phase 6.1).
    return false
  }

  func acceptInvitation(peerId: String) {}
  func rejectInvitation(peerId: String) {}
  func sendData(peerId: String, data: ArrayBuffer) async throws {}
  func disconnect(peerId: String) {}

  // MARK: - UWB ranging

  func startRanging(peerId: String) async throws {
    let ni = NISession()
    niSessions[peerId] = ni
    // Real impl exchanges NIDiscoveryToken over the MCSession channel and
    // calls `ni.run(NINearbyPeerConfiguration(peerToken:))` once both sides
    // have each other's tokens. Token exchange logic mirrors Swift
    // NearbyInteractionManager+Delegate.swift.
  }

  func stopRanging(peerId: String) {
    niSessions.removeValue(forKey: peerId)?.invalidate()
  }

  // MARK: - Event listeners

  func addEventListener(handler: @escaping (ProximityEvent) -> Void) -> () -> Void {
    var idRef: ObjectIdentifier?
    eventQueue.sync {
      listeners.append(handler)
      idRef = ObjectIdentifier(handler as AnyObject)
    }
    return { [weak self] in
      self?.eventQueue.async {
        self?.listeners.removeAll { ObjectIdentifier($0 as AnyObject) == idRef }
      }
    }
  }

  private func emit(_ event: ProximityEvent) {
    eventQueue.async { [weak self] in
      self?.listeners.forEach { $0(event) }
    }
  }

  // MARK: - Delegates (held by lazy properties to avoid retain cycles)

  private lazy var sessionDelegate: SessionDelegate = SessionDelegate(owner: self)
  private lazy var advertiserDelegate: AdvertiserDelegate = AdvertiserDelegate(owner: self)
  private lazy var browserDelegate: BrowserDelegate = BrowserDelegate(owner: self)
}

// MARK: - MC delegates split into their own classes to keep the HybridObject focused.

private final class SessionDelegate: NSObject, MCSessionDelegate {
  weak var owner: HybridProximity?
  init(owner: HybridProximity) { self.owner = owner }

  func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
    switch state {
    case .connected:
      owner?.emit(.sessionEstablished(peerId: peerID.displayName))
    case .notConnected:
      owner?.emit(.sessionEnded(peerId: peerID.displayName, reason: "notConnected"))
    case .connecting:
      break
    @unknown default:
      break
    }
  }

  func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
    owner?.emit(.dataReceived(peerId: peerID.displayName, data: data))
  }

  func session(_ s: MCSession, didReceive stream: InputStream, withName n: String, fromPeer p: MCPeerID) {}
  func session(_ s: MCSession, didStartReceivingResourceWithName n: String, fromPeer p: MCPeerID, with progress: Progress) {}
  func session(_ s: MCSession, didFinishReceivingResourceWithName n: String, fromPeer p: MCPeerID, at u: URL?, withError e: Error?) {}
}

private final class AdvertiserDelegate: NSObject, MCNearbyServiceAdvertiserDelegate {
  weak var owner: HybridProximity?
  init(owner: HybridProximity) { self.owner = owner }

  func advertiser(
    _ advertiser: MCNearbyServiceAdvertiser,
    didReceiveInvitationFromPeer peerID: MCPeerID,
    withContext context: Data?,
    invitationHandler: @escaping (Bool, MCSession?) -> Void
  ) {
    owner?.emit(.invitationReceived(peerId: peerID.displayName, payload: context ?? Data()))
    // Real impl stores `invitationHandler` keyed by peerId so
    // acceptInvitation/rejectInvitation can resolve it.
  }
}

private final class BrowserDelegate: NSObject, MCNearbyServiceBrowserDelegate {
  weak var owner: HybridProximity?
  init(owner: HybridProximity) { self.owner = owner }

  func browser(
    _ browser: MCNearbyServiceBrowser,
    foundPeer peerID: MCPeerID,
    withDiscoveryInfo info: [String: String]?
  ) {
    let peer = ProximityPeer(
      id: peerID.displayName,
      displayName: peerID.displayName,
      discoveryInfo: info ?? [:],
      rssi: nil,
      distance: nil,
      direction: nil
    )
    owner?.emit(.peerFound(peer: peer))
  }

  func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
    owner?.emit(.peerLost(peerId: peerID.displayName))
  }
}
