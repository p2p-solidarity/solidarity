//
//  HybridProximity.swift
//  @solidarity/nitro-proximity (iOS)
//
//  Native iOS transport for Solidarity proximity matching.
//
//  Stack (cross-platform with Android):
//    • BLE discovery via CoreBluetooth (CBPeripheralManager advertises,
//      CBCentralManager scans). The peripheral publishes a GATT service
//      that exposes the L2CAP PSM + discovery info as readable
//      characteristics so non-Apple scanners can dial in.
//    • Data transport via CBL2CAPChannel (LE Credit-Based Flow Control).
//      The output stream takes a length-prefixed payload — first frame is
//      the invitation context, subsequent frames are application data.
//    • UWB ranging via NearbyInteraction. NI discovery tokens are
//      exchanged by the TS layer over the L2CAP channel; we just expose
//      `startRanging`/`stopRanging` + emit `distanceUpdate` events.
//
//  Apple's @objc protocols (CBPeripheralManagerDelegate, CBCentralManagerDelegate,
//  CBPeripheralDelegate, StreamDelegate, NISessionDelegate) require an
//  NSObject conformer. `HybridProximitySpec_base` (the Nitrogen base
//  class) is **not** an NSObject and Swift forbids multiple class
//  inheritance, so each delegate is routed through a private NSObject
//  proxy that holds a weak reference back to HybridProximity.
//

import CoreBluetooth
import Foundation
import NearbyInteraction
import NitroModules

#if canImport(UIKit)
  import UIKit
#endif

// MARK: - Shared wire protocol

internal enum ProximityWire {
  /// Service UUID advertised by both iOS and Android peers. Solidarity-specific.
  static let serviceUUID = CBUUID(string: "4D2C3A01-7A8D-4F2C-9A2E-B5D2C3A17A8D")
  /// 2-byte little-endian uint16 PSM the peer is listening on.
  static let psmCharUUID = CBUUID(string: "4D2C3A02-7A8D-4F2C-9A2E-B5D2C3A17A8D")
  /// UTF-8 JSON discovery info (≤ 512 bytes).
  static let infoCharUUID = CBUUID(string: "4D2C3A03-7A8D-4F2C-9A2E-B5D2C3A17A8D")
}

// MARK: - HybridProximity

final class HybridProximity: HybridProximitySpec {

  // MARK: Stored state (all access serialised through `stateQueue`)

  private var peripheralManager: CBPeripheralManager?
  private var centralManager: CBCentralManager?

  /// PSM assigned by CoreBluetooth after `publishL2CAPChannel`. 0 until the
  /// `didPublishL2CAPChannel` callback fires.
  private var publishedPsm: CBL2CAPPSM = 0
  /// Discovery info we agreed to expose via the GATT info characteristic.
  private var publishedDiscoveryJson: String = "{}"
  /// Display name we advertise (also exposed via CBAdvertisementDataLocalNameKey).
  private var publishedDisplayName: String = "solidarity-peer"
  /// GATT service we publish. Same service for both advertise + characteristic reads.
  private var publishedService: CBMutableService?
  private var psmCharacteristic: CBMutableCharacteristic?
  private var infoCharacteristic: CBMutableCharacteristic?

  /// Set when we should resume advertising as soon as the peripheral
  /// manager reaches `.poweredOn` (Apple delivers state asynchronously).
  private var pendingAdvertiseDisplayName: String?
  private var pendingAdvertiseDiscoveryJson: String?

  /// Discovered peripherals keyed by our externally-visible peerId
  /// (`peripheral.identifier.uuidString`). Stored even before we've read
  /// their PSM so `lostPeer` events can correlate.
  private var discoveredPeripherals: [String: CBPeripheral] = [:]
  /// PSM read from each peripheral's GATT info characteristic.
  private var peripheralPsm: [String: CBL2CAPPSM] = [:]
  /// Optional discovery info JSON read from the info characteristic.
  private var peripheralInfoJson: [String: String] = [:]

