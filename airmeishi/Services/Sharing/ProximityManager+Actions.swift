//
//  ProximityManager+Actions.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import CryptoKit
import Foundation
import MultipeerConnectivity

extension ProximityManager {

  /// Send business card to a specific peer
  func sendCard(_ card: BusinessCard, to peer: MCPeerID) {
    sendCard(card, to: peer, sharingLevel: .public)
  }

  /// Legacy level-based entrypoint kept for backward compatibility.
  func sendCard(_ card: BusinessCard, to peer: MCPeerID, sharingLevel: SharingLevel) {
    guard session.connectedPeers.contains(peer) else {
      lastError = .sharingError("Peer is not connected")
      return
    }

    do {
      let configuredCard = ShareSettingsStore.applyFields(to: card, level: sharingLevel)
      let selectedFields = ShareSettingsStore.enabledFields.sorted { $0.rawValue < $1.rawValue }
      let filteredCard = configuredCard.filteredCard(for: Set(selectedFields))
      let scope = ShareScopeResolver.scope(selectedFields: selectedFields)

      // Create sharing payload with ZK issuer info
      let shareUUID = UUID()
      let identityBundle =
        SemaphoreIdentityManager.shared.getIdentity() ?? (try? SemaphoreIdentityManager.shared.loadOrCreateIdentity())
      let issuerCommitment = identityBundle?.commitment ?? ""
      var issuerProof: String?
      if !issuerCommitment.isEmpty,
        SemaphoreIdentityManager.proofsSupported,
        let groupCommitments = SemaphoreGroupManager.shared.proofCommitments(containing: issuerCommitment)
      {
        issuerProof =
          (try? SemaphoreIdentityManager.shared.generateProof(
            groupCommitments: groupCommitments,
            message: shareUUID.uuidString,
            scope: scope
          ))
      }
      // Optional SD proof if enabled by sender's prefs
      var sdProof: SelectiveDisclosureProof?
      if configuredCard.sharingPreferences.useZK {
        let sdResult = ProofGenerationManager.shared.generateSelectiveDisclosureProof(
          businessCard: configuredCard,
          selectedFields: Set(selectedFields),
          recipientId: peer.displayName
        )
        if case .success(let proof) = sdResult { sdProof = proof }
      }
      let payload = ProximitySharingPayload(
        card: filteredCard,
        sharingLevel: sharingLevel,
        selectedFields: selectedFields,
        scope: scope,
        timestamp: Date(),
        senderID: localPeerID.displayName,
        shareId: shareUUID,
        issuerCommitment: issuerCommitment.isEmpty ? nil : issuerCommitment,
        issuerProof: issuerProof,
        sdProof: sdProof,
        sealedRoute: SecureKeyManager.shared.mySealedRoute,
        pubKey: SecureKeyManager.shared.myEncPubKey,
        signPubKey: SecureKeyManager.shared.mySignPubKey
      )

      print("[ProximityManager] Sending card to \(peer.displayName)")
      print("[ProximityManager] Sealed Route: \(String(describing: SecureKeyManager.shared.mySealedRoute))")
      print("[ProximityManager] Pub Key: \(String(describing: SecureKeyManager.shared.myEncPubKey))")

      let data = try JSONEncoder().encode(payload)

      try session.send(data, toPeers: [peer], with: .reliable)

      print("Sent business card to \(peer.displayName)")

    } catch {
      lastError = .sharingError("Failed to send card: \(error.localizedDescription)")
      print("Failed to send card: \(error)")
    }
  }

  func sendExchangeRequest(
    card: BusinessCard,
    to peer: MCPeerID,
    selectedFields: [BusinessCardField],
    myEphemeralMessage: String?
  ) -> CardResult<UUID> {
    guard session.connectedPeers.contains(peer) else {
      return .failure(.sharingError("Peer is not connected"))
    }

    let requestId = UUID()
    let timestamp = Date()
    let preview = filteredCard(card, using: selectedFields)
    let signatureInput = canonicalExchangeString(
      requestId: requestId,
      peerName: peer.displayName,
      card: preview,
      fields: selectedFields,
      timestamp: timestamp
    )

    guard let signature = signExchangeString(signatureInput) else {
      return .failure(.cryptographicError("Failed to sign exchange request"))
    }

    let payload = ExchangeRequestPayload(
      requestId: requestId,
      senderID: localPeerID.displayName,
      timestamp: timestamp,
      selectedFields: selectedFields,
      cardPreview: preview,
      myEphemeralMessage: myEphemeralMessage?.prefix(140).description,
      myExchangeSignature: signature,
      signPubKey: SecureKeyManager.shared.mySignPubKey
    )

    do {
      let data = try JSONEncoder().encode(payload)
      try session.send(data, toPeers: [peer], with: .reliable)
      sentExchangeSignatures[requestId] = signature
      sentExchangeMessages[requestId] = myEphemeralMessage?.prefix(140).description ?? ""
      return .success(requestId)
    } catch {
      return .failure(.sharingError("Failed to send exchange request: \(error.localizedDescription)"))
    }
  }

