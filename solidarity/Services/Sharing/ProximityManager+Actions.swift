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
      let unsignedPayload = ProximitySharingPayload(
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
        payloadSignature: nil,
        sealedRoute: SecureKeyManager.shared.mySealedRoute,
        pubKey: SecureKeyManager.shared.myEncPubKey,
        signPubKey: SecureKeyManager.shared.mySignPubKey
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
        signPubKey: unsignedPayload.signPubKey
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
}
