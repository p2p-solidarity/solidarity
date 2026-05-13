import XCTest
@testable import solidarity

final class QRCodeScanServiceTests: XCTestCase {
  func testChunkedVPTokenAcceptsChunksStartingFromThirdFrame() throws {
    let vpPayload = """
    {"@context":["https://www.w3.org/2018/credentials/v1"],"holder":"did:key:z6MkTest","nonce":"n-123","type":["VerifiablePresentation"],"verifiableCredential":[{"proof":"test"}]}
    """
    let frames = try QRCodeChunkingService.makeFrames(for: vpPayload, chunkDataBytes: 80)
    XCTAssertGreaterThanOrEqual(frames.count, 3)

    let service = QRCodeScanService()
    var progressEvents: [QRCodeChunkProgress] = []
    var outcomeResult: Result<QRCodeScanService.ScanOutcome, CardError>?

    service.onChunkProgress = { progressEvents.append($0) }
    service.onScanOutcome = { result in outcomeResult = result }

    let delayedIndex = 1
    let firstScannedIndex = 2
    let interimOrder = [firstScannedIndex] + frames.indices.filter {
      $0 != firstScannedIndex && $0 != delayedIndex
    }

    for index in interimOrder {
      let disposition = service.process(scannedString: frames[index])
      XCTAssertEqual(disposition, .awaitingMoreChunks)
    }

    XCTAssertNil(outcomeResult)
    XCTAssertEqual(progressEvents.last?.receivedCount, frames.count - 1)
    XCTAssertEqual(progressEvents.last?.totalCount, frames.count)

    let finalDisposition = service.process(scannedString: frames[delayedIndex])
    XCTAssertEqual(finalDisposition, .handled)

    guard case .success(let outcome) = outcomeResult else {
      XCTFail("Expected successful scan outcome")
      return
    }
    XCTAssertEqual(outcome.route, .vpToken(vpPayload))
    XCTAssertEqual(progressEvents.last?.receivedCount, frames.count)
  }

  func testSiopRequestRoutesToReviewWithoutImmediateCredentialDispatch() {
    let card = BusinessCard(name: "SIOP Test \(UUID().uuidString)")
    _ = CardManager.shared.createCard(card)
    defer { _ = CardManager.shared.deleteCard(id: card.id) }

    let service = QRCodeScanService()
    let expectation = expectation(description: "scan outcome")
    var outcomeResult: Result<QRCodeScanService.ScanOutcome, CardError>?

    service.onScanOutcome = { result in
      outcomeResult = result
      expectation.fulfill()
    }

    let request =
      "openid://authorize?scope=openid&response_type=vp_token&client_id=did:key:z6MkTest&redirect_uri=https://rp.example.com/callback&nonce=n-123&state=s-123"
    service.process(scannedString: request)

    waitForExpectations(timeout: 2.0)

    guard case .success(let outcome) = outcomeResult else {
      XCTFail("Expected successful scan outcome")
      return
    }

    if case .siopRequest(let payload) = outcome.route {
      XCTAssertEqual(payload, request)
    } else {
      XCTFail("Expected .siopRequest route")
    }
    XCTAssertNil(outcome.card, "siopRequest should go through consent/review flow before issuance")
  }

  func testPlaintextEnvelopeStripsProofClaimsAndRemainsUnverified() throws {
    UserDefaults.standard.set(true, forKey: "share_proof_is_human")
    UserDefaults.standard.set(false, forKey: "share_proof_age_over_18")
    defer {
      UserDefaults.standard.removeObject(forKey: "share_proof_is_human")
      UserDefaults.standard.removeObject(forKey: "share_proof_age_over_18")
    }

    var card = BusinessCard(name: "Claim Test")
    card.sharingPreferences.sharingFormat = .plaintext
    let envelopeResult = QRCodeGenerationService().buildEnvelope(for: card, sharingLevel: .professional)
    guard case .success(let envelope) = envelopeResult else {
      XCTFail("Failed to build test QR envelope")
      return
    }
    XCTAssertNil(envelope.plaintext?.proofClaims, "Plaintext format must not advertise unverifiable claims")
    let encoded = try JSONEncoder.qrEncoder.encode(envelope)
    let payload = String(decoding: encoded, as: UTF8.self)

    let service = QRCodeScanService()
    let expectation = expectation(description: "scan outcome")
    var outcomeResult: Result<QRCodeScanService.ScanOutcome, CardError>?

    service.onScanOutcome = { result in
      outcomeResult = result
      expectation.fulfill()
    }

    service.process(scannedString: payload)
    waitForExpectations(timeout: 2.0)

    guard case .success(let outcome) = outcomeResult else {
      XCTFail("Expected successful scan outcome")
      return
    }
    XCTAssertEqual(outcome.verificationStatus, .unverified)
  }

  func testCompactCredentialJWTImportsAsBusinessCardRoute() throws {
    let card = BusinessCard(
      name: "JWT Route Test",
      title: "Engineer",
      company: "Solidarity"
    )
    let issueResult = VCService().issueBusinessCardCredential(for: card)
    guard case .success(let credential) = issueResult else {
      XCTFail("Expected JWT credential issuance")
      return
    }

    let service = QRCodeScanService()
    let expectation = expectation(description: "scan outcome")
    var outcomeResult: Result<QRCodeScanService.ScanOutcome, CardError>?

    service.onScanOutcome = { result in
      outcomeResult = result
      expectation.fulfill()
    }

    service.process(scannedString: credential.jwt)
    waitForExpectations(timeout: 2.0)

    guard case .success(let outcome) = outcomeResult else {
      XCTFail("Expected successful scan outcome")
      return
    }

    XCTAssertEqual(outcome.route, .businessCard)
    XCTAssertEqual(outcome.card?.name, card.name)
  }
}
