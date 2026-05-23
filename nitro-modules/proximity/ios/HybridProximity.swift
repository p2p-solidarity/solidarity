//
//  HybridProximity.swift
//  @solidarity/nitro-proximity (iOS)
//
//  Wraps Apple's MultipeerConnectivity (peer discovery + transport) and
//  NearbyInteraction (UWB ranging) behind the Nitrogen-generated
//  `HybridProximitySpec` protocol.
//
//  The class deliberately stays transport-layer only — application
//  decoding (NI discovery tokens, group invites, WebRTC signaling) lives
//  in the TS layer. Anything that crosses the JS bridge does so via
//  `addEventListener` callbacks emitting `ProximityEvent` records.
//
//  Apple's MC/NI delegate protocols are `@objc` and require an NSObject
//  conformer. `HybridProximitySpec_base` (the generated Nitrogen base
//  class we inherit from) is **not** an NSObject, and Swift forbids
//  multiple class inheritance, so we route delegate callbacks through
//  private `NSObject` proxy classes that hold a weak ref to us.
//
import Foundation
import MultipeerConnectivity
import NearbyInteraction
import NitroModules

#if canImport(UIKit)
  import UIKit
#endif

final class HybridProximity: HybridProximitySpec {

  // MARK: - Stored state

  private var peerID: MCPeerID?
  /// Single MCSession shared by every connected peer.
  private var session: MCSession?
  private var advertiser: MCNearbyServiceAdvertiser?
  private var browser: MCNearbyServiceBrowser?

  /// Discovered peers keyed by `displayName` (the string we hand to the
  /// TS side as `peerId`). Display names must therefore be unique per
  /// session — Solidarity uses a hash of the user's commitment.
  private var foundPeers: [String: MCPeerID] = [:]
  /// Outgoing invitation continuations resolved by `session(_:peer:didChange:)`.
  private var pendingInvitations: [String: CheckedContinuation<Bool, Never>] = [:]
  /// Incoming invitation handlers parked by `advertiser(_:didReceiveInvitation…)`.
  /// Resolved by `acceptInvitation` / `rejectInvitation`.
  private var pendingIncomingHandlers: [String: (Bool, MCSession?) -> Void] = [:]
  /// One NISession per peer pair.
  private var niSessions: [String: NISession] = [:]
  /// Reverse lookup from NISession → peer display name (NI delegate callbacks
  /// only carry the session pointer).
  private var niSessionPeerNames: [ObjectIdentifier: String] = [:]

  /// Event listener fan-out. UUID key so unsubscribe stays O(1).
  private var listeners: [UUID: (ProximityEvent) -> Void] = [:]

  private let stateQueue = DispatchQueue(label: "gg.solidarity.proximity.state")

  // MARK: - Delegate proxies (init in init())

  private lazy var mcSessionProxy: MCSessionProxy = MCSessionProxy(owner: self)
  private lazy var mcAdvertiserProxy: MCAdvertiserProxy = MCAdvertiserProxy(owner: self)
  private lazy var mcBrowserProxy: MCBrowserProxy = MCBrowserProxy(owner: self)
  private lazy var niProxy: NIProxy = NIProxy(owner: self)

  // MARK: - Helpers

  @inline(__always)
  private func withState<T>(_ body: () -> T) -> T { stateQueue.sync(execute: body) }

  fileprivate func emit(_ event: ProximityEvent) {
    let snapshot = withState { Array(self.listeners.values) }
    for handler in snapshot { handler(event) }
  }

  fileprivate func emitError(_ message: String, code: String) {
    emit(makeEvent(.error, errorMessage: message, errorCode: code))
  }

  /// Single ProximityEvent-builder so call sites stay short. Generated
  /// init has 10 positional params — wrap once.
  fileprivate func makeEvent(
    _ kind: ProximityEventKind,
    peer: ProximityPeer? = nil,
    peerId: String? = nil,
    payload: ArrayBuffer? = nil,
    reason: String? = nil,
    data: ArrayBuffer? = nil,
    distance: Double? = nil,
    direction: ProximityDirection? = nil,
    errorMessage: String? = nil,
    errorCode: String? = nil
  ) -> ProximityEvent {
    ProximityEvent(
      kind: kind, peer: peer, peerId: peerId, payload: payload,
      reason: reason, data: data, distance: distance, direction: direction,
      errorMessage: errorMessage, errorCode: errorCode
    )
  }

