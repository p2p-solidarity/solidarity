import XCTest
@testable import airmeishi

final class QRCodeScanServiceTests: XCTestCase {
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
}