  func respondToExchangeRequest(
    _ request: PendingExchangeRequest,
    with card: BusinessCard,
    selectedFields: [BusinessCardField],
    myEphemeralMessage: String?
  ) -> CardResult<Void> {
    guard session.connectedPeers.contains(request.fromPeer) else {
      return .failure(.sharingError("Peer is not connected"))
    }

    let timestamp = Date()
    let preview = filteredCard(card, using: selectedFields)
    let signatureInput = canonicalExchangeString(
      requestId: request.requestId,
      peerName: request.fromPeer.displayName,
      card: preview,
      fields: selectedFields,
      timestamp: timestamp
    )
    guard let signature = signExchangeString(signatureInput) else {
      return .failure(.cryptographicError("Failed to sign exchange response"))
    }

    let payload = ExchangeAcceptPayload(
      requestId: request.requestId,
      senderID: localPeerID.displayName,
      timestamp: timestamp,
      selectedFields: selectedFields,
      cardPreview: preview,
      theirEphemeralMessage: myEphemeralMessage?.prefix(140).description,
      exchangeSignature: signature,
      sealedRoute: SecureKeyManager.shared.mySealedRoute,
      pubKey: SecureKeyManager.shared.myEncPubKey,
      signPubKey: SecureKeyManager.shared.mySignPubKey
    )

    do {
      let data = try JSONEncoder().encode(payload)
      try session.send(data, toPeers: [request.fromPeer], with: .reliable)

      let requestCanonical = canonicalExchangeString(
        requestId: request.payload.requestId,
        peerName: localPeerID.displayName,
        card: request.payload.cardPreview,
        fields: request.payload.selectedFields,
        timestamp: request.payload.timestamp
      )
      let isRequestSignatureValid = Self.verifyExchangeSignature(
        signature: request.payload.myExchangeSignature,
        canonicalString: requestCanonical,
        signPubKey: request.payload.signPubKey
      )

      let persistence = ExchangeEdgePersistencePayload(
        card: request.payload.cardPreview,
        sourcePeerName: request.payload.senderID,
        verificationStatus: isRequestSignatureValid ? .verified : .pending,
        sealedRoute: nil,
        pubKey: nil,
        signPubKey: request.payload.signPubKey,
        mySignature: signature,
        theirSignature: request.payload.myExchangeSignature,
        myMessage: myEphemeralMessage?.prefix(140).description,
        theirMessage: request.payload.myEphemeralMessage,
        timestamp: timestamp
      )
      persistExchangeEdge(persistence)
      pendingExchangeRequest = nil
      return .success(())
    } catch {
      return .failure(.sharingError("Failed to send exchange response: \(error.localizedDescription)"))
    }
  }

  func declinePendingExchangeRequest() {
    pendingExchangeRequest = nil
  }

  /// Send a group invite to a specific peer
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

  /// Accept a pending group invite and send back join response with user's commitment
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

  /// Disconnect from all peers and stop all services
  func disconnect() {
    autoConnectEnabled = false
    stopAdvertising()
    stopBrowsing()
    stopHeartbeat()
    cancelAllRetries()

    // Tear down UWB session
    NearbyInteractionManager.shared.invalidateSession()

    session.disconnect()
    nearbyPeers.removeAll()
    connectionStatus = .disconnected

    print("Disconnected from all peers")
  }

  /// Respond to the most recent pending invitation
  func respondToPendingInvitation(accept: Bool) {
    guard let handler = pendingInvitationHandler else { return }
    handler(accept, session)
    pendingInvitation = nil
    pendingInvitationHandler = nil
    isPresentingInvitation = false
  }

