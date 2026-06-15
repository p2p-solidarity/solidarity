//
//  MultipeerTransport.swift
//  @solidarity/nitro-proximity (iOS)
//
//  Legacy-compatible MultipeerConnectivity transport. This is the bridge to
//  the deployed SwiftUI Solidarity app ("old iOS"), whose ProximityManager
//  advertises/browses over MultipeerConnectivity rather than the BLE/L2CAP
//  path the new cross-platform module uses.
//
//  Wire compatibility with the old app (solidarity/Services/Sharing/
//  ProximityManager*.swift + Services/Utils/Branding.swift):
//    • serviceType:          "say-share"        (AppBranding.currentProximityServiceType)
//    • legacy browse type:   "airmeishi-share"  (AppBranding.legacyProximityServiceType)
//    • discovery info:       [String: String] (name/title/company/animal/level/zk/…)
//    • session transport:    MCSession.send(Data, .reliable); the first inbound
//                            Data is surfaced as the invitation context, the
//                            rest as `dataReceived`.
//
//  This type owns ONLY MultipeerConnectivity. It maps MC's peer model onto the
//  same `ProximityEvent` stream the BLE transport emits, so the TS layer
//  (`src/matching/session.ts`) consumes both identically. MCPeerID isn't a
//  stable string across launches, so we key peers by `displayName` (which the
//  old app derives from the ZK commitment prefix or device name) and keep an
//  internal MCPeerID map.
//
//  Service-type rules (Apple): 1–15 chars, lowercase ASCII letters, digits,
//  and hyphens; both "say-share" and "airmeishi-share" satisfy this.
//

import Foundation
import MultipeerConnectivity
import NitroModules  // ArrayBuffer + the nitrogen-generated Proximity* types

#if canImport(UIKit)
  import UIKit
#endif

/// Shared MC constants — kept in one place so the value matches the old app
/// byte-for-byte. Changing these breaks legacy interop.
internal enum MultipeerWire {
  /// Current service type the deployed app advertises + browses on.
  static let serviceType = "say-share"
  /// Older service type the deployed app ALSO browses, kept so a brand-new
  /// install can still see installs that predate the rename.
  static let legacyServiceType = "airmeishi-share"
  /// MC service types must be ≤ 15 chars; both constants are validated at use.
  static func sanitized(_ raw: String) -> String {
    let allowed = Set("abcdefghijklmnopqrstuvwxyz0123456789-")
    let lowered = raw.lowercased().filter { allowed.contains($0) }
    return String(lowered.prefix(15))
  }
}

/// Delegate back into HybridProximity so MC events join the single event
/// stream. All callbacks may arrive on arbitrary queues — the implementer is
/// responsible for its own synchronisation (HybridProximity uses `withState`).
internal protocol MultipeerTransportDelegate: AnyObject {
  func multipeerDidEmit(_ event: ProximityEvent)
}

/// MultipeerConnectivity transport. Lifecycle mirrors the BLE side:
/// startAdvertising/stopAdvertising, startBrowsing/stopBrowsing, invitePeer,
/// accept/reject, sendData, disconnect.
internal final class MultipeerTransport: NSObject {

  weak var delegate: MultipeerTransportDelegate?

  private let serviceType: String
  private let legacyServiceType: String?

  private let localPeerID: MCPeerID
  private lazy var session: MCSession = {
    let s = MCSession(
      peer: localPeerID, securityIdentity: nil, encryptionPreference: .required
    )
    s.delegate = self
    return s
  }()

  private var advertiser: MCNearbyServiceAdvertiser?
  private var browser: MCNearbyServiceBrowser?
  private var legacyBrowser: MCNearbyServiceBrowser?

