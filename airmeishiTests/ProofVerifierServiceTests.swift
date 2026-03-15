import Foundation
import XCTest
@testable import airmeishi

final class ProofVerifierServiceTests: XCTestCase {
  private let vcService = VCService()

  func testVerifyVpTokenAcceptsValidCredentialJWT() throws {
    let credentialJWT = try issuedCredentialJWT()
    let result = ProofVerifierService.shared.verifyVpToken(credentialJWT)

    XCTAssertTrue(result.isValid)
    XCTAssertEqual(result.status, .verified)
  }

  func testVerifyVpTokenRejectsTamperedCredentialJWTSignature() throws {
    let credentialJWT = try issuedCredentialJWT()
    let tampered = tamperPayload(of: credentialJWT)
    let result = ProofVerifierService.shared.verifyVpToken(tampered)

    XCTAssertFalse(result.isValid)
    XCTAssertEqual(result.status, .failed)
  }

  func testVerifyVpEnvelopeRejectsTamperedEmbeddedCredentialJWT() throws {
    let credentialJWT = try issuedCredentialJWT()
    let tampered = tamperPayload(of: credentialJWT)
    let envelope: [String: Any] = [
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      "type": ["VerifiablePresentation"],
      "holder": "did:key:test",
      "verifiableCredential": [tampered],
    ]
    let data = try JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys])
    let token = String(decoding: data, as: UTF8.self)

    let result = ProofVerifierService.shared.verifyVpToken(token)

    XCTAssertFalse(result.isValid)
    XCTAssertEqual(result.status, .failed)
  }

  private func issuedCredentialJWT() throws -> String {
    let card = BusinessCard(
      name: "Verifier Test",
      title: "Engineer",
      company: "Solidarity",
      email: "verifier@example.com"
    )
    switch vcService.issueBusinessCardCredential(for: card) {
    case .failure(let error):
      throw error
    case .success(let issued):
      return issued.jwt
    }
  }

  private func tamperPayload(of jwt: String) -> String {
    let parts = jwt.split(separator: ".")
    guard parts.count == 3 else { return jwt }
    guard var payloadData = Data(base64URLEncoded: String(parts[1])), !payloadData.isEmpty else { return jwt }
    payloadData[payloadData.startIndex] ^= 0x01
    let payload = payloadData.base64URLEncodedString()
    return "\(parts[0]).\(payload).\(parts[2])"
  }
}