  /// Accept the most recent pending group invite and defer sending the join response until connected
  func acceptPendingGroupInvite(memberName: String, memberCommitment: String) {
    guard let tuple = pendingGroupInvite else { return }
    pendingGroupJoinResponse = PendingGroupJoinResponse(
      invite: tuple.payload,
      memberName: memberName,
      memberCommitment: memberCommitment,
      peerID: tuple.from
    )
    // Accept the Multipeer invitation to establish the session
    respondToPendingInvitation(accept: true)
  }

  /// Decline the most recent pending group invite
  func declinePendingGroupInvite() {
    respondToPendingInvitation(accept: false)
    pendingGroupInvite = nil
    pendingGroupJoinResponse = nil
  }

  /// Attempt to exclusively present the invitation popup. Returns true if acquired.
  func tryAcquireInvitationPresentation() -> Bool {
    if isPresentingInvitation { return false }
    isPresentingInvitation = true
    return true
  }

  /// Release the presentation lock for invitation popup.
  func releaseInvitationPresentation() {
    isPresentingInvitation = false
  }

  /// Get current sharing status
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

  /// Connect to a specific peer
  func connectToPeer(_ peer: ProximityPeer) {
    guard let browser = browser else {
      // Strategy B: Auto-restart browsing + Soft UI hint
      print("Browser was nil in connectToPeer. Restarting browsing...")
      startBrowsing()
      matchingInfoMessage = "Reconnecting... Please wait a moment, then try connecting again."
      return
    }

    browser.invitePeer(peer.peerID, to: session, withContext: nil, timeout: 30)

    // Update peer status
    if let index = nearbyPeers.firstIndex(where: { $0.id == peer.id }) {
      nearbyPeers[index].status = .connecting
    }

    print("Connecting to peer: \(peer.name)")
  }

  /// Invite a peer to join a group using the Multipeer invitation context (no manual connect first)
  func invitePeerToGroup(_ peer: ProximityPeer, group: SemaphoreGroupManager.ManagedGroup, inviterName: String) {
    guard let browser = browser else {
      // Strategy B: Auto-restart browsing + Soft UI hint
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

  /// Clear received cards
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
    // Add to received cards
    receivedCards.append(card)

    // Save to contact repository on main actor
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

        // If this is a Group VC, update messaging data for the member
        if let groupContext = card.groupContext,
          case .group(let info) = groupContext,
          let _ = sealedRoute,
          let _ = pubKey,
          let _ = signPubKey
        {

          print("Detected Group VC for group \(info.groupId). Updating member messaging data.")
          // Note: Logic for updating CloudKit for group members is delegated to owner
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
        var entity = ContactEntity.fromLegacy(saved)
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

  private func signExchangeString(_ value: String) -> String? {
    guard !value.isEmpty else { return nil }
    let signature = SecureKeyManager.shared.sign(content: value)
    return signature.isEmpty ? nil : signature
  }

  func canonicalExchangeString(
    requestId: UUID,
    peerName: String,
    card: BusinessCard,
    fields: [BusinessCardField],
    timestamp: Date
  ) -> String {
    let orderedFields = fields.map(\.rawValue).sorted().joined(separator: ",")
    let unixSeconds = Int(timestamp.timeIntervalSince1970)
    return "\(requestId.uuidString)|\(peerName)|\(card.name)|\(orderedFields)|\(unixSeconds)"
  }

  private func filteredCard(_ card: BusinessCard, using selectedFields: [BusinessCardField]) -> BusinessCard {
    let allowed = Set(selectedFields)
    var filtered = card
    if !allowed.contains(.name) { filtered.name = "" }
    if !allowed.contains(.title) { filtered.title = nil }
    if !allowed.contains(.company) { filtered.company = nil }
    if !allowed.contains(.email) { filtered.email = nil }
    if !allowed.contains(.phone) { filtered.phone = nil }
    if !allowed.contains(.profileImage) { filtered.profileImage = nil }
    if !allowed.contains(.socialNetworks) { filtered.socialNetworks = [] }
    if !allowed.contains(.skills) { filtered.skills = [] }
    return filtered
  }

  private func isMergeConfirmationRequired(_ error: CardError) -> Bool {
    if case .validationError(let message) = error {
      return message.contains("Merge confirmation required")
    }
    return false
  }
}