  /// peerId (displayName) → MCPeerID. The TS layer only sees the string id.
  private var peers: [String: MCPeerID] = [:]
  /// Invitation handlers we're holding until the TS layer accepts / rejects.
  private var pendingInvitationHandlers: [String: (Bool, MCSession?) -> Void] = [:]
  /// invitePeer continuations awaiting MCSessionState.connected.
  private var pendingInvites: [String: CheckedContinuation<Bool, Never>] = [:]
  /// Tracks which connected peers we've already surfaced a session for, so a
  /// state flap (.connecting → .connected) doesn't double-emit.
  private var establishedPeers: Set<String> = []

  private let lock = NSLock()

  init(displayName: String) {
    // MCPeerID displayName must be 1–63 bytes. Fall back to the device name.
    let trimmed = String(displayName.prefix(63))
    let safeName = trimmed.isEmpty ? MultipeerTransport.deviceName() : trimmed
    self.localPeerID = MCPeerID(displayName: safeName)
    self.serviceType = MultipeerWire.serviceType
    self.legacyServiceType =
      MultipeerWire.legacyServiceType == MultipeerWire.serviceType
      ? nil : MultipeerWire.legacyServiceType
    super.init()
  }

  private static func deviceName() -> String {
    #if canImport(UIKit)
      return UIDevice.current.name
    #else
      return "solidarity-peer"
    #endif
  }

  private func withState<T>(_ body: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return body()
  }

  private func emit(_ event: ProximityEvent) {
    delegate?.multipeerDidEmit(event)
  }

  // MARK: Advertise

  /// `discoveryInfoJson` is the same JSON blob the BLE side broadcasts; the old
  /// app expects a flat `[String: String]`, so we decode + stringify values.
  func startAdvertising(displayName: String, discoveryInfoJson: String) {
    let info = MultipeerTransport.flatten(json: discoveryInfoJson)
    let adv = MCNearbyServiceAdvertiser(
      peer: localPeerID, discoveryInfo: info, serviceType: serviceType
    )
    adv.delegate = self
    adv.startAdvertisingPeer()
    withState { self.advertiser = adv }
  }

  func stopAdvertising() {
    let adv = withState { () -> MCNearbyServiceAdvertiser? in
      let a = self.advertiser
      self.advertiser = nil
      return a
    }
    adv?.stopAdvertisingPeer()
  }

  // MARK: Browse

  func startBrowsing() {
    let b = MCNearbyServiceBrowser(peer: localPeerID, serviceType: serviceType)
    b.delegate = self
    b.startBrowsingForPeers()
    var legacy: MCNearbyServiceBrowser?
    if let legacyType = legacyServiceType {
      let lb = MCNearbyServiceBrowser(peer: localPeerID, serviceType: legacyType)
      lb.delegate = self
      lb.startBrowsingForPeers()
      legacy = lb
    }
    withState {
      self.browser = b
      self.legacyBrowser = legacy
    }
  }

  func stopBrowsing() {
    let (b, lb) = withState { () -> (MCNearbyServiceBrowser?, MCNearbyServiceBrowser?) in
      let pair = (self.browser, self.legacyBrowser)
      self.browser = nil
      self.legacyBrowser = nil
      self.peers.removeAll()
      return pair
    }
    b?.stopBrowsingForPeers()
    lb?.stopBrowsingForPeers()
  }

  // MARK: Invite (client side)

