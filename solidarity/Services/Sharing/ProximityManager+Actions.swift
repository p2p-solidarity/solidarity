import CryptoKit
import Foundation
import MultipeerConnectivity

extension ProximityManager {

  func sendCard(_ card: BusinessCard, to peer: MCPeerID) {
    sendCard(card, to: peer, sharingLevel: .public)
  }

  func sendCard(_ card: BusinessCard, to peer: MCPeerID, sharingLevel: SharingLevel) {
    guard session.connectedPeers.contains(peer) else {
      lastError = .sharingError("Peer is not connected")
      return
    }

    guard let senderDID = ProximityIdentitySigner.localDID(),
      let senderJWK = ProximityIdentitySigner.localPublicJWK() else {
      lastError = .sharingError("Local DID key is not available; cannot sign exchange")
      return
    }

    do {
      let configuredCard = ShareSettingsStore.applyFields(to: card, level: sharingLevel)
      let selectedFields = ShareSettingsStore.enabledFields.sorted { $0.rawValue < $1.rawValue }
      let filteredCard = configuredCard.filteredCard(for: Set(selectedFields))
      let scope = ShareScopeResolver.scope(selectedFields: selectedFields)

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
      var sdProof: SelectiveDisclosureProof?
      if configuredCard.sharingPreferences.useZK {
        let sdResult = ProofGenerationManager.shared.generateSelectiveDisclosureProof(
          businessCard: configuredCard,
          selectedFields: Set(selectedFields),
          recipientId: peer.displayName
        )
        if case .success(let proof) = sdResult { sdProof = proof }
      }

      let nonce = UUID().uuidString
      let timestamp = Date()
      let canonical = ProximityExchangeBinding.cardCanonicalBytes(
        protocolVersion: ProximityIdentitySigner.currentProtocolVersion,
        shareId: shareUUID,
        senderDID: senderDID,
        receiverPeerName: peer.displayName,
        senderID: localPeerID.displayName,
        card: filteredCard,
        selectedFields: selectedFields,
        scope: scope,
        nonce: nonce,
        timestamp: timestamp
      )
      let didSignature: String
      switch ProximityIdentitySigner.signBase64(canonicalBytes: canonical) {
      case .failure(let error):
        lastError = error
        return
      case .success(let value):
        didSignature = value
      }

      // Legacy Curve25519 envelope signature retained for backward compatibility with older
      // clients that read `payloadSignature`. The trust gate is `didSignature` above.
      let unsignedPayload = ProximitySharingPayload(
        card: filteredCard,
        sharingLevel: sharingLevel,
        selectedFields: selectedFields,
        scope: scope,
        timestamp: timestamp,
        senderID: localPeerID.displayName,
        shareId: shareUUID,
        issuerCommitment: issuerCommitment.isEmpty ? nil : issuerCommitment,
        issuerProof: issuerProof,
        sdProof: sdProof,
        payloadSignature: nil,
        sealedRoute: SecureKeyManager.shared.mySealedRoute,
        pubKey: SecureKeyManager.shared.myEncPubKey,
        signPubKey: SecureKeyManager.shared.mySignPubKey,
        protocolVersion: ProximityIdentitySigner.currentProtocolVersion,
        senderDID: senderDID,
        senderJWK: senderJWK,
        receiverPeerName: peer.displayName,
        nonce: nonce,
        didSignature: didSignature
      )

      let payloadSignature = signExchangeString(canonicalCardPayloadString(for: unsignedPayload))
      let payload = ProximitySharingPayload(
        card: unsignedPayload.card,
        sharingLevel: unsignedPayload.sharingLevel,
        selectedFields: unsignedPayload.selectedFields,
        scope: unsignedPayload.scope,
        timestamp: unsignedPayload.timestamp,
        senderID: unsignedPayload.senderID,
        shareId: unsignedPayload.shareId,
        issuerCommitment: unsignedPayload.issuerCommitment,
        issuerProof: unsignedPayload.issuerProof,
        sdProof: unsignedPayload.sdProof,
        payloadSignature: payloadSignature,
        sealedRoute: unsignedPayload.sealedRoute,
        pubKey: unsignedPayload.pubKey,
        signPubKey: unsignedPayload.signPubKey,
        protocolVersion: unsignedPayload.protocolVersion,
        senderDID: unsignedPayload.senderDID,
        senderJWK: unsignedPayload.senderJWK,
        receiverPeerName: unsignedPayload.receiverPeerName,
        nonce: unsignedPayload.nonce,
        didSignature: unsignedPayload.didSignature
      )

      print("[ProximityManager] Sending card to \(peer.displayName)")
      #if DEBUG
      print("[ProximityManager] Sealed Route: \(String(describing: SecureKeyManager.shared.mySealedRoute))")
      print("[ProximityManager] Pub Key: \(String(describing: SecureKeyManager.shared.myEncPubKey))")
      #endif

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

    guard let senderDID = ProximityIdentitySigner.localDID(),
      let senderJWK = ProximityIdentitySigner.localPublicJWK() else {
      return .failure(.cryptographicError("Local DID key is not available; cannot sign exchange"))
    }

    let requestId = UUID()
    let timestamp = Date()
    let preview = filteredCard(card, using: selectedFields)
    let truncatedMessage = myEphemeralMessage?.prefix(140).description

    let nonce = UUID().uuidString
    let canonical = ProximityExchangeBinding.exchangeCanonicalBytes(
      protocolVersion: ProximityIdentitySigner.currentProtocolVersion,
      direction: .request,
      requestId: requestId,
      senderDID: senderDID,
      receiverPeerName: peer.displayName,
      senderID: localPeerID.displayName,
      cardPreview: preview,
      selectedFields: selectedFields,
      ephemeralMessage: truncatedMessage,
      nonce: nonce,
      timestamp: timestamp
    )
    let didSignature: String
    switch ProximityIdentitySigner.signBase64(canonicalBytes: canonical) {
    case .failure(let error):
      return .failure(error)
    case .success(let value):
      didSignature = value
    }

    let signatureInput = canonicalExchangeString(
      requestId: requestId,
      peerName: peer.displayName,
      card: preview,
      fields: selectedFields,
      timestamp: timestamp
    )
    let legacySignature = signExchangeString(signatureInput) ?? ""

    let payload = ExchangeRequestPayload(
      requestId: requestId,
      senderID: localPeerID.displayName,
      timestamp: timestamp,
      selectedFields: selectedFields,
      cardPreview: preview,
      myEphemeralMessage: truncatedMessage,
      myExchangeSignature: legacySignature,
      signPubKey: SecureKeyManager.shared.mySignPubKey,
      protocolVersion: ProximityIdentitySigner.currentProtocolVersion,
      senderDID: senderDID,
      senderJWK: senderJWK,
      receiverPeerName: peer.displayName,
      nonce: nonce,
      didSignature: didSignature
    )

    do {
      let data = try JSONEncoder().encode(payload)
      try session.send(data, toPeers: [peer], with: .reliable)
      sentExchangeSignatures[requestId] = didSignature
      sentExchangeMessages[requestId] = truncatedMessage ?? ""
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

    guard let senderDID = ProximityIdentitySigner.localDID(),
      let senderJWK = ProximityIdentitySigner.localPublicJWK() else {
      return .failure(.cryptographicError("Local DID key is not available; cannot sign exchange"))
    }

    let timestamp = Date()
    let preview = filteredCard(card, using: selectedFields)
    let truncatedMessage = myEphemeralMessage?.prefix(140).description

    let nonce = UUID().uuidString
    let canonical = ProximityExchangeBinding.exchangeCanonicalBytes(
      protocolVersion: ProximityIdentitySigner.currentProtocolVersion,
      direction: .accept,
      requestId: request.requestId,
      senderDID: senderDID,
      receiverPeerName: request.fromPeer.displayName,
      senderID: localPeerID.displayName,
      cardPreview: preview,
      selectedFields: selectedFields,
      ephemeralMessage: truncatedMessage,
      nonce: nonce,
      timestamp: timestamp
    )
    let didSignature: String
    switch ProximityIdentitySigner.signBase64(canonicalBytes: canonical) {
    case .failure(let error):
      return .failure(error)
    case .success(let value):
      didSignature = value
    }

    let signatureInput = canonicalExchangeString(
      requestId: request.requestId,
      peerName: request.fromPeer.displayName,
      card: preview,
      fields: selectedFields,
      timestamp: timestamp
    )
    let legacySignature = signExchangeString(signatureInput) ?? ""

    let payload = ExchangeAcceptPayload(
      requestId: request.requestId,
      senderID: localPeerID.displayName,
      timestamp: timestamp,
      selectedFields: selectedFields,
      cardPreview: preview,
      theirEphemeralMessage: truncatedMessage,
      exchangeSignature: legacySignature,
      sealedRoute: SecureKeyManager.shared.mySealedRoute,
      pubKey: SecureKeyManager.shared.myEncPubKey,
      signPubKey: SecureKeyManager.shared.mySignPubKey,
      protocolVersion: ProximityIdentitySigner.currentProtocolVersion,
      senderDID: senderDID,
      senderJWK: senderJWK,
      receiverPeerName: request.fromPeer.displayName,
      nonce: nonce,
      didSignature: didSignature
    )

    do {
      let data = try JSONEncoder().encode(payload)
      try session.send(data, toPeers: [request.fromPeer], with: .reliable)

      let isRequestSignatureValid = ProximityManager.verifyDIDExchangeSignature(
        protocolVersion: request.payload.protocolVersion,
        direction: .request,
        requestId: request.payload.requestId,
        senderDID: request.payload.senderDID,
        receiverPeerName: localPeerID.displayName,
        senderID: request.payload.senderID,
        cardPreview: request.payload.cardPreview,
        selectedFields: request.payload.selectedFields,
        ephemeralMessage: request.payload.myEphemeralMessage,
        nonce: request.payload.nonce,
        timestamp: request.payload.timestamp,
        signatureBase64: request.payload.didSignature,
        senderJWK: request.payload.senderJWK
      )

      let persistence = ExchangeEdgePersistencePayload(
        card: request.payload.cardPreview,
        sourcePeerName: request.payload.senderID,
        verificationStatus: isRequestSignatureValid ? .verified : .pending,
        sealedRoute: nil,
        pubKey: nil,
        signPubKey: request.payload.signPubKey,
        mySignature: didSignature,
        theirSignature: request.payload.didSignature ?? request.payload.myExchangeSignature,
        myMessage: truncatedMessage,
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

  // MARK: - Signing & Canonical Helpers

  func signExchangeString(_ value: String) -> String? {
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

  internal func canonicalCardPayloadString(for payload: ProximitySharingPayload) -> String {
    let orderedFields = (payload.selectedFields ?? []).map(\.rawValue).sorted().joined(separator: ",")
    let unixSeconds = Int(payload.timestamp.timeIntervalSince1970)
    return "\(payload.shareId.uuidString)|\(payload.senderID)|\(payload.card.id.uuidString)|\(orderedFields)|\(unixSeconds)"
  }

  func filteredCard(_ card: BusinessCard, using selectedFields: [BusinessCardField]) -> BusinessCard {
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

  // MARK: - UWB Spatial Trigger

  /// Single entry point for `NearbyInteractionManager.onSpatialTrigger`. Replaces
  /// the per-view `sendCard` calls that used to race against MC connection state
  /// and produce "Peer is not connected" toasts. Routing rules:
  ///  - Peer must still be in `session.connectedPeers` (matched by displayName so
  ///    a re-instantiated MCPeerID does not falsely fail the contains check).
  ///  - If `autoSendCardOnConnect` is on, MC `.connected` already sent the card;
  ///    just close the UWB cooldown.
  ///  - Otherwise resolve a card from `currentCard` with a `CardManager` fallback,
  ///    then send through the existing `sendCard(_:to:sharingLevel:)` path.
  /// Failures here log + reset NI to idle; they never set `lastError`, so a UWB
  /// race after disconnect no longer surfaces as a user-visible error toast.
  func handleSpatialTrigger(peerID: MCPeerID) {
    let isConnected = session.connectedPeers.contains { $0.displayName == peerID.displayName }
    guard isConnected else {
      print("[ProximityManager] UWB trigger ignored — peer \(peerID.displayName) not in connectedPeers")
      NearbyInteractionManager.shared.exchangeDidFail()
      return
    }

    if autoSendCardOnConnect {
      NearbyInteractionManager.shared.exchangeDidComplete()
      return
    }

    let baseCard = currentCard ?? CardManager.shared.businessCards.first
    guard let card = baseCard else {
      print("[ProximityManager] UWB trigger ignored — no card available to send")
      NearbyInteractionManager.shared.exchangeDidFail()
      return
    }

    let prepared = ShareSettingsStore.applyFields(to: card, level: currentSharingLevel)
    sendCard(prepared, to: peerID, sharingLevel: currentSharingLevel)
    NearbyInteractionManager.shared.exchangeDidComplete()
  }
}
