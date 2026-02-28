//
//  ProximityManager+SessionDelegate.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import Foundation
import MultipeerConnectivity

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
          self.cancelRetry(for: peerID)  // Connection successful, cancel retry
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

      // Optional legacy behavior: auto-send current card when a connection is established
      if state == .connected, self.autoSendCardOnConnect, let card = self.currentCard {
        self.sendCard(card, to: peerID, sharingLevel: self.currentSharingLevel)
      }

      // If we have a pending join response for this peer, send it now
      if state == .connected, let pending = self.pendingGroupJoinResponse, pending.peerID == peerID {
        self.acceptGroupInvite(
          pending.invite,
          to: pending.peerID,
          memberName: pending.memberName,
          memberCommitment: pending.memberCommitment
        )
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
    if handleWebRTCSignaling(data, from: peerID) { return }
    if handleGroupInvitePayload(data, from: peerID) { return }
    if handleGroupJoinPayload(data) { return }
    if handleExchangeRequestPayload(data, from: peerID) { return }
    if handleExchangeAcceptPayload(data) { return }
    if isHeartbeatPayload(data) { return }
    handleProximityCardPayload(data, from: peerID)
  }

  private func handleGroupInvitePayload(_ data: Data, from peerID: MCPeerID) -> Bool {
    guard let invite = try? JSONDecoder().decode(GroupInvitePayload.self, from: data) else {
      return false
    }
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      let gm = SemaphoreGroupManager.shared
      gm.ensureGroupFromInvite(id: invite.groupId, name: invite.groupName, root: invite.groupRoot)
      self.pendingGroupInvite = (invite, peerID)
      NotificationCenter.default.post(
        name: .groupInviteReceived,
        object: nil,
        userInfo: [ProximityEventKey.invite: invite, ProximityEventKey.peerID: peerID]
      )
    }
    return true
  }

  private func handleGroupJoinPayload(_ data: Data) -> Bool {
    guard let join = try? JSONDecoder().decode(GroupJoinResponsePayload.self, from: data) else {
      return false
    }
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      let gm = SemaphoreGroupManager.shared
      if let idx = gm.allGroups.firstIndex(where: { $0.id == join.groupId }) {
        gm.selectGroup(gm.allGroups[idx].id)
        gm.addMember(join.memberCommitment)
      }
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
    return true
  }

  private func handleExchangeRequestPayload(_ data: Data, from peerID: MCPeerID) -> Bool {
    guard let exchangeRequest = try? JSONDecoder().decode(ExchangeRequestPayload.self, from: data) else {
      return false
    }
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.pendingExchangeRequest = PendingExchangeRequest(
        requestId: exchangeRequest.requestId,
        fromPeer: peerID,
        payload: exchangeRequest
      )
    }
    return true
  }

  private func handleExchangeAcceptPayload(_ data: Data) -> Bool {
    guard let exchangeAccept = try? JSONDecoder().decode(ExchangeAcceptPayload.self, from: data) else {
      return false
    }
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      let mySignature = self.sentExchangeSignatures.removeValue(forKey: exchangeAccept.requestId) ?? ""
      let myMessage = self.sentExchangeMessages.removeValue(forKey: exchangeAccept.requestId)

      let persistence = ExchangeEdgePersistencePayload(
        card: exchangeAccept.cardPreview,
        sourcePeerName: exchangeAccept.senderID,
        verificationStatus: .verified,
        sealedRoute: exchangeAccept.sealedRoute,
        pubKey: exchangeAccept.pubKey,
        signPubKey: exchangeAccept.signPubKey,
        mySignature: mySignature,
        theirSignature: exchangeAccept.exchangeSignature,
        myMessage: myMessage,
        theirMessage: exchangeAccept.theirEphemeralMessage,
        timestamp: exchangeAccept.timestamp
      )
      self.persistExchangeEdge(persistence)

      self.latestExchangeCompletion = ExchangeCompletionEvent(
        peerName: exchangeAccept.senderID,
        card: exchangeAccept.cardPreview,
        requestId: exchangeAccept.requestId,
        mySignature: mySignature,
        theirSignature: exchangeAccept.exchangeSignature,
        myMessage: myMessage,
        theirMessage: exchangeAccept.theirEphemeralMessage
      )
    }
    return true
  }

  private func isHeartbeatPayload(_ data: Data) -> Bool {
    String(data: data, encoding: .utf8) == "HEARTBEAT"
  }

  private func handleProximityCardPayload(_ data: Data, from peerID: MCPeerID) {
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
        let err: CardError = .sharingError(
          "Failed to decode received data: \(error.localizedDescription). Raw: \(rawString.prefix(50))"
        )
        self?.lastError = err
        NotificationCenter.default.post(
          name: .matchingError,
          object: nil,
          userInfo: [ProximityEventKey.error: err]
        )
      }
    }
  }

  func session(
    _ session: MCSession,
    didReceive stream: InputStream,
    withName streamName: String,
    fromPeer peerID: MCPeerID
  ) {
    // Not used for business card sharing
  }

  // MARK: - WebRTC Integration

  internal func setupWebRTC() {
    webRTCManager.onSendSignalingMessage = { [weak self] message in
      guard let self = self else { return }
      self.sendWebRTCSignaling(message)
    }
  }

  internal func sendWebRTCSignaling(_ message: SignalingMessage) {
    guard !session.connectedPeers.isEmpty else { return }
    do {
      let data = try JSONEncoder().encode(message)
      // Broadcast to all connected peers for now (usually just one in this context)
      try session.send(data, toPeers: session.connectedPeers, with: .reliable)
    } catch {
      print("Failed to send WebRTC signaling: \(error)")
    }
  }

  internal func handleWebRTCSignaling(_ data: Data, from peerID: MCPeerID) -> Bool {
    if let message = try? JSONDecoder().decode(SignalingMessage.self, from: data) {
      webRTCManager.handleSignalingMessage(message, from: peerID)
      return true
    }
    return false
  }

  internal func handleNewConnection(_ peerID: MCPeerID) {
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

  func session(
    _ session: MCSession,
    didStartReceivingResourceWithName resourceName: String,
    fromPeer peerID: MCPeerID,
    with progress: Progress
  ) {
    // Not used for business card sharing
  }

  func session(
    _ session: MCSession,
    didFinishReceivingResourceWithName resourceName: String,
    fromPeer peerID: MCPeerID,
    at localURL: URL?,
    withError error: Error?
  ) {
    // Not used for business card sharing
  }
}