  /// Invite a discovered peer. The first frame (`payload`) ships as the MC
  /// invitation context, matching the old app's group-invite-or-connect probe.
  /// Resolves true once the session reports `.connected`.
  func invitePeer(
    peerId: String, payload: Data, timeoutSec: Double
  ) async -> Bool {
    let (peerID, browserForInvite) = withState {
      () -> (MCPeerID?, MCNearbyServiceBrowser?) in
      (self.peers[peerId], self.browser)
    }
    guard let peerID = peerID, let browser = browserForInvite else { return false }

    return await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
      withState { self.pendingInvites[peerId] = cont }
      let context = payload.isEmpty ? nil : payload
      browser.invitePeer(
        peerID, to: session, withContext: context, timeout: timeoutSec
      )
    }
  }

  // MARK: Accept / reject (server side)

  func acceptInvitation(peerId: String) {
    let handler = withState { self.pendingInvitationHandlers.removeValue(forKey: peerId) }
    handler?(true, session)
  }

  func rejectInvitation(peerId: String) {
    let handler = withState { self.pendingInvitationHandlers.removeValue(forKey: peerId) }
    handler?(false, nil)
  }

  // MARK: Data

  func sendData(peerId: String, data: Data) throws {
    let peerID = withState { self.peers[peerId] }
    guard let peerID = peerID, session.connectedPeers.contains(peerID) else {
      throw NSError(
        domain: "gg.solidarity.proximity.mc", code: 404,
        userInfo: [NSLocalizedDescriptionKey: "Peer not connected: \(peerId)"]
      )
    }
    try session.send(data, toPeers: [peerID], with: .reliable)
  }

  func disconnect(peerId: String) {
    if peerId == "*" {
      session.disconnect()
      withState {
        self.peers.removeAll()
        self.establishedPeers.removeAll()
      }
      return
    }
    // MC has no per-peer disconnect; surface the session end and forget it.
    let wasEstablished = withState { () -> Bool in
      self.peers.removeValue(forKey: peerId)
      return self.establishedPeers.remove(peerId) != nil
    }
    if wasEstablished {
      emit(
        ProximityEvent(
          kind: .sessionended, peer: nil, peerId: peerId, payload: nil,
          reason: "localDisconnect", data: nil, distance: nil, direction: nil,
          errorMessage: nil, errorCode: nil
        )
      )
    }
  }

  func teardown() {
    stopAdvertising()
    stopBrowsing()
    session.disconnect()
    withState {
      self.peers.removeAll()
      self.pendingInvitationHandlers.removeAll()
      self.establishedPeers.removeAll()
    }
  }

  // MARK: Helpers

  /// Old app sends discovery info as `[String: String]`. Our BLE side carries
  /// it as JSON; flatten so MC peers see the same keys (string values only;
  /// nested values are JSON-stringified).
  private static func flatten(json: String) -> [String: String] {
    guard
      let data = json.data(using: .utf8),
      let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return [:] }
    var out: [String: String] = [:]
    for (k, v) in obj {
      if let s = v as? String {
        out[k] = s
      } else if let n = v as? NSNumber {
        out[k] = n.stringValue
      } else if let nested = try? JSONSerialization.data(withJSONObject: v),
        let s = String(data: nested, encoding: .utf8)
      {
        out[k] = s
      }
    }
    return out
  }

  /// Re-encode an MC `[String: String]` discovery dict back to the JSON the TS
  /// layer expects in `ProximityPeer.discoveryInfoJson`.
  private static func toJson(_ info: [String: String]?) -> String {
    guard let info = info, !info.isEmpty,
      let data = try? JSONSerialization.data(withJSONObject: info),
      let s = String(data: data, encoding: .utf8)
    else { return "{}" }
    return s
  }
}

// MARK: - MCNearbyServiceAdvertiserDelegate

extension MultipeerTransport: MCNearbyServiceAdvertiserDelegate {
  func advertiser(
    _ advertiser: MCNearbyServiceAdvertiser,
    didReceiveInvitationFromPeer peerID: MCPeerID,
    withContext context: Data?,
    invitationHandler: @escaping (Bool, MCSession?) -> Void
  ) {
    let peerId = peerID.displayName
    withState {
      self.peers[peerId] = peerID
      self.pendingInvitationHandlers[peerId] = invitationHandler
    }
    // First frame == invitation context, mirroring the BLE transport.
    let payloadBuf = context.flatMap { try? ArrayBuffer.copy(data: $0) }
    emit(
      ProximityEvent(
        kind: .invitationreceived, peer: nil, peerId: peerId, payload: payloadBuf,
        reason: nil, data: nil, distance: nil, direction: nil,
        errorMessage: nil, errorCode: nil
      )
    )
  }