  private static func parseInfo(_ json: String) -> [String: String]? {
    guard let data = json.data(using: .utf8) else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: String]
  }

  fileprivate static func discoveryJson(_ info: [String: String]?) -> String {
    guard let info = info,
          let data = try? JSONSerialization.data(withJSONObject: info),
          let json = String(data: data, encoding: .utf8) else { return "{}" }
    return json
  }

  // MARK: - Advertise / Browse

  func startAdvertising(
    displayName: String, serviceType: String, discoveryInfoJson: String
  ) throws {
    let peer = MCPeerID(displayName: displayName)
    let sess = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .required)
    sess.delegate = mcSessionProxy
    let info = Self.parseInfo(discoveryInfoJson)
    let adv = MCNearbyServiceAdvertiser(peer: peer, discoveryInfo: info, serviceType: serviceType)
    adv.delegate = mcAdvertiserProxy
    adv.startAdvertisingPeer()
    withState {
      self.peerID = peer
      self.session = sess
      self.advertiser = adv
    }
  }

  func stopAdvertising() {
    withState {
      self.advertiser?.stopAdvertisingPeer()
      self.advertiser = nil
    }
  }

  func startBrowsing(serviceType: String) {
    let displayName = deviceDisplayNameFallback()
    withState {
      let peer = self.peerID ?? MCPeerID(displayName: displayName)
      if self.peerID == nil { self.peerID = peer }
      if self.session == nil {
        let sess = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .required)
        sess.delegate = self.mcSessionProxy
        self.session = sess
      }
      let br = MCNearbyServiceBrowser(peer: peer, serviceType: serviceType)
      br.delegate = self.mcBrowserProxy
      br.startBrowsingForPeers()
      self.browser = br
    }
  }

  func stopBrowsing() {
    withState {
      self.browser?.stopBrowsingForPeers()
      self.browser = nil
      self.foundPeers.removeAll()
    }
  }

  // MARK: - Invitation lifecycle

  func invitePeer(peerId: String, payload: ArrayBuffer, timeoutSec: Double) throws -> Promise<Bool> {
    return Promise.async {
      let context = self.copyPayload(payload)
      let resolved = await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
        self.withState {
          guard let target = self.foundPeers[peerId],
                let browser = self.browser,
                let sess = self.session else {
            cont.resume(returning: false)
            return
          }
          self.pendingInvitations[peerId] = cont
          browser.invitePeer(
            target, to: sess, withContext: context, timeout: TimeInterval(timeoutSec)
          )
        }
      }
      return resolved
    }
  }

  func acceptInvitation(peerId: String) {
    withState {
      guard let handler = self.pendingIncomingHandlers.removeValue(forKey: peerId),
            let sess = self.session else { return }
      handler(true, sess)
    }
  }

  func rejectInvitation(peerId: String) {
    withState {
      guard let handler = self.pendingIncomingHandlers.removeValue(forKey: peerId) else { return }
      handler(false, nil)
    }
  }

  // MARK: - Data transfer

  func sendData(peerId: String, data: ArrayBuffer) throws -> Promise<Void> {
    return Promise.async {
      let bytes = self.copyPayload(data)
      // Resolve session + target outside the synchronized read so the
      // throwing `MCSession.send` doesn't have to escape `withState`'s
      // non-throwing closure type.
      let resolved: (MCSession, MCPeerID)? = self.withState {
        guard let sess = self.session,
              let target = sess.connectedPeers.first(where: { $0.displayName == peerId })
        else { return nil }
        return (sess, target)
      }
      guard let (sess, target) = resolved else {
        throw NSError(
          domain: "gg.solidarity.proximity",
          code: 404,
          userInfo: [NSLocalizedDescriptionKey: "Peer not connected: \(peerId)"]
        )
      }
      try sess.send(bytes, toPeers: [target], with: .reliable)
    }
  }

  func disconnect(peerId: String) {
    withState {
      // MCSession has no per-peer disconnect API. We treat "*" as a
      // session-wide tear-down; any specific peerId only drops the local
      // NI binding (matches the Swift legacy ProximityManager behaviour).
      if peerId == "*" { self.session?.disconnect() }
      if let s = self.niSessions.removeValue(forKey: peerId) {
        self.niSessionPeerNames.removeValue(forKey: ObjectIdentifier(s))
        s.invalidate()
      }
    }
  }

  // MARK: - UWB ranging

  func startRanging(peerId: String) throws -> Promise<Void> {
    return Promise.async {
      self.withState {
        let s = NISession()
        s.delegate = self.niProxy
        self.niSessions[peerId] = s
        self.niSessionPeerNames[ObjectIdentifier(s)] = peerId
      }
      // The TS caller still needs to ship the local `discoveryToken` over
      // `sendData` and call NISession.run(NINearbyPeerConfiguration:) once
      // the peer's token arrives. We deliberately surface that exchange
      // to the JS layer rather than encoding wire formats here.
    }
  }

  func stopRanging(peerId: String) {
    withState {
      if let s = self.niSessions.removeValue(forKey: peerId) {
        self.niSessionPeerNames.removeValue(forKey: ObjectIdentifier(s))
        s.invalidate()
      }
    }
  }

  // MARK: - Listener registration

  func addEventListener(handler: @escaping (ProximityEvent) -> Void) -> () -> Void {
    let id = UUID()
    withState { self.listeners[id] = handler }
    return { [weak self] in
      self?.withState { self?.listeners.removeValue(forKey: id) }
    }
  }

  // MARK: - Delegate callback receivers (invoked from proxies)

  fileprivate func handleIncomingInvitation(
    fromPeer peerID: MCPeerID,
    context: Data?,
    invitationHandler: @escaping (Bool, MCSession?) -> Void
  ) {
    let key = peerID.displayName
    withState { self.pendingIncomingHandlers[key] = invitationHandler }
    let payloadBuffer: ArrayBuffer? = context.map { ArrayBuffer.copyFromData($0) }
    emit(makeEvent(.invitationreceived, peerId: key, payload: payloadBuffer))
  }

  fileprivate func handleFoundPeer(_ peerID: MCPeerID, info: [String: String]?) {
    let key = peerID.displayName
    withState { self.foundPeers[key] = peerID }
    let peer = ProximityPeer(
      id: key, displayName: peerID.displayName,
      discoveryInfoJson: Self.discoveryJson(info),
      rssi: nil, distance: nil, direction: nil
    )
    emit(makeEvent(.peerfound, peer: peer, peerId: key))
  }

  fileprivate func handleLostPeer(_ peerID: MCPeerID) {
    let key = peerID.displayName
    withState { self.foundPeers.removeValue(forKey: key) }
    emit(makeEvent(.peerlost, peerId: key))
  }

  fileprivate func handleSessionStateChange(_ peerID: MCPeerID, state: MCSessionState) {
    let key = peerID.displayName
    switch state {
    case .connected:
      withState {
        if let cont = self.pendingInvitations.removeValue(forKey: key) {
          cont.resume(returning: true)
        }
      }
      emit(makeEvent(.sessionestablished, peerId: key))
    case .notConnected:
      withState {
        if let cont = self.pendingInvitations.removeValue(forKey: key) {
          cont.resume(returning: false)
        }
      }
      emit(makeEvent(.sessionended, peerId: key, reason: "notConnected"))
    case .connecting:
      // Intermediate — TS layer infers from absence of sessionEstablished.
      break
    @unknown default:
      break
    }
  }

  fileprivate func handleDataReceived(_ data: Data, from peerID: MCPeerID) {
    let buf = ArrayBuffer.copyFromData(data)
    emit(makeEvent(.datareceived, peerId: peerID.displayName, data: buf))
  }

  fileprivate func handleNIUpdate(session: NISession, objects: [NINearbyObject]) {
    let key = withState { self.niSessionPeerNames[ObjectIdentifier(session)] }
    guard let peerId = key else { return }
    for obj in objects {
      let dir = obj.direction.map {
        ProximityDirection(x: Double($0.x), y: Double($0.y), z: Double($0.z))
      }
      let dist = obj.distance.map(Double.init)
      emit(makeEvent(.distanceupdate, peerId: peerId, distance: dist, direction: dir))
    }
  }

  fileprivate func handleNIRemoved(session: NISession, reason: NINearbyObject.RemovalReason) {
    let key = withState { self.niSessionPeerNames[ObjectIdentifier(session)] }
    guard let peerId = key else { return }
    let reasonStr: String
    switch reason {
    case .peerEnded: reasonStr = "peerEnded"
    case .timeout:   reasonStr = "timeout"
    @unknown default: reasonStr = "unknown"
    }
    emit(makeEvent(.sessionended, peerId: peerId, reason: reasonStr))
  }

  fileprivate func handleNIInvalidated(session: NISession, error: Error) {
    let key = withState { self.niSessionPeerNames[ObjectIdentifier(session)] }
    if let peerId = key {
      withState {
        self.niSessions.removeValue(forKey: peerId)
        self.niSessionPeerNames.removeValue(forKey: ObjectIdentifier(session))
      }
    }
    emitError(error.localizedDescription, code: "ni_invalidated")
  }

  fileprivate func handleAdvertiseError(_ error: Error) {
    emitError(error.localizedDescription, code: "advertise_failed")
  }

  fileprivate func handleBrowseError(_ error: Error) {
    emitError(error.localizedDescription, code: "browse_failed")
  }

  // MARK: - Internal helpers

  private func copyPayload(_ buffer: ArrayBuffer) -> Data {
    let count = buffer.size
    guard count > 0 else { return Data() }
    return Data(bytes: buffer.data, count: count)
  }

  private func deviceDisplayNameFallback() -> String {
    #if canImport(UIKit)
      return UIDevice.current.name
    #else
      return "solidarity-peer"
    #endif
  }
}

