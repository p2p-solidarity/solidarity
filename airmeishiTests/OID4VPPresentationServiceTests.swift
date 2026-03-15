import Foundation
import LocalAuthentication
import XCTest
@testable import airmeishi

final class OID4VPPresentationServiceTests: XCTestCase {
  func testWrapCredentialUsesPairwiseDescriptorForRP() throws {
    let rpDomain = "verifier.example.com"
    let issued = try issueCredential(relyingPartyDomain: rpDomain)

    let result = OID4VPPresentationService.shared.wrapCredentialAsVP(
      vcJwt: issued.jwt,
      options: .init(
        relyingPartyDomain: rpDomain,
        nonce: "nonce-123",
        audience: "did:web:verifier.example.com"
      )
    )

    guard case .success(let vpToken) = result else {
      XCTFail("Expected wrapped VP token")
      return
    }

    let header = try decodeJSONSegment(from: vpToken, index: 0)
    let payload = try decodeJSONSegment(from: vpToken, index: 1)

    let descriptorResult = DIDService().currentDescriptor(for: rpDomain)
    guard case .success(let descriptor) = descriptorResult else {
      XCTFail("Failed to resolve pairwise descriptor")
      return
    }

    XCTAssertEqual(header["kid"] as? String, descriptor.verificationMethodId)
    XCTAssertFalse((header["kid"] as? String)?.hasSuffix("#0") == true)
    XCTAssertEqual(payload["iss"] as? String, descriptor.did)
    XCTAssertEqual(payload["nonce"] as? String, "nonce-123")
    XCTAssertEqual(payload["aud"] as? String, "did:web:verifier.example.com")
  }

  func testWrapCredentialFailsClosedWhenSigningKeyUnavailable() {
    let service = OID4VPPresentationService(keyProvider: AlwaysFailingOID4VPKeyProvider())
    let result = service.wrapCredentialAsVP(vcJwt: "vc.jwt", options: .init(relyingPartyDomain: "rp.example"))

    guard case .failure = result else {
      XCTFail("Expected wrapping to fail when signing key is unavailable")
      return
    }
  }

  private func issueCredential(relyingPartyDomain: String) throws -> VCService.IssuedCredential {
    let card = BusinessCard(name: "OID4VP Tester", email: "oid4vp@example.com")
    let options = VCService.IssueOptions(relyingPartyDomain: relyingPartyDomain)
    let result = VCService().issueBusinessCardCredential(for: card, options: options)
    switch result {
    case .failure(let error):
      throw error
    case .success(let issued):
      return issued
    }
  }

  private func decodeJSONSegment(from jwt: String, index: Int) throws -> [String: Any] {
    let parts = jwt.split(separator: ".")
    XCTAssertGreaterThan(parts.count, index)
    guard parts.indices.contains(index),
      let data = Data(base64URLEncoded: String(parts[index])),
      let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      throw NSError(domain: "OID4VPPresentationServiceTests", code: 1)
    }
    return json
  }
}

private struct AlwaysFailingOID4VPKeyProvider: OID4VPKeyMaterialProviding {
  func descriptor(for relyingPartyDomain: String?, context: LAContext?) -> CardResult<DIDDescriptor> {
    .failure(.keyManagementError("forced descriptor failure"))
  }

  func signingKey(for relyingPartyDomain: String?, context: LAContext?) -> CardResult<BiometricSigningKey> {
    .failure(.keyManagementError("forced signing key failure"))
  }
}
