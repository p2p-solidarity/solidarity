import Foundation

extension QRCodeScanService {
  func decodeEnvelope(from string: String) -> QRCodeEnvelope? {
    guard let data = string.data(using: .utf8) else { return nil }
    return try? JSONDecoder.qrDecoder.decode(QRCodeEnvelope.self, from: data)
  }

  func handleEnvelope(_ envelope: QRCodeEnvelope) {
    switch envelope.format {
    case .plaintext:
      guard let payload = envelope.plaintext else {
        emitOutcome(.failure(.sharingError("Missing plaintext payload")))
        return
      }
      if let expiration = payload.expirationDate, expiration < Date() {
        emitOutcome(.failure(.sharingError("Shared card has expired")))
        return
      }
      let card = rebuildCard(from: payload)
      let sealedRoute = payload.snapshot.sealedRoute
      let status = verifyProofClaims(
        payload.proofClaims,
        issuerStatus: .unverified,
        issuerProofPresent: false,
        ageOver18ProofValid: false
      )

      identityCoordinator.updateVerificationStatus(for: card.id, status: status)
      emitOutcome(
        .success(
          ScanOutcome(
            card: card,
            verificationStatus: status,
            sealedRoute: sealedRoute,
            route: .businessCard
          )
        )
      )

    case .zkProof:
      guard let base64 = envelope.encryptedPayload else {
        emitOutcome(.failure(.sharingError("Missing encrypted payload")))
        return
      }
      let result = handleEncryptedPayload(base64)
      emitOutcome(result)

    case .didSigned:
      guard let payload = envelope.didSigned else {
        emitOutcome(.failure(.sharingError("Missing DID payload")))
        return
      }
      if let expiration = payload.expirationDate, expiration < Date() {
        emitOutcome(.failure(.sharingError("Shared card has expired")))
        return
      }
      let result = handleDidSignedPayload(payload)
      emitOutcome(result)
    }
  }

  func handleEncryptedPayload(_ base64: String) -> Result<ScanOutcome, CardError> {
    guard let data = Data(base64Encoded: base64) else {
      return .failure(.sharingError("Invalid encrypted payload"))
    }

    let decrypted = encryptionManager.decrypt(data, as: QRSharingPayload.self)

    switch decrypted {
    case .failure(let error):
      return .failure(error)
    case .success(let payload):
      return evaluateSharingPayload(payload)
    }
  }

  func evaluateSharingPayload(_ payload: QRSharingPayload) -> Result<ScanOutcome, CardError> {
    if payload.expirationDate < Date() {
      return .failure(.sharingError("Shared card has expired"))
    }

    if let maxUses = payload.maxUses,
      let currentUses = payload.currentUses,
      currentUses >= maxUses
    {
      return .failure(.sharingError("Share link has reached maximum uses"))
    }

    let status = verifyIssuer(
      commitment: payload.issuerCommitment,
      proof: payload.issuerProof,
      message: payload.shareId.uuidString,
      scope: payload.scope ?? ShareScopeResolver.scope(
        selectedFields: payload.selectedFields,
        legacyLevel: payload.sharingLevel
      )
    )

    var ageOver18ProofValid = false
    if let proof = payload.sdProof {
      let verification = proofManager.verifySelectiveDisclosureProof(
        proof,
        expectedBusinessCardId: payload.businessCard.id.uuidString
      )
      switch verification {
      case .success(let outcome):
        ageOver18ProofValid = outcome.isValid
        if outcome.isValid == false {
          return .success(
            ScanOutcome(
              card: payload.businessCard,
              verificationStatus: .failed,
              sealedRoute: payload.sealedRoute,
              route: .businessCard
            )
          )
        }
      case .failure:
        return .success(
          ScanOutcome(
            card: payload.businessCard,
            verificationStatus: .failed,
            sealedRoute: payload.sealedRoute,
            route: .businessCard
          )
        )
      }
    }

    let finalStatus = verifyProofClaims(
      payload.proofClaims,
      issuerStatus: status,
      issuerProofPresent: payload.issuerProof != nil,
      ageOver18ProofValid: ageOver18ProofValid
    )
    identityCoordinator.updateVerificationStatus(for: payload.businessCard.id, status: finalStatus)
    return .success(
      ScanOutcome(
        card: payload.businessCard,
        verificationStatus: finalStatus,
        sealedRoute: payload.sealedRoute,
        route: .businessCard
      )
    )
  }