// MARK: - Delegate proxies

/// MCSessionDelegate adapter. NSObject so the @objc protocol conformance
/// resolves; weak owner so the proxy never extends HybridProximity's life.
private final class MCSessionProxy: NSObject, MCSessionDelegate {
  weak var owner: HybridProximity?
  init(owner: HybridProximity) { self.owner = owner }

  func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
    owner?.handleSessionStateChange(peerID, state: state)
  }

  func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
    owner?.handleDataReceived(data, from: peerID)
  }

  // Solidarity only uses .reliable byte streams, never MC streams/resources.
  func session(
    _ session: MCSession, didReceive stream: InputStream,
    withName streamName: String, fromPeer peerID: MCPeerID
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

private final class MCAdvertiserProxy: NSObject, MCNearbyServiceAdvertiserDelegate {
  weak var owner: HybridProximity?
  init(owner: HybridProximity) { self.owner = owner }

  func advertiser(
    _ advertiser: MCNearbyServiceAdvertiser,
    didReceiveInvitationFromPeer peerID: MCPeerID,
    withContext context: Data?,
    invitationHandler: @escaping (Bool, MCSession?) -> Void
  ) {
    owner?.handleIncomingInvitation(
      fromPeer: peerID, context: context, invitationHandler: invitationHandler
    )
  }

  func advertiser(
    _ advertiser: MCNearbyServiceAdvertiser,
    didNotStartAdvertisingPeer error: Error
  ) {
    owner?.handleAdvertiseError(error)
  }
}

private final class MCBrowserProxy: NSObject, MCNearbyServiceBrowserDelegate {
  weak var owner: HybridProximity?
  init(owner: HybridProximity) { self.owner = owner }

  func browser(
    _ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID,
    withDiscoveryInfo info: [String: String]?
  ) {
    owner?.handleFoundPeer(peerID, info: info)
  }

  func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
    owner?.handleLostPeer(peerID)
  }

  func browser(
    _ browser: MCNearbyServiceBrowser,
    didNotStartBrowsingForPeers error: Error
  ) {
    owner?.handleBrowseError(error)
  }
}

