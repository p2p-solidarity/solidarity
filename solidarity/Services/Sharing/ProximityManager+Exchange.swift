import CryptoKit
import Foundation
import MultipeerConnectivity

extension ProximityManager {

  func sendGroupInvite(to peer: MCPeerID, group: SemaphoreGroupManager.ManagedGroup, inviterName: String) {
    guard session.connectedPeers.contains(peer) else {
      lastError = .sharingError("Peer is not connected")
      return
    }
    guard let payload = Self.buildSignedGroupInvite(
      groupId: group.id,
      groupName: group.name,
      groupRoot: group.root,
      inviterName: inviterName
    ) else {
      lastError = .sharingError("Failed to sign group invite")
      return
    }
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
    guard let response = Self.buildSignedGroupJoinResponse(
      groupId: invite.groupId,
      memberCommitment: memberCommitment,
      memberName: memberName
    ) else {
      lastError = .sharingError("Failed to sign group join response")
      return
    }
    do {
      let data = try JSONEncoder().encode(response)
      try session.send(data, toPeers: [peer], with: .reliable)
      print("Sent group join response to \(peer.displayName) for group: \(invite.groupName)")
    } catch {
      lastError = .sharingError("Failed to send join response: \(error.localizedDescription)")
      print("Failed to send join response: \(error)")
    }
  }

  /// Builds a `GroupInvitePayload` with an Ed25519 signature over the canonical bytes.
  /// Returns nil if signing fails (CryptoKit error or empty key).
  static func buildSignedGroupInvite(
    groupId: UUID,
    groupName: String,
    groupRoot: String?,
    inviterName: String,
    timestamp: Date = Date()
  ) -> GroupInvitePayload? {
    let canonical = GroupInvitePayload.canonicalBytes(
      groupId: groupId,
      groupName: groupName,
      groupRoot: groupRoot,
      timestamp: timestamp
    )
    guard let signature = GroupInviteSigner.sign(canonicalBytes: canonical) else {
      return nil
    }
    let publicKey = GroupInviteSigner.localPublicKey
    guard !publicKey.isEmpty else { return nil }
    return GroupInvitePayload(
      groupId: groupId,
      groupName: groupName,
      groupRoot: groupRoot,
      inviterName: inviterName,
      timestamp: timestamp,
      inviterPublicKey: publicKey,
      inviterSignature: signature
    )
  }

