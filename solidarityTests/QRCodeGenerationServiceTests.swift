import XCTest
@testable import solidarity

final class QRCodeGenerationServiceTests: XCTestCase {
  private let humanKey = "share_proof_is_human"
  private let ageKey = "share_proof_age_over_18"

  override func tearDownWithError() throws {
    UserDefaults.standard.removeObject(forKey: humanKey)
    UserDefaults.standard.removeObject(forKey: ageKey)
  }

  /// Plaintext envelopes intentionally drop proof claims even when the user
  /// has them toggled on, because the plaintext payload has no
  /// cryptographic artifact to back the claim. Only signed/zk envelopes
  /// can advertise verified claims.
  func testPlaintextEnvelopeNeverIncludesProofClaims() {
    UserDefaults.standard.set(true, forKey: humanKey)
    UserDefaults.standard.set(true, forKey: ageKey)

    var card = BusinessCard(name: "Proof Claim User")
    card.sharingPreferences.sharingFormat = .plaintext

    let result = QRCodeGenerationService().buildEnvelope(for: card, sharingLevel: .professional)
    guard case .success(let envelope) = result else {
      XCTFail("Expected envelope generation success")
      return
    }

    XCTAssertTrue(
      (envelope.plaintext?.proofClaims ?? []).isEmpty,
      "Plaintext envelope must not advertise proof claims; only signed/zk paths may."
    )
  }

  func testPlaintextEnvelopeOmitsProofClaimsWhenDisabled() {
    UserDefaults.standard.set(false, forKey: humanKey)
    UserDefaults.standard.set(false, forKey: ageKey)

    var card = BusinessCard(name: "No Proof Claim User")
    card.sharingPreferences.sharingFormat = .plaintext

    let result = QRCodeGenerationService().buildEnvelope(for: card, sharingLevel: .professional)
    guard case .success(let envelope) = result else {
      XCTFail("Expected envelope generation success")
      return
    }

    XCTAssertTrue((envelope.plaintext?.proofClaims ?? []).isEmpty)
  }
}