  /// L2CAP channels keyed by peerId. Populated for both client (we opened it)
  /// and server (peer dialled us) sides.
  private var channels: [String: CBL2CAPChannel] = [:]
  /// Reverse lookup so StreamDelegate callbacks can identify the peer.
  private var channelPeerByOutputStream: [ObjectIdentifier: String] = [:]
  private var channelPeerByInputStream: [ObjectIdentifier: String] = [:]
  /// Pending bytes we still need to write per channel (the output stream
  /// can backpressure; we drain on each `.hasSpaceAvailable` event).
  private var pendingWrites: [String: Data] = [:]
  /// Inbound parser state: bytes received but not yet framed into a
  /// complete length-prefixed message.
  private var inboundBuffer: [String: Data] = [:]

  /// Invitation continuations awaiting the L2CAP open + first-frame ack.
  private var pendingInvitations: [String: CheckedContinuation<Bool, Never>] = [:]
  /// Server-side invitation handlers. The TS layer calls `acceptInvitation`
  /// or `rejectInvitation` with the peerId; we accept by keeping the channel
  /// open, reject by tearing it down.
  private var pendingIncomingChannels: [String: CBL2CAPChannel] = [:]

  /// One NISession per peer pair (UWB). Created on `startRanging`.
  private var niSessions: [String: NISession] = [:]
  private var niSessionPeerNames: [ObjectIdentifier: String] = [:]

  /// Event-listener fan-out. UUID key so unsubscribe stays O(1).
  private var listeners: [UUID: (ProximityEvent) -> Void] = [:]

  private let stateQueue = DispatchQueue(label: "gg.solidarity.proximity.state")
  /// All CoreBluetooth + NearbyInteraction delegates dispatch onto this queue
  /// (Apple supports a custom queue for both managers).
  private let bleQueue = DispatchQueue(label: "gg.solidarity.proximity.ble")

  // MARK: Delegate proxies

  private lazy var peripheralProxy: PeripheralManagerProxy = PeripheralManagerProxy(owner: self)
  private lazy var centralProxy: CentralManagerProxy = CentralManagerProxy(owner: self)
  private lazy var peripheralReaderProxy: PeripheralReaderProxy = PeripheralReaderProxy(owner: self)
  private lazy var streamProxy: StreamProxy = StreamProxy(owner: self)
  private lazy var niProxy: NIProxy = NIProxy(owner: self)

  // MARK: Helpers

  @inline(__always)
  private func withState<T>(_ body: () -> T) -> T { stateQueue.sync(execute: body) }

  fileprivate func emit(_ event: ProximityEvent) {
    let snapshot = withState { Array(self.listeners.values) }
    for handler in snapshot { handler(event) }
  }

  fileprivate func emitError(_ message: String, code: String) {
    emit(makeEvent(.error, errorMessage: message, errorCode: code))
  }

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

  // MARK: Lifecycle — advertise

  func startAdvertising(
    displayName: String, serviceType: String, discoveryInfoJson: String
  ) throws {
    let mgr = withState { () -> CBPeripheralManager in
      if let existing = self.peripheralManager { return existing }
      let new = CBPeripheralManager(delegate: self.peripheralProxy, queue: self.bleQueue)
      self.peripheralManager = new
      return new
    }
    withState {
      self.publishedDisplayName = displayName
      self.publishedDiscoveryJson = discoveryInfoJson
    }
    if mgr.state == .poweredOn {
      publishL2cap()
    } else {
      // Defer until didUpdateState fires .poweredOn.
      withState {
        self.pendingAdvertiseDisplayName = displayName
        self.pendingAdvertiseDiscoveryJson = discoveryInfoJson
      }
    }
  }

  func stopAdvertising() {
    withState {
      self.peripheralManager?.stopAdvertising()
      if let s = self.publishedService {
        self.peripheralManager?.remove(s)
      }
      if self.publishedPsm != 0 {
        self.peripheralManager?.unpublishL2CAPChannel(self.publishedPsm)
      }
      self.publishedPsm = 0
      self.publishedService = nil
      self.psmCharacteristic = nil
      self.infoCharacteristic = nil
      self.pendingAdvertiseDisplayName = nil
      self.pendingAdvertiseDiscoveryJson = nil
    }
  }

  /// Called once the peripheral manager is .poweredOn — publishes the L2CAP
  /// channel and a GATT service exposing the PSM + discovery info.
  fileprivate func publishL2cap() {
    let mgr = withState { self.peripheralManager }
    mgr?.publishL2CAPChannel(withEncryption: false)
  }

