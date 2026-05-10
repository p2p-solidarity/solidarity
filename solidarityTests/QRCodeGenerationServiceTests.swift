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

  func testCompressedProofPayloadRoundTripsAndGeneratesQRCode() throws {
    let proofChunks = Array(repeating: "0123456789abcdef", count: 500)
    let vp: [String: Any] = [
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      "type": ["VerifiablePresentation"],
      "holder": "did:key:z6MkHolder",
      "nonce": UUID().uuidString,
      "proof_type": "mopro-noir",
      "selected_claims": ["field_name", "is_human", "age_over_18"],
      "verifiableCredential": [
        [
          "proof": proofChunks,
          "publicSignals": proofChunks,
        ]
      ],
    ]
    let data = try JSONSerialization.data(withJSONObject: vp, options: [.sortedKeys])

    let compressed = try XCTUnwrap(QRCodeGenerationService.compressForQR(data))
    let decompressed = try XCTUnwrap(QRCodeGenerationService.decompressQR(compressed))
    XCTAssertEqual(decompressed, data)

    guard case .success = QRCodeManager.shared.generateQRCode(from: compressed) else {
      XCTFail("Compressed proof payload should fit in a QR code")
      return
    }
  }
}