  func advertiser(
    _ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error
  ) {
    emit(
      ProximityEvent(
        kind: .error, peer: nil, peerId: nil, payload: nil, reason: nil,
        data: nil, distance: nil, direction: nil,
        errorMessage: "MC advertise failed: \(error.localizedDescription)",
        errorCode: "mc_advertise_failed"
      )
    )
  }
}

// MARK: - MCNearbyServiceBrowserDelegate

extension MultipeerTransport: MCNearbyServiceBrowserDelegate {
  func browser(
    _ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID,
    withDiscoveryInfo info: [String: String]?
  ) {
    let peerId = peerID.displayName
    let isNew = withState { () -> Bool in
      if self.peers[peerId] != nil { return false }
      self.peers[peerId] = peerID
      return true
    }
    guard isNew else { return }
    let peer = ProximityPeer(
      id: peerId, displayName: peerId,
      discoveryInfoJson: MultipeerTransport.toJson(info),
      rssi: nil, distance: nil, direction: nil
    )
    emit(
      ProximityEvent(
        kind: .peerfound, peer: peer, peerId: peerId, payload: nil, reason: nil,
        data: nil, distance: nil, direction: nil, errorMessage: nil, errorCode: nil
      )
    )
  }

  func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
    let peerId = peerID.displayName
    withState { self.peers.removeValue(forKey: peerId) }
    emit(
      ProximityEvent(
        kind: .peerlost, peer: nil, peerId: peerId, payload: nil, reason: nil,
        data: nil, distance: nil, direction: nil, errorMessage: nil, errorCode: nil
      )
    )
  }

  func browser(
    _ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error
  ) {
    emit(
      ProximityEvent(
        kind: .error, peer: nil, peerId: nil, payload: nil, reason: nil,
        data: nil, distance: nil, direction: nil,
        errorMessage: "MC browse failed: \(error.localizedDescription)",
        errorCode: "mc_browse_failed"
      )
    )
  }
}

// MARK: - MCSessionDelegate

extension MultipeerTransport: MCSessionDelegate {
  func session(
    _ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState
  ) {
    let peerId = peerID.displayName
    switch state {
    case .connected:
      let firstTime = withState { () -> Bool in
        self.peers[peerId] = peerID
        return self.establishedPeers.insert(peerId).inserted
      }
      // Resolve a pending client-side invite regardless (idempotent).
      let cont = withState { self.pendingInvites.removeValue(forKey: peerId) }
      cont?.resume(returning: true)
      if firstTime {
        emit(
          ProximityEvent(
            kind: .sessionestablished, peer: nil, peerId: peerId, payload: nil,
            reason: nil, data: nil, distance: nil, direction: nil,
            errorMessage: nil, errorCode: nil
          )
        )
      }
    case .notConnected:
      let cont = withState { self.pendingInvites.removeValue(forKey: peerId) }
      cont?.resume(returning: false)
      let wasEstablished = withState { self.establishedPeers.remove(peerId) != nil }
      if wasEstablished {
        emit(
          ProximityEvent(
            kind: .sessionended, peer: nil, peerId: peerId, payload: nil,
            reason: "notConnected", data: nil, distance: nil, direction: nil,
            errorMessage: nil, errorCode: nil
          )
        )
      }
    case .connecting:
      break
    @unknown default:
      break
    }
  }

  func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
    let peerId = peerID.displayName
    let dataBuf = try? ArrayBuffer.copy(data: data)
    emit(
      ProximityEvent(
        kind: .datareceived, peer: nil, peerId: peerId, payload: nil, reason: nil,
        data: dataBuf, distance: nil, direction: nil, errorMessage: nil, errorCode: nil
      )
    )
  }

  func session(
    _ session: MCSession, didReceive stream: InputStream, withName streamName: String,
    fromPeer peerID: MCPeerID
  ) {}

  func session(
    _ session: MCSession, didStartReceivingResourceWithName resourceName: String,
    fromPeer peerID: MCPeerID, with progress: Progress
  ) {}

  func session(
    _ session: MCSession, didFinishReceivingResourceWithName resourceName: String,
    fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?
  ) {}
}