  /// Builds a `GroupJoinResponsePayload` with an Ed25519 signature over the
  /// canonical join bytes, binding the commitment to the local identity key.
  static func buildSignedGroupJoinResponse(
    groupId: UUID,
    memberCommitment: String,
    memberName: String,
    timestamp: Date = Date()
  ) -> GroupJoinResponsePayload? {
    let canonical = GroupJoinResponsePayload.canonicalBytes(
      groupId: groupId,
      memberCommitment: memberCommitment,
      memberName: memberName,
      timestamp: timestamp
    )
    guard let signature = GroupInviteSigner.sign(canonicalBytes: canonical) else {
      return nil
    }
    let publicKey = GroupInviteSigner.localPublicKey
    guard !publicKey.isEmpty else { return nil }
    return GroupJoinResponsePayload(
      groupId: groupId,
      memberCommitment: memberCommitment,
      memberName: memberName,
      timestamp: timestamp,
      memberPublicKey: publicKey,
      memberSignature: signature
    )
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

  /// User-initiated cancel of an in-flight connection attempt. Stops any retry
  /// scheduled by the auto-pilot loop so the popup's Cancel button doesn't get
  /// fought by a silent re-invite, and resets the peer status so the lightning
  /// card returns to its disconnected state immediately.
  func cancelConnectionAttempt(for peer: ProximityPeer) {
    cancelRetry(for: peer.peerID)
    if let index = nearbyPeers.firstIndex(where: { $0.id == peer.id }),
       nearbyPeers[index].status == .connecting {
      nearbyPeers[index].status = .disconnected
    }
  }

  func invitePeerToGroup(_ peer: ProximityPeer, group: SemaphoreGroupManager.ManagedGroup, inviterName: String) {
    guard let browser = browser else {
      print("Browser was nil in invitePeerToGroup. Restarting browsing...")
      startBrowsing()
      matchingInfoMessage = "Reconnecting... Please wait a moment, then try connecting again."
      return
    }
    guard let payload = Self.buildSignedGroupInvite(
      groupId: group.id,
      groupName: group.name,
      groupRoot: group.root,
      inviterName: inviterName
    ) else {
      lastError = .sharingError("Failed to sign group invite")
      return
    }
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

  // swiftlint:disable function_parameter_count
  /// Verifies a v2 DID-bound exchange signature. Returns false on any of:
  ///  - missing protocolVersion (legacy v1)
  ///  - missing senderDID / senderJWK / signature / nonce
  ///  - JWK does not match the JWK encoded in the sender's did:key identifier
  ///  - signature does not verify against the recomputed canonical bytes
  /// The receiverPeerName must be the local peer name from the receiver's
  /// perspective so a captured payload cannot be replayed against a different
  /// peer.
  static func verifyDIDExchangeSignature(
    protocolVersion: Int?,
    direction: ProximityExchangeBinding.Direction,
    requestId: UUID,
    senderDID: String?,
    receiverPeerName: String,
    senderID: String,
    cardPreview: BusinessCard,
    selectedFields: [BusinessCardField],
    ephemeralMessage: String?,
    nonce: String?,
    timestamp: Date,
    signatureBase64: String?,
    senderJWK: PublicKeyJWK?
  ) -> Bool {
    guard let protocolVersion,
      protocolVersion >= ProximityIdentitySigner.currentProtocolVersion,
      let senderDID, !senderDID.isEmpty,
      let senderJWK,
      let signatureBase64, !signatureBase64.isEmpty,
      let nonce, !nonce.isEmpty
    else {
      return false
    }
    guard ProximityIdentitySigner.jwk(senderJWK, matchesDID: senderDID) else {
      print("[ProximityManager] DID/JWK mismatch from \(senderID); rejecting signature")
      return false
    }
    let canonical = ProximityExchangeBinding.exchangeCanonicalBytes(
      protocolVersion: protocolVersion,
      direction: direction,
      requestId: requestId,
      senderDID: senderDID,
      receiverPeerName: receiverPeerName,
      senderID: senderID,
      cardPreview: cardPreview,
      selectedFields: selectedFields,
      ephemeralMessage: ephemeralMessage,
      nonce: nonce,
      timestamp: timestamp
    )
    return ProximityIdentitySigner.verify(
      signatureBase64: signatureBase64,
      canonicalBytes: canonical,
      jwk: senderJWK
    )
  }
  // swiftlint:enable function_parameter_count

  // swiftlint:disable function_parameter_count
  /// Verifies a v2 DID-bound card sharing signature. Same fail-closed rules as
  /// `verifyDIDExchangeSignature` above; the only differences are the binding
  /// fields (shareId + scope replace requestId + ephemeralMessage).
  static func verifyDIDCardSignature(
    protocolVersion: Int?,
    shareId: UUID,
    senderDID: String?,
    receiverPeerName: String,
    senderID: String,
    card: BusinessCard,
    selectedFields: [BusinessCardField],
    scope: String,
    nonce: String?,
    timestamp: Date,
    signatureBase64: String?,
    senderJWK: PublicKeyJWK?
  ) -> Bool {
    guard let protocolVersion,
      protocolVersion >= ProximityIdentitySigner.currentProtocolVersion,
      let senderDID, !senderDID.isEmpty,
      let senderJWK,
      let signatureBase64, !signatureBase64.isEmpty,
      let nonce, !nonce.isEmpty
    else {
      return false
    }
    guard ProximityIdentitySigner.jwk(senderJWK, matchesDID: senderDID) else {
      print("[ProximityManager] DID/JWK mismatch from \(senderID); rejecting card signature")
      return false
    }
    let canonical = ProximityExchangeBinding.cardCanonicalBytes(
      protocolVersion: protocolVersion,
      shareId: shareId,
      senderDID: senderDID,
      receiverPeerName: receiverPeerName,
      senderID: senderID,
      card: card,
      selectedFields: selectedFields,
      scope: scope,
      nonce: nonce,
      timestamp: timestamp
    )
    return ProximityIdentitySigner.verify(
      signatureBase64: signatureBase64,
      canonicalBytes: canonical,
      jwk: senderJWK
    )
  }
  // swiftlint:enable function_parameter_count

  func isMergeConfirmationRequired(_ error: CardError) -> Bool {
    if case .validationError(let message) = error {
      return message.contains("Merge confirmation required")
    }
    return false
  }
}