private final class NIProxy: NSObject, NISessionDelegate {
  weak var owner: HybridProximity?
  init(owner: HybridProximity) { self.owner = owner }

  func session(_ session: NISession, didUpdate nearbyObjects: [NINearbyObject]) {
    owner?.handleNIUpdate(session: session, objects: nearbyObjects)
  }

  func session(
    _ session: NISession, didRemove nearbyObjects: [NINearbyObject],
    reason: NINearbyObject.RemovalReason
  ) {
    owner?.handleNIRemoved(session: session, reason: reason)
  }

  func session(_ session: NISession, didInvalidateWith error: Error) {
    owner?.handleNIInvalidated(session: session, error: error)
  }
}

// MARK: - ArrayBuffer ergonomics

extension ArrayBuffer {
  /// Non-throwing wrapper around the built-in `ArrayBuffer.copy(data:)`.
  /// MC/NI delegate callbacks have no place to propagate errors, so we
  /// degrade to an empty buffer if the underlying copy would throw (in
  /// practice only when `Data.withUnsafeBytes` cannot resolve a base
  /// address, which is itself a "data is empty" signal).
  static func copyFromData(_ data: Data) -> ArrayBuffer {
    return (try? ArrayBuffer.copy(data: data)) ?? ArrayBuffer.allocate(size: 0)
  }
}
