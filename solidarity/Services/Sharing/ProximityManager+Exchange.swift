import CryptoKit
import Foundation
import MultipeerConnectivity

extension ProximityManager {

  func sendGroupInvite(to peer: MCPeerID, group: SemaphoreGroupManager.ManagedGroup, inviterName: String) {
    guard session.connectedPeers.contains(peer) else {
      lastError = .sharingError("Peer is not connected")
      return
    }
    let payload = GroupInvitePayload(
      groupId: group.id,
      groupName: group.name,
      groupRoot: group.root,
      inviterName: inviterName,
      timestamp: Date()
    )
    do {
      let data = try JSONEncoder().encode(payload)
      try session.send(data, toPeers: [peer], with: .reliable)
      print("Sent group invite to \(peer.displayName) for group: \(group.name)")
    } catch {
      lastError = .sharingError("Failed to send group invite: \(error.localizedDescription)")
      print("Failed to send group invite: \(error)")
    }
  }

  func acceptGroupInvite(_ invite: GroupInvitePayload, to peer: MCPeerID, memberName: String, memberCommitment: String)
  {
    let response = GroupJoinResponsePayload(
      groupId: invite.groupId,
      memberCommitment: memberCommitment,
      memberName: memberName,
      timestamp: Date()
    )
    do {
      let data = try JSONEncoder().encode(response)
      try session.send(data, toPeers: [peer], with: .reliable)
      print("Sent group join response to \(peer.displayName) for group: \(invite.groupName)")
    } catch {
      lastError = .sharingError("Failed to send join response: \(error.localizedDescription)")
      print("Failed to send join response: \(error)")
    }
  }

  func disconnect() {
    autoConnectEnabled = false
    stopAdvertising()
    stopBrowsing()
    stopHeartbeat()
    cancelAllRetries()

    NearbyInteractionManager.shared.invalidateSession()

    session.disconnect()
    nearbyPeers.removeAll()
    connectionStatus = .disconnected

    print("Disconnected from all peers")
  }

  func respondToPendingInvitation(accept: Bool) {
    guard let handler = pendingInvitationHandler else { return }
    handler(accept, session)
    pendingInvitation = nil
    pendingInvitationHandler = nil
    isPresentingInvitation = false
  }

  func acceptPendingGroupInvite(memberName: String, memberCommitment: String) {
    guard let tuple = pendingGroupInvite else { return }
    pendingGroupJoinResponse = PendingGroupJoinResponse(
      invite: tuple.payload,
      memberName: memberName,
      memberCommitment: memberCommitment,
      peerID: tuple.from
    )
    respondToPendingInvitation(accept: true)
  }

  func declinePendingGroupInvite() {
    respondToPendingInvitation(accept: false)
    pendingGroupInvite = nil
    pendingGroupJoinResponse = nil
  }

  func tryAcquireInvitationPresentation() -> Bool {
    if isPresentingInvitation { return false }
    isPresentingInvitation = true
    return true
  }

  func releaseInvitationPresentation() {
    isPresentingInvitation = false
  }

  func getSharingStatus() -> ProximitySharingStatus {
    return ProximitySharingStatus(
      isAdvertising: isAdvertising,
      isBrowsing: isBrowsing,
      connectedPeersCount: session.connectedPeers.count,
      nearbyPeersCount: nearbyPeers.count,
      currentCard: currentCard,
      sharingLevel: currentSharingLevel
    )
  }

  func connectToPeer(_ peer: ProximityPeer) {
    guard let browser = browser else {
      print("Browser was nil in connectToPeer. Restarting browsing...")
      startBrowsing()
      matchingInfoMessage = "Reconnecting... Please wait a moment, then try connecting again."
      return
    }

    browser.invitePeer(peer.peerID, to: session, withContext: nil, timeout: 30)

    if let index = nearbyPeers.firstIndex(where: { $0.id == peer.id }) {
      nearbyPeers[index].status = .connecting
    }

    print("Connecting to peer: \(peer.name)")
  }

