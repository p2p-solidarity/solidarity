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

  func testVerifyVpTokenRejectsUntrustedIssuerEvenIfSignatureIsValid() throws {
    let credentialJWT = try issuedCredentialJWT(issuerDid: "did:example:attacker")
    let result = ProofVerifierService.shared.verifyVpToken(credentialJWT)

    XCTAssertFalse(result.isValid)
    XCTAssertEqual(result.status, .failed)
  }

  func testVCServiceStoredCredentialVerificationRejectsUntrustedIssuer() throws {
    let card = BusinessCard(name: "Untrusted Issuer")
    let options = VCService.IssueOptions(issuerDid: "did:example:attacker")
    let storeResult = vcService.issueAndStoreBusinessCardCredential(
      for: card,
      options: options,
      status: .unverified
    )

    guard case .success(let stored) = storeResult else {
      XCTFail("Failed to create stored credential for test")
      return
    }
    defer {
      _ = VCLibrary.shared.remove(id: stored.id)
    }

    let verifyResult = vcService.verifyStoredCredential(stored)
    guard case .success(let updated) = verifyResult else {
      XCTFail("Expected verification result with updated status")
      return
    }

    XCTAssertEqual(updated.status, .failed)
  }

  private func issuedCredentialJWT(issuerDid: String? = nil) throws -> String {
    let card = BusinessCard(
      name: "Verifier Test",
      title: "Engineer",
      company: "Solidarity",
      email: "verifier@example.com"
    )
    let options = VCService.IssueOptions(issuerDid: issuerDid)
    switch vcService.issueBusinessCardCredential(for: card, options: options) {
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