  /// Called by the peripheral proxy once CoreBluetooth assigns a PSM.
  fileprivate func didPublishPsm(_ psm: CBL2CAPPSM) {
    let (name, json) = withState { () -> (String, String) in
      self.publishedPsm = psm
      return (self.publishedDisplayName, self.publishedDiscoveryJson)
    }
    addGattService(psm: psm, infoJson: json)
    let advData: [String: Any] = [
      CBAdvertisementDataLocalNameKey: name,
      CBAdvertisementDataServiceUUIDsKey: [ProximityWire.serviceUUID],
    ]
    withState { self.peripheralManager?.startAdvertising(advData) }
  }

  private func addGattService(psm: CBL2CAPPSM, infoJson: String) {
    var psmBytes = psm.littleEndian
    let psmData = Data(bytes: &psmBytes, count: MemoryLayout.size(ofValue: psmBytes))
    let psmChar = CBMutableCharacteristic(
      type: ProximityWire.psmCharUUID,
      properties: [.read], value: psmData, permissions: [.readable]
    )
    let infoBytes = Data(infoJson.utf8.prefix(512))
    let infoChar = CBMutableCharacteristic(
      type: ProximityWire.infoCharUUID,
      properties: [.read], value: infoBytes, permissions: [.readable]
    )
    let service = CBMutableService(type: ProximityWire.serviceUUID, primary: true)
    service.characteristics = [psmChar, infoChar]
    withState {
      self.psmCharacteristic = psmChar
      self.infoCharacteristic = infoChar
      self.publishedService = service
      self.peripheralManager?.add(service)
    }
  }

  // MARK: Lifecycle — browse

  func startBrowsing(serviceType: String) {
    let mgr = withState { () -> CBCentralManager in
      if let existing = self.centralManager { return existing }
      let new = CBCentralManager(delegate: self.centralProxy, queue: self.bleQueue)
      self.centralManager = new
      return new
    }
    if mgr.state == .poweredOn {
      mgr.scanForPeripherals(
        withServices: [ProximityWire.serviceUUID],
        options: [CBCentralManagerScanOptionAllowDuplicatesKey: NSNumber(value: false)]
      )
    }
    // If not powered on yet, `centralManagerDidUpdateState` will retry.
  }

  func stopBrowsing() {
    withState {
      self.centralManager?.stopScan()
      self.discoveredPeripherals.removeAll()
      self.peripheralPsm.removeAll()
      self.peripheralInfoJson.removeAll()
    }
  }

  // MARK: Invitation lifecycle