  func handleDidSignedPayload(_ payload: QRDidSignedPayload) -> Result<ScanOutcome, CardError> {
    switch vcService.importPresentedCredential(jwt: payload.jwt) {
    case .failure(let error):
      return .failure(error)
    case .success(let imported):
      let verificationResult = vcService.verifyStoredCredential(imported.storedCredential)
      let status: VerificationStatus
      switch verificationResult {
      case .success(let updated):
        status = statusFromStoredCredential(updated.status)
      case .failure:
        status = .unverified
      }
      identityCoordinator.updateVerificationStatus(for: imported.businessCard.id, status: status)
      return .success(ScanOutcome(card: imported.businessCard, verificationStatus: status, sealedRoute: nil, route: .businessCard))
    }
  }

  func handleLegacyPayload(_ data: String) {
    guard let encryptedData = Data(base64Encoded: data) else {
      emitOutcome(.failure(.sharingError("Invalid QR code format")))
      return
    }

    let decryptionResult = encryptionManager.decrypt(encryptedData, as: QRSharingPayload.self)
    switch decryptionResult {
    case .failure(let error):
      emitOutcome(.failure(error))
    case .success(let payload):
      identityCoordinator.updateVerificationStatus(for: payload.businessCard.id, status: .unverified)
      emitOutcome(evaluateSharingPayload(payload))
    }
  }

  // MARK: - OIDC Handlers

  func handleOID4VPRequest(_ requestString: String) {
    emitOutcome(
      .success(
        ScanOutcome(
          card: nil,
          verificationStatus: .pending,
          sealedRoute: nil,
          route: .oid4vpRequest(requestString)
        )
      )
    )
  }

  func handleVPToken(_ token: String) {
    let verification = ProofVerifierService.shared.verifyVpToken(token)
    let status = verificationStatus(from: verification)

    if shouldImportAsCredential(token) {
      switch vcService.importPresentedCredential(jwt: token) {
      case .failure:
        break
      case .success(let imported):
        let verifyResult = vcService.verifyStoredCredential(imported.storedCredential)
        let finalStatus: VerificationStatus
        switch verifyResult {
        case .success(let updated):
          finalStatus = statusFromStoredCredential(updated.status)
        case .failure:
          finalStatus = status
        }

        identityCoordinator.updateVerificationStatus(for: imported.businessCard.id, status: finalStatus)
        emitOutcome(
          .success(
            ScanOutcome(
              card: imported.businessCard,
              verificationStatus: finalStatus,
              sealedRoute: nil,
              route: .businessCard
            )
          )
        )
        return
      }
    }

    emitOutcome(
      .success(
        ScanOutcome(
          card: nil,
          verificationStatus: status,
          sealedRoute: nil,
          route: .vpToken(token)
        )
      )
    )
  }

  func handleOIDCRequest(_ data: String, route: ScanRoute) {
    switch oidcService.parseRequest(from: data) {
    case .failure(let error):
      emitOutcome(.failure(error))
    case .success:
      emitOutcome(
        .success(
          ScanOutcome(
            card: nil,
            verificationStatus: .pending,
            sealedRoute: nil,
            route: route
          )
        )
      )
    }
  }

  func handleOIDCResponse(url: URL) {
    switch oidcService.handleResponse(url: url, vcService: vcService) {
    case .failure(let error):
      emitOutcome(.failure(error))
    case .success(let imported):
      let verificationOutcome = vcService.verifyStoredCredential(imported.storedCredential)
      let status: VerificationStatus
      switch verificationOutcome {
      case .success(let updated):
        status = statusFromStoredCredential(updated.status)
      case .failure:
        status = .unverified
      }
      identityCoordinator.updateVerificationStatus(for: imported.businessCard.id, status: status)
      emitOutcome(.success(ScanOutcome(card: imported.businessCard, verificationStatus: status, sealedRoute: nil, route: .siopRequest(url.absoluteString))))
    }
  }

  func handleDeepLink(_ data: String) {
    let handled = DeepLinkManager.shared.handleQRCodeScan(data)
    if handled {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
        if let card = DeepLinkManager.shared.lastReceivedCard {
          self.emitOutcome(.success(ScanOutcome(card: card, verificationStatus: .unverified, sealedRoute: nil, route: .businessCard)))
        } else {
          self.emitOutcome(.failure(.sharingError("No card received from deep link")))
        }
      }
    } else {
      emitOutcome(.failure(.sharingError("Invalid app deep link URL format")))
    }
  }
}
