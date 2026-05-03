//
//  ProximityManager+SessionDelegate.swift
//  solidarity
//
//  Created by Solidarity Team.
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

      // Kill any UWB session bound to this peer the moment MC drops it. Otherwise
      // ranging frames can keep arriving after `.notConnected` and push the state
      // machine to `.confirmed`, firing `onSpatialTrigger` for a peer that is no
      // longer in `session.connectedPeers` — the original source of the stale
      // "Peer is not connected" error toast.
      if state == .notConnected,
        NearbyInteractionManager.shared.connectedPeerID?.displayName == peerID.displayName {
        NearbyInteractionManager.shared.invalidateSession()
      }

      // Optional legacy behavior: auto-send current card when a connection is established
      if state == .connected, self.autoSendCardOnConnect, let card = self.currentCard {
        self.sendCard(card, to: peerID)
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

      // Trigger WebRTC setup + UWB session
      if state == .connected {
        self.handleNewConnection(peerID)
        NearbyInteractionManager.shared.startSession(with: peerID, via: self)
      }
    }
  }

  func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
    // UWB: intercept NI discovery token (must be checked before other payload decoders)
    if handleNIDiscoveryToken(data, from: peerID) { return }
    if handleWebRTCSignaling(data, from: peerID) { return }
    if handleGroupInvitePayload(data, from: peerID) { return }
    if handleGroupJoinPayload(data) { return }
    if handleExchangeRequestPayload(data, from: peerID) { return }
    if handleExchangeAcceptPayload(data) { return }
    if isHeartbeatPayload(data) { return }
    handleProximityCardPayload(data, from: peerID)
  }

  private func handleNIDiscoveryToken(_ data: Data, from peerID: MCPeerID) -> Bool {
    guard let token = NearbyInteractionManager.decodeDiscoveryToken(from: data) else {
      return false
    }
    print("[NI] Received discovery token from \(peerID.displayName)")
    NearbyInteractionManager.shared.activateRanging(with: token)
    return true
  }

  private func handleGroupInvitePayload(_ data: Data, from peerID: MCPeerID) -> Bool {
    guard let invite = try? JSONDecoder().decode(GroupInvitePayload.self, from: data) else {
      return false
    }
    guard GroupInviteSigner.isFresh(invite.timestamp, maxAge: GroupInvitePayload.maxAge) else {
      print("[ProximityManager] Rejecting stale group invite from \(peerID.displayName)")
      return true
    }
    let signatureValid = GroupInviteSigner.verify(
      signature: invite.inviterSignature,
      canonicalBytes: invite.canonicalBytes(),
      publicKey: invite.inviterPublicKey
    )
    guard signatureValid else {
      print("[ProximityManager] Rejecting group invite with invalid signature from \(peerID.displayName)")
      return true
    }
    // Bind the embedded `inviterPublicKey` to a previously-trusted contact.
    // The crypto check above only proves "whoever holds this key signed it"
    // — it tells us nothing about identity unless the key was already
    // stored from a prior proximity card exchange. Without this lookup
    // any peer could generate a fresh keypair, embed it, sign with it,
    // and pass verification. We require an out-of-band trust anchor.
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      guard GroupInviteSigner.knownContact(matchingPublicKey: invite.inviterPublicKey) != nil else {
        print("[ProximityManager] Rejecting group invite from \(peerID.displayName) — inviter key not bound to any known contact (exchange cards first)")
        return
      }
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
    guard GroupInviteSigner.isFresh(join.timestamp, maxAge: GroupJoinResponsePayload.maxAge) else {
      print("[ProximityManager] Rejecting stale group join response")
      return true
    }
    // Reject unsigned join payloads — safer default while older clients are still in the field.
    guard let signature = join.memberSignature, let publicKey = join.memberPublicKey else {
      print("[ProximityManager] Rejecting unsigned group join response")
      return true
    }
    let signatureValid = GroupInviteSigner.verify(
      signature: signature,
      canonicalBytes: join.canonicalBytes(),
      publicKey: publicKey
    )
    guard signatureValid else {
      print("[ProximityManager] Rejecting group join response with invalid signature")
      return true
    }
    // Same trust binding as `handleGroupInvitePayload`: the signature must
    // be from a key that previously survived a proximity card exchange.
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      guard GroupInviteSigner.knownContact(matchingPublicKey: publicKey) != nil else {
        print("[ProximityManager] Rejecting group join response — member key not bound to any known contact")
        return
      }
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
    // Reject pre-v2 exchange requests at the boundary so the user is never asked to
    // accept an unauthenticated card that we cannot verify against a DID.
    guard let version = exchangeRequest.protocolVersion,
      version >= ProximityIdentitySigner.currentProtocolVersion else {
      print("[ProximityManager] Rejecting legacy exchange request from \(peerID.displayName); needs DID-bound v2")
      DispatchQueue.main.async { [weak self] in
        let err: CardError = .sharingError(
          "Peer is using an outdated exchange protocol; please ask them to update."
        )
        self?.lastError = err
        NotificationCenter.default.post(
          name: .matchingError,
          object: nil,
          userInfo: [ProximityEventKey.error: err]
        )
      }
      return true
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
    // Reject pre-v2 accepts: the legacy Curve25519 signature does not chain to the
    // sender's DID and is therefore not safe to mark `.verified` from.
    guard let version = exchangeAccept.protocolVersion,
      version >= ProximityIdentitySigner.currentProtocolVersion else {
      print("[ProximityManager] Rejecting legacy exchange accept; needs DID-bound v2")
      DispatchQueue.main.async { [weak self] in
        let err: CardError = .sharingError(
          "Peer is using an outdated exchange protocol; please ask them to update."
        )
        self?.lastError = err
        NotificationCenter.default.post(
          name: .matchingError,
          object: nil,
          userInfo: [ProximityEventKey.error: err]
        )
      }
      return true
    }
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      let mySignature = self.sentExchangeSignatures.removeValue(forKey: exchangeAccept.requestId) ?? ""
      let myMessage = self.sentExchangeMessages.removeValue(forKey: exchangeAccept.requestId)
      let isValidSignature = ProximityManager.verifyDIDExchangeSignature(
        protocolVersion: exchangeAccept.protocolVersion,
        direction: .accept,
        requestId: exchangeAccept.requestId,
        senderDID: exchangeAccept.senderDID,
        receiverPeerName: self.localPeerID.displayName,
        senderID: exchangeAccept.senderID,
        cardPreview: exchangeAccept.cardPreview,
        selectedFields: exchangeAccept.selectedFields,
        ephemeralMessage: exchangeAccept.theirEphemeralMessage,
        nonce: exchangeAccept.nonce,
        timestamp: exchangeAccept.timestamp,
        signatureBase64: exchangeAccept.didSignature,
        senderJWK: exchangeAccept.senderJWK
      )
      let verificationStatus: VerificationStatus = isValidSignature ? .verified : .pending

      let theirSignature = exchangeAccept.didSignature ?? exchangeAccept.exchangeSignature
      let persistence = ExchangeEdgePersistencePayload(
        card: exchangeAccept.cardPreview,
        sourcePeerName: exchangeAccept.senderID,
        verificationStatus: verificationStatus,
        sealedRoute: exchangeAccept.sealedRoute,
        pubKey: exchangeAccept.pubKey,
        signPubKey: exchangeAccept.signPubKey,
        mySignature: mySignature,
        theirSignature: theirSignature,
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
        theirSignature: theirSignature,
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
      // Reject pre-v2 card payloads: their signature does not chain to a DID, so we cannot
      // tell whether the bytes match what the sender's DID controller actually issued.
      guard let version = payload.protocolVersion,
        version >= ProximityIdentitySigner.currentProtocolVersion else {
        print("[ProximityManager] Rejecting legacy card payload from \(peerID.displayName); needs v2")
        DispatchQueue.main.async { [weak self] in
          let err: CardError = .sharingError(
            "Peer is using an outdated exchange protocol; please ask them to update."
          )
          self?.lastError = err
          NotificationCenter.default.post(
            name: .matchingError,
            object: nil,
            userInfo: [ProximityEventKey.error: err]
          )
        }
        return
      }
      let scope = payload.scope ?? ShareScopeResolver.scope(
        selectedFields: payload.selectedFields,
        legacyLevel: payload.sharingLevel
      )
      let issuerStatus = ProximityVerificationHelper.verify(
        commitment: payload.issuerCommitment,
        proof: payload.issuerProof,
        message: payload.shareId.uuidString,
        scope: scope
      )
      // Independently verify the DID-bound payload signature. We do NOT promote
      // `.pending` to `.verified` based on this alone (the signature only proves
      // the sender holds their own key — issuer trust still comes from `issuerStatus`).
      // But we DO downgrade `.verified` back to `.pending` if the DID signature
      // fails, because that means the bytes we just decoded may not be what the
      // sender's DID controller actually signed.
      let didSignatureValid = Self.verifyDIDCardSignature(
        protocolVersion: payload.protocolVersion,
        shareId: payload.shareId,
        senderDID: payload.senderDID,
        receiverPeerName: localPeerID.displayName,
        senderID: payload.senderID,
        card: payload.card,
        selectedFields: payload.selectedFields ?? [],
        scope: scope,
        nonce: payload.nonce,
        timestamp: payload.timestamp,
        signatureBase64: payload.didSignature,
        senderJWK: payload.senderJWK
      )
      guard didSignatureValid else {
        print("[ProximityManager] DID signature invalid for card from \(payload.senderID); rejecting")
        DispatchQueue.main.async { [weak self] in
          let err: CardError = .sharingError(
            "Received card has an invalid identity signature; rejecting."
          )
          self?.lastError = err
          NotificationCenter.default.post(
            name: .matchingError,
            object: nil,
            userInfo: [ProximityEventKey.error: err]
          )
        }
        return
      }
      let finalStatus: VerificationStatus = issuerStatus

      print("[ProximityManager] Received payload from \(payload.senderID)")
      #if DEBUG
      print("[ProximityManager] Sealed Route: \(String(describing: payload.sealedRoute))")
      print("[ProximityManager] Pub Key: \(String(describing: payload.pubKey))")
      #endif

      DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        self.lastReceivedVerification = finalStatus
        if let index = self.nearbyPeers.firstIndex(where: { $0.peerID == peerID }) {
          self.nearbyPeers[index].verification = finalStatus
        }
        self.handleReceivedCard(
          payload.card,
          from: payload.senderID,
          status: finalStatus,
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