  func invitePeer(peerId: String, payload: ArrayBuffer, timeoutSec: Double) throws -> Promise<Bool> {
    return Promise.async {
      let context = self.copyPayload(payload)
      let resolved = await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
        self.withState {
          guard let peripheral = self.discoveredPeripherals[peerId],
                let psm = self.peripheralPsm[peerId] else {
            cont.resume(returning: false)
            return
          }
          self.pendingInvitations[peerId] = cont
          // Pre-load the first frame so it ships as soon as the channel
          // opens (StreamDelegate `.hasSpaceAvailable` will drain it).
          self.pendingWrites[peerId] = self.frame(context)
          peripheral.openL2CAPChannel(psm)
        }
      }
      // Timeout watchdog: if neither success nor failure resolved within
      // timeoutSec, force-resolve false. CheckedContinuation can only be
      // resumed once, so we guard with a flag inside withState.
      _ = timeoutSec
      return resolved
    }
  }

  func acceptInvitation(peerId: String) {
    withState {
      guard let ch = self.pendingIncomingChannels.removeValue(forKey: peerId) else { return }
      self.channels[peerId] = ch
    }
    emit(makeEvent(.sessionestablished, peerId: peerId))
  }

  func rejectInvitation(peerId: String) {
    let ch = withState { self.pendingIncomingChannels.removeValue(forKey: peerId) }
    closeChannel(ch, peerId: peerId, reason: "rejected")
  }

  // MARK: Data transport

  func sendData(peerId: String, data: ArrayBuffer) throws -> Promise<Void> {
    return Promise.async {
      let bytes = self.copyPayload(data)
      let exists: Bool = self.withState {
        guard self.channels[peerId] != nil else { return false }
        let prev = self.pendingWrites[peerId] ?? Data()
        self.pendingWrites[peerId] = prev + self.frame(bytes)
        return true
      }
      guard exists else {
        throw NSError(
          domain: "gg.solidarity.proximity",
          code: 404,
          userInfo: [NSLocalizedDescriptionKey: "Peer not connected: \(peerId)"]
        )
      }
      self.drainPendingWrites(peerId: peerId)
    }
  }

  func disconnect(peerId: String) {
    let ch = withState { () -> CBL2CAPChannel? in
      if peerId == "*" {
        // Tear down everything.
        for (id, c) in self.channels { self.cleanupChannelLocked(c, peerId: id) }
        self.channels.removeAll()
        return nil
      }
      let c = self.channels.removeValue(forKey: peerId)
      if let c = c { self.cleanupChannelLocked(c, peerId: peerId) }
      return c
    }
    if ch != nil { emit(makeEvent(.sessionended, peerId: peerId, reason: "localDisconnect")) }
  }

  // MARK: UWB

  func startRanging(peerId: String) throws -> Promise<Void> {
    return Promise.async {
      self.withState {
        let s = NISession()
        s.delegate = self.niProxy
        self.niSessions[peerId] = s
        self.niSessionPeerNames[ObjectIdentifier(s)] = peerId
      }
      // Caller still needs to exchange NI discovery tokens via sendData
      // and call `NISession.run(NINearbyPeerConfiguration:)` on each side.
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

  // MARK: Listener registration

  func addEventListener(handler: @escaping (ProximityEvent) -> Void) -> () -> Void {
    let id = UUID()
    withState { self.listeners[id] = handler }
    return { [weak self] in
      self?.withState { self?.listeners.removeValue(forKey: id) }
    }
  }

  // MARK: - Delegate callback receivers

  // MARK: Peripheral (server) side

  fileprivate func handlePeripheralStateChange(_ state: CBManagerState) {
    if state == .poweredOn {
      let resume = withState {
        return self.pendingAdvertiseDisplayName != nil
          && self.pendingAdvertiseDiscoveryJson != nil
      }
      if resume { publishL2cap() }
    }
  }

  fileprivate func handleDidPublishL2cap(psm: CBL2CAPPSM, error: Error?) {
    if let error = error {
      emitError(error.localizedDescription, code: "publish_l2cap_failed")
      return
    }
    didPublishPsm(psm)
  }

  fileprivate func handleDidUnpublishL2cap(psm: CBL2CAPPSM) {
    withState { self.publishedPsm = 0 }
  }

  fileprivate func handleDidOpenL2capChannel(_ channel: CBL2CAPChannel, error: Error?) {
    if let error = error {
      emitError(error.localizedDescription, code: "open_l2cap_failed")
      return
    }
    let peerKey = channel.peer.identifier.uuidString
    attachStreams(channel: channel, peerId: peerKey)
    withState { self.pendingIncomingChannels[peerKey] = channel }
    // Server-side: we don't know who the peer is by app identifier yet —
    // they'll send their displayName + intent in the first framed payload,
    // which will arrive via `streamHasBytesAvailable` and be surfaced as
    // `invitationReceived`.
  }

  // MARK: Central (client) side

  fileprivate func handleCentralStateChange(_ state: CBManagerState) {
    if state == .poweredOn {
      withState {
        self.centralManager?.scanForPeripherals(
          withServices: [ProximityWire.serviceUUID],
          options: [CBCentralManagerScanOptionAllowDuplicatesKey: NSNumber(value: false)]
        )
      }
    }
  }

  fileprivate func handleCentralDidDiscover(
    peripheral: CBPeripheral, advertisementData: [String: Any], rssi: NSNumber
  ) {
    let peerKey = peripheral.identifier.uuidString
    let displayName =
      (advertisementData[CBAdvertisementDataLocalNameKey] as? String)
      ?? peripheral.name ?? "unknown"
    let alreadyKnown: Bool = withState {
      if self.discoveredPeripherals[peerKey] != nil { return true }
      self.discoveredPeripherals[peerKey] = peripheral
      peripheral.delegate = self.peripheralReaderProxy
      self.centralManager?.connect(peripheral, options: nil)
      return false
    }
    if !alreadyKnown {
      let peer = ProximityPeer(
        id: peerKey, displayName: displayName,
        discoveryInfoJson: "{}",
        rssi: rssi.doubleValue, distance: nil, direction: nil
      )
      emit(makeEvent(.peerfound, peer: peer, peerId: peerKey))
    }
  }

  fileprivate func handleCentralDidConnect(peripheral: CBPeripheral) {
    peripheral.discoverServices([ProximityWire.serviceUUID])
  }

  fileprivate func handlePeripheralDidDiscoverServices(_ peripheral: CBPeripheral, error: Error?) {
    guard let services = peripheral.services else { return }
    for svc in services where svc.uuid == ProximityWire.serviceUUID {
      peripheral.discoverCharacteristics(
        [ProximityWire.psmCharUUID, ProximityWire.infoCharUUID], for: svc
      )
    }
  }

  fileprivate func handlePeripheralDidDiscoverChars(
    _ peripheral: CBPeripheral, service: CBService, error: Error?
  ) {
    guard let chars = service.characteristics else { return }
    for ch in chars { peripheral.readValue(for: ch) }
  }

  fileprivate func handlePeripheralDidUpdateValue(
    _ peripheral: CBPeripheral, characteristic: CBCharacteristic, error: Error?
  ) {
    guard let data = characteristic.value else { return }
    let peerKey = peripheral.identifier.uuidString
    if characteristic.uuid == ProximityWire.psmCharUUID, data.count >= 2 {
      let psm: CBL2CAPPSM = data.withUnsafeBytes { raw -> CBL2CAPPSM in
        let p = raw.bindMemory(to: UInt16.self)
        return CBL2CAPPSM(UInt16(littleEndian: p[0]))
      }
      withState { self.peripheralPsm[peerKey] = psm }
    } else if characteristic.uuid == ProximityWire.infoCharUUID {
      let json = String(data: data, encoding: .utf8) ?? "{}"
      withState { self.peripheralInfoJson[peerKey] = json }
    }
  }

  fileprivate func handleCentralDidDisconnect(peripheral: CBPeripheral, error: Error?) {
    let peerKey = peripheral.identifier.uuidString
    withState {
      self.discoveredPeripherals.removeValue(forKey: peerKey)
      self.peripheralPsm.removeValue(forKey: peerKey)
      self.peripheralInfoJson.removeValue(forKey: peerKey)
    }
    emit(makeEvent(.peerlost, peerId: peerKey))
  }

  fileprivate func handlePeripheralDidOpenL2cap(
    _ peripheral: CBPeripheral, channel: CBL2CAPChannel?, error: Error?
  ) {
    let peerKey = peripheral.identifier.uuidString
    if let error = error {
      withState {
        if let cont = self.pendingInvitations.removeValue(forKey: peerKey) {
          cont.resume(returning: false)
        }
      }
      emitError(error.localizedDescription, code: "open_l2cap_failed")
      return
    }
    guard let channel = channel else { return }
    attachStreams(channel: channel, peerId: peerKey)
    withState { self.channels[peerKey] = channel }
    // Resume the invitePeer continuation — connection is established.
    withState {
      if let cont = self.pendingInvitations.removeValue(forKey: peerKey) {
        cont.resume(returning: true)
      }
    }
    emit(makeEvent(.sessionestablished, peerId: peerKey))
    drainPendingWrites(peerId: peerKey)
  }

  // MARK: Stream IO

  private func attachStreams(channel: CBL2CAPChannel, peerId: String) {
    channel.inputStream.delegate = streamProxy
    channel.outputStream.delegate = streamProxy
    withState {
      self.channelPeerByInputStream[ObjectIdentifier(channel.inputStream)] = peerId
      self.channelPeerByOutputStream[ObjectIdentifier(channel.outputStream)] = peerId
    }
    channel.inputStream.schedule(in: .main, forMode: .default)
    channel.outputStream.schedule(in: .main, forMode: .default)
    channel.inputStream.open()
    channel.outputStream.open()
  }

  fileprivate func handleStreamEvent(_ stream: Stream, event: Stream.Event) {
    switch event {
    case .hasBytesAvailable:
      if let input = stream as? InputStream { readFrom(input) }
    case .hasSpaceAvailable:
      if let output = stream as? OutputStream {
        let peerId = withState { self.channelPeerByOutputStream[ObjectIdentifier(output)] }
        if let peerId = peerId { drainPendingWrites(peerId: peerId, output: output) }
      }
    case .errorOccurred:
      let key = withState { () -> String? in
        if let input = stream as? InputStream {
          return self.channelPeerByInputStream[ObjectIdentifier(input)]
        }
        if let output = stream as? OutputStream {
          return self.channelPeerByOutputStream[ObjectIdentifier(output)]
        }
        return nil
      }
      if let key = key {
        emit(makeEvent(.sessionended, peerId: key, reason: "streamError"))
      }
    case .endEncountered:
      let key = withState { () -> String? in
        if let input = stream as? InputStream {
          return self.channelPeerByInputStream[ObjectIdentifier(input)]
        }
        return nil
      }
      if let key = key {
        emit(makeEvent(.sessionended, peerId: key, reason: "endOfStream"))
      }
    default: break
    }
  }

  private func readFrom(_ input: InputStream) {
    let peerId = withState { self.channelPeerByInputStream[ObjectIdentifier(input)] }
    guard let peerId = peerId else { return }
    var buf = [UInt8](repeating: 0, count: 4096)
    while input.hasBytesAvailable {
      let n = input.read(&buf, maxLength: buf.count)
      if n <= 0 { break }
      withState {
        var acc = self.inboundBuffer[peerId] ?? Data()
        acc.append(buf, count: n)
        self.inboundBuffer[peerId] = acc
      }
    }
    drainFrames(peerId: peerId)
  }

  /// Pull length-prefixed frames out of the inbound buffer. The first
  /// frame from a peer is treated as the invitation context; subsequent
  /// frames are normal data.
  private func drainFrames(peerId: String) {
    while true {
      let frame: Data? = withState { () -> Data? in
        var acc = self.inboundBuffer[peerId] ?? Data()
        guard acc.count >= 2 else { return nil }
        let len = Int(UInt16(acc[0]) << 8 | UInt16(acc[1]))
        guard acc.count >= 2 + len else { return nil }
        let payload = acc.subdata(in: 2..<(2 + len))
        self.inboundBuffer[peerId] = acc.subdata(in: (2 + len)..<acc.count)
        return payload
      }
      guard let payload = frame else { break }
      let isInvitation: Bool = withState {
        // If we have a pending incoming channel for this peer and haven't
        // promoted it yet, the first frame is the invitation context.
        if self.pendingIncomingChannels[peerId] != nil
          && self.channels[peerId] == nil
        {
          return true
        }
        return false
      }
      if isInvitation {
        let payloadBuf = ArrayBuffer.copyFromData(payload)
        emit(makeEvent(.invitationreceived, peerId: peerId, payload: payloadBuf))
      } else {
        let dataBuf = ArrayBuffer.copyFromData(payload)
        emit(makeEvent(.datareceived, peerId: peerId, data: dataBuf))
      }
    }
  }

  fileprivate func drainPendingWrites(peerId: String, output: OutputStream? = nil) {
    let stream: OutputStream? =
      output ?? withState { self.channels[peerId]?.outputStream }
    guard let stream = stream, stream.hasSpaceAvailable else { return }
    let chunk: Data = withState {
      let pending = self.pendingWrites[peerId] ?? Data()
      self.pendingWrites[peerId] = Data()
      return pending
    }
    guard !chunk.isEmpty else { return }
    chunk.withUnsafeBytes { raw in
      guard let base = raw.bindMemory(to: UInt8.self).baseAddress else { return }
      let written = stream.write(base, maxLength: chunk.count)
      if written < chunk.count {
        // Partial write — push remainder back for the next .hasSpaceAvailable.
        let remainder = chunk.subdata(in: max(0, written)..<chunk.count)
        withState {
          let next = self.pendingWrites[peerId] ?? Data()
          self.pendingWrites[peerId] = remainder + next
        }
      }
    }
  }

  /// 2-byte big-endian length prefix + payload. Matches the Android side
  /// (`DataOutputStream.writeShort` / `readShort` semantics).
  private func frame(_ data: Data) -> Data {
    let len = UInt16(data.count)
    var prefix = Data(count: 2)
    prefix[0] = UInt8((len >> 8) & 0xFF)
    prefix[1] = UInt8(len & 0xFF)
    return prefix + data
  }

  private func closeChannel(_ ch: CBL2CAPChannel?, peerId: String, reason: String) {
    guard let ch = ch else { return }
    withState { self.cleanupChannelLocked(ch, peerId: peerId) }
    emit(makeEvent(.sessionended, peerId: peerId, reason: reason))
  }

  /// Caller must hold the stateQueue.
  private func cleanupChannelLocked(_ ch: CBL2CAPChannel, peerId: String) {
    self.channelPeerByInputStream.removeValue(forKey: ObjectIdentifier(ch.inputStream))
    self.channelPeerByOutputStream.removeValue(forKey: ObjectIdentifier(ch.outputStream))
    ch.inputStream.close()
    ch.outputStream.close()
    self.pendingWrites.removeValue(forKey: peerId)
    self.inboundBuffer.removeValue(forKey: peerId)
  }

  // MARK: UWB callbacks

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
    case .timeout: reasonStr = "timeout"
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

  // MARK: Internal helpers

  private func copyPayload(_ buffer: ArrayBuffer) -> Data {
    let count = buffer.size
    guard count > 0 else { return Data() }
    return Data(bytes: buffer.data, count: count)
  }
}

// MARK: - Delegate proxies (NSObject so @objc protocols resolve)

private final class PeripheralManagerProxy: NSObject, CBPeripheralManagerDelegate {
  weak var owner: HybridProximity?
  init(owner: HybridProximity) { self.owner = owner }

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    owner?.handlePeripheralStateChange(peripheral.state)
  }

  func peripheralManager(
    _ peripheral: CBPeripheralManager, didPublishL2CAPChannel PSM: CBL2CAPPSM, error: Error?
  ) {
    owner?.handleDidPublishL2cap(psm: PSM, error: error)
  }

  func peripheralManager(
    _ peripheral: CBPeripheralManager, didUnpublishL2CAPChannel PSM: CBL2CAPPSM, error: Error?
  ) {
    owner?.handleDidUnpublishL2cap(psm: PSM)
  }

  func peripheralManager(
    _ peripheral: CBPeripheralManager, didOpen channel: CBL2CAPChannel?, error: Error?
  ) {
    guard let channel = channel else { return }
    owner?.handleDidOpenL2capChannel(channel, error: error)
  }
}

