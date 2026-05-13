import Foundation
import XCTest
@testable import solidarity

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

  func testVerifyJWTRejectsAlgNone() throws {
    let credentialJWT = try issuedCredentialJWT()
    let mutated = swapHeaderAlg(of: credentialJWT, to: "none")
    let result = ProofVerifierService.shared.verifyVpToken(mutated)
    XCTAssertFalse(result.isValid)
    XCTAssertEqual(result.status, .failed)
    XCTAssertTrue(result.reason.lowercased().contains("alg") || result.reason.lowercased().contains("es256"),
                  "Expected reason to mention alg, got: \(result.reason)")
  }

  func testVerifyJWTRejectsAlgES384() throws {
    let credentialJWT = try issuedCredentialJWT()
    let mutated = swapHeaderAlg(of: credentialJWT, to: "ES384")
    let result = ProofVerifierService.shared.verifyVpToken(mutated)
    XCTAssertFalse(result.isValid)
    XCTAssertEqual(result.status, .failed)
  }

  func testVerifyJWTRejectsAlgHS256() throws {
    let credentialJWT = try issuedCredentialJWT()
    let mutated = swapHeaderAlg(of: credentialJWT, to: "HS256")
    let result = ProofVerifierService.shared.verifyVpToken(mutated)
    XCTAssertFalse(result.isValid)
    XCTAssertEqual(result.status, .failed)
  }

  func testEmbeddedJWKFallbackRejectsNonDIDKeyIssuer() throws {
    // FIX 1: even though `did:web:...` may collide with a JWK-derived
    // `did:key:...` and trip the equality check, the fallback path must
    // be blocked at the method check itself — only `iss` values starting
    // with `did:key:` may use the embedded-JWK self-consistency fallback.
    let credentialJWT = try issuedCredentialJWT(issuerDid: "did:web:attacker.example")
    let result = ProofVerifierService.shared.verifyVpToken(credentialJWT)
    XCTAssertFalse(result.isValid)
    XCTAssertEqual(result.status, .failed)
    XCTAssertTrue(result.reason.lowercased().contains("untrusted")
                  || result.reason.lowercased().contains("issuer")
                  || result.reason.lowercased().contains("alg"),
                  "Unexpected reason: \(result.reason)")
  }

  private func tamperPayload(of jwt: String) -> String {
    let parts = jwt.split(separator: ".")
    guard parts.count == 3 else { return jwt }
    guard var payloadData = Data(base64URLEncoded: String(parts[1])), !payloadData.isEmpty else { return jwt }
    payloadData[payloadData.startIndex] ^= 0x01
    let payload = payloadData.base64URLEncodedString()
    return "\(parts[0]).\(payload).\(parts[2])"
  }

  /// Swap the JWT header `alg` and re-pack. Signature is left as-is — for
  /// these tests we only care that the alg-pin trips before the crypto.
  private func swapHeaderAlg(of jwt: String, to newAlg: String) -> String {
    let parts = jwt.split(separator: ".")
    guard parts.count == 3,
          let headerData = Data(base64URLEncoded: String(parts[0])),
          var headerJson = try? JSONSerialization.jsonObject(with: headerData) as? [String: Any]
    else { return jwt }
    headerJson["alg"] = newAlg
    guard let mutatedHeader = try? JSONSerialization.data(withJSONObject: headerJson, options: [.sortedKeys])
    else { return jwt }
    return "\(mutatedHeader.base64URLEncodedString()).\(parts[1]).\(parts[2])"
  }
}
