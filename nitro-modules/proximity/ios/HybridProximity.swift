//
//  HybridProximity.swift
//  @solidarity/nitro-proximity (iOS)
//
//  Wraps MultipeerConnectivity (peer discovery + transport) + NearbyInteraction
//  (UWB ranging) behind the Nitrogen-generated `HybridProximitySpec` protocol.
//  Events use the flattened `ProximityEvent` struct (one shape + `.kind` enum).
//
//  Stubbed today — see Swift ProximityManager.swift (legacy app) for the
//  full MC delegate state machine to port.
//
import Foundation
import MultipeerConnectivity
import NearbyInteraction
import NitroModules

final class HybridProximity: HybridProximitySpec {

  private var peerID: MCPeerID?
  private var session: MCSession?
  private var advertiser: MCNearbyServiceAdvertiser?
  private var browser: MCNearbyServiceBrowser?
  private var niSessions: [String: NISession] = [:]

  private var listeners: [UUID: (ProximityEvent) -> Void] = [:]
  private let lock = NSLock()

  func startAdvertising(displayName: String, serviceType: String, discoveryInfoJson: String) throws {
    let peer = MCPeerID(displayName: displayName)
    let info = Self.parseInfo(discoveryInfoJson)
    let sess = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .required)
    let adv = MCNearbyServiceAdvertiser(peer: peer, discoveryInfo: info, serviceType: serviceType)
    adv.startAdvertisingPeer()
    self.peerID = peer
    self.session = sess
    self.advertiser = adv
  }

  func stopAdvertising() {
    advertiser?.stopAdvertisingPeer()
    advertiser = nil
  }

  func startBrowsing(serviceType: String) {
    guard let peer = peerID else { return }
    let br = MCNearbyServiceBrowser(peer: peer, serviceType: serviceType)
    br.startBrowsingForPeers()
    self.browser = br
  }

  func stopBrowsing() {
    browser?.stopBrowsingForPeers()
    browser = nil
  }

  func invitePeer(peerId: String, payload: ArrayBuffer, timeoutSec: Double) throws -> Promise<Bool> {
    return Promise.async { false }
  }
  func acceptInvitation(peerId: String) {}
  func rejectInvitation(peerId: String) {}
  func sendData(peerId: String, data: ArrayBuffer) throws -> Promise<Void> {
    return Promise.async { () }
  }
  func disconnect(peerId: String) {}

  func startRanging(peerId: String) throws -> Promise<Void> {
    return Promise.async { [weak self] in
      self?.niSessions[peerId] = NISession()
      ()
    }
  }
  func stopRanging(peerId: String) {
    niSessions.removeValue(forKey: peerId)?.invalidate()
  }

  func addEventListener(handler: @escaping (ProximityEvent) -> Void) -> () -> Void {
    let id = UUID()
    lock.lock(); listeners[id] = handler; lock.unlock()
    return { [weak self] in
      self?.lock.lock()
      self?.listeners.removeValue(forKey: id)
      self?.lock.unlock()
    }
  }

  private static func parseInfo(_ json: String) -> [String: String] {
    guard let data = json.data(using: .utf8),
          let raw = try? JSONSerialization.jsonObject(with: data),
          let map = raw as? [String: String] else { return [:] }
    return map
  }
}