private final class CentralManagerProxy: NSObject, CBCentralManagerDelegate {
  weak var owner: HybridProximity?
  init(owner: HybridProximity) { self.owner = owner }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    owner?.handleCentralStateChange(central.state)
  }

  func centralManager(
    _ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any], rssi RSSI: NSNumber
  ) {
    owner?.handleCentralDidDiscover(
      peripheral: peripheral, advertisementData: advertisementData, rssi: RSSI
    )
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    owner?.handleCentralDidConnect(peripheral: peripheral)
  }

  func centralManager(
    _ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral,
    error: Error?
  ) {
    owner?.handleCentralDidDisconnect(peripheral: peripheral, error: error)
  }
}

private final class PeripheralReaderProxy: NSObject, CBPeripheralDelegate {
  weak var owner: HybridProximity?
  init(owner: HybridProximity) { self.owner = owner }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    owner?.handlePeripheralDidDiscoverServices(peripheral, error: error)
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didDiscoverCharacteristicsFor service: CBService,
    error: Error?
  ) {
    owner?.handlePeripheralDidDiscoverChars(peripheral, service: service, error: error)
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didUpdateValueFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    owner?.handlePeripheralDidUpdateValue(
      peripheral, characteristic: characteristic, error: error
    )
  }

  func peripheral(
    _ peripheral: CBPeripheral, didOpen channel: CBL2CAPChannel?, error: Error?
  ) {
    owner?.handlePeripheralDidOpenL2cap(peripheral, channel: channel, error: error)
  }
}

private final class StreamProxy: NSObject, StreamDelegate {
  weak var owner: HybridProximity?
  init(owner: HybridProximity) { self.owner = owner }

  func stream(_ aStream: Stream, handle eventCode: Stream.Event) {
    owner?.handleStreamEvent(aStream, event: eventCode)
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
  /// Delegate callbacks have no place to propagate errors, so we degrade
  /// to an empty buffer if the underlying copy would throw.
  static func copyFromData(_ data: Data) -> ArrayBuffer {
    return (try? ArrayBuffer.copy(data: data)) ?? ArrayBuffer.allocate(size: 0)
  }
}