  func invitePeerToGroup(_ peer: ProximityPeer, group: SemaphoreGroupManager.ManagedGroup, inviterName: String) {
    guard let browser = browser else {
      print("Browser was nil in invitePeerToGroup. Restarting browsing...")
      startBrowsing()
      matchingInfoMessage = "Reconnecting... Please wait a moment, then try connecting again."
      return
    }
    let payload = GroupInvitePayload(
      groupId: group.id,
      groupName: group.name,
      groupRoot: group.root,
      inviterName: inviterName,
      timestamp: Date()
    )
    do {
      let context = try JSONEncoder().encode(payload)
      browser.invitePeer(peer.peerID, to: session, withContext: context, timeout: 30)
      print("Invited \(peer.name) to group via context: \(group.name)")
    } catch {
      lastError = .sharingError("Failed to encode invite: \(error.localizedDescription)")
    }
  }

  func clearReceivedCards() {
    receivedCards.removeAll()
  }

  func handleReceivedCard(
    _ card: BusinessCard,
    from senderName: String,
    status: VerificationStatus,
    sealedRoute: String? = nil,
    pubKey: String? = nil,
    signPubKey: String? = nil
  ) {
    receivedCards.append(card)

    Task { @MainActor in
      let peerSignPubKey = (signPubKey == SecureKeyManager.shared.mySignPubKey) ? nil : signPubKey
      let contact = Contact(
        businessCard: card,
        source: .proximity,
        verificationStatus: status,
        sealedRoute: sealedRoute,
        pubKey: pubKey,
        signPubKey: peerSignPubKey
      )

      let result = contactRepository.addContact(contact)

      switch result {
      case .success:
        print("Received and saved business card from \(senderName)")

        if let groupContext = card.groupContext,
          case .group(let info) = groupContext,
          let _ = sealedRoute,
          let _ = pubKey,
          let _ = signPubKey
        {

          print("Detected Group VC for group \(info.groupId). Updating member messaging data.")
        }

      case .failure(let error):
        if isMergeConfirmationRequired(error) {
          print("Pending merge confirmation required for received card from \(senderName)")
        } else {
          print("Failed to save received card: \(error)")
          self.lastError = error
        }
      }
    }
  }

  internal func persistExchangeEdge(_ payload: ExchangeEdgePersistencePayload) {
    Task { @MainActor in
      let peerSignPubKey = (payload.signPubKey == SecureKeyManager.shared.mySignPubKey) ? nil : payload.signPubKey
      let contact = Contact(
        businessCard: payload.card,
        source: .proximity,
        verificationStatus: payload.verificationStatus,
        sealedRoute: payload.sealedRoute,
        pubKey: payload.pubKey,
        signPubKey: peerSignPubKey
      )

      let result = contactRepository.addContact(contact)
      switch result {
      case .success(let saved):
        let entity = ContactEntity.fromLegacy(saved)
        entity.didPublicKey = peerSignPubKey
        entity.myExchangeSignature = Data(base64Encoded: payload.mySignature)
        entity.exchangeSignature = Data(base64Encoded: payload.theirSignature)
        entity.exchangeTimestamp = payload.timestamp
        entity.myEphemeralMessage = payload.myMessage?.prefix(140).description
        entity.theirEphemeralMessage = payload.theirMessage?.prefix(140).description
        entity.graphExportEdgeId = entity.graphExportEdgeId ?? UUID().uuidString
        entity.commonFriendsHandshakeToken = entity.commonFriendsHandshakeToken ?? UUID().uuidString
        IdentityDataStore.shared.upsertContact(entity)
        print("Persisted exchange edge for \(payload.sourcePeerName)")
      case .failure(let error):
        if isMergeConfirmationRequired(error) {
          print("Pending merge confirmation required for exchange edge from \(payload.sourcePeerName)")
        } else {
          self.lastError = error
        }
      }
    }
  }

  static func verifyExchangeSignature(signature: String, canonicalString: String, signPubKey: String?) -> Bool {
    guard !signature.isEmpty,
      !canonicalString.isEmpty,
      let signPubKey,
      !signPubKey.isEmpty
    else {
      return false
    }
    return SecureKeyManager.shared.verify(
      signatureBase64: signature,
      content: canonicalString,
      pubKeyBase64: signPubKey
    )
  }

  func isMergeConfirmationRequired(_ error: CardError) -> Bool {
    if case .validationError(let message) = error {
      return message.contains("Merge confirmation required")
    }
    return false
  }
}
