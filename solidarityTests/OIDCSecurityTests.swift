import Foundation
import XCTest
@testable import solidarity

/// Coverage for the OIDC-side security fixes:
///   - PKCE is mandatory at parse time (RFC 7636 + OAuth 2.1).
///   - The token endpoint refuses to mint tokens when the registered
///     challenge is missing (programming-error path).
///   - `buildResponseURL` is anchored to the parsed `redirect_uri` — no
///     caller-supplied open-redirect.
///   - The c_nonce sanity heuristic on credential issuance.
final class OIDCSecurityTests: XCTestCase {

  // MARK: - PKCE Enforcement

  @MainActor
  func testParseAuthorizationRequestRejectsMissingPKCE() {
    let url = URL(string:
      "openid://authorize?client_id=demo&redirect_uri=https://app.example.com/cb" +
      "&state=s1&nonce=n1&scope=preferences")!
    XCTAssertThrowsError(try OIDCRequestHandler.shared.parseAuthorizationRequest(from: url)) { error in
      guard case OIDCError.invalidRequest(let message) = error else {
        XCTFail("Expected OIDCError.invalidRequest, got \(error)")
        return
      }
      XCTAssertTrue(message.lowercased().contains("pkce"),
                    "Expected PKCE message, got: \(message)")
    }
  }

  @MainActor
  func testParseAuthorizationRequestRejectsPlainPKCE() {
    let url = URL(string:
      "openid://authorize?client_id=demo&redirect_uri=https://app.example.com/cb" +
      "&state=s1&nonce=n1&scope=preferences" +
      "&code_challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
      "&code_challenge_method=plain")!
    XCTAssertThrowsError(try OIDCRequestHandler.shared.parseAuthorizationRequest(from: url)) { error in
      guard case OIDCError.invalidRequest = error else {
        XCTFail("Expected OIDCError.invalidRequest, got \(error)")
        return
      }
    }
  }

  @MainActor
  func testParseAuthorizationRequestAcceptsS256() throws {
    // Spec-compliant request. Random-looking 43-char base64url challenge.
    let url = URL(string:
      "openid://authorize?client_id=demo&redirect_uri=https://app.example.com/cb" +
      "&state=s1&nonce=n1&scope=preferences" +
      "&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" +
      "&code_challenge_method=S256")!
    let request = try OIDCRequestHandler.shared.parseAuthorizationRequest(from: url)
    XCTAssertEqual(request.codeChallengeMethod, "S256")
    XCTAssertFalse(request.codeChallenge.isEmpty)
  }

  // MARK: - Token Endpoint PKCE Failure Mode

  func testExchangeCodeFailsWithoutRegisteredChallenge() {
    let svc = OIDCTokenService()
    let request = OIDCAuthorizationRequest(
      id: UUID(),
      clientId: "demo",
      redirectUri: "https://app.example.com/cb",
      state: "state-1",
      nonce: "nonce-1",
      scopes: [.preferences],
      presentationDefinition: nil,
      requestedAt: Date(),
      codeChallenge: "ignored",
      codeChallengeMethod: "S256"
    )
    // Mint a code WITHOUT a challenge (simulating a buggy caller).
    let code = svc.generateAuthorizationCode(
      for: request,
      grantedScopes: [.preferences],
      codeChallenge: nil,
      codeChallengeMethod: nil
    )

    XCTAssertThrowsError(try svc.exchangeCode(
      code,
      clientId: "demo",
      redirectUri: "https://app.example.com/cb",
      codeVerifier: "any-verifier-xxxxxxxxxxxxxxxxxxxxxxxx"
    )) { error in
      guard let tokErr = error as? OIDCTokenError else {
        XCTFail("Expected OIDCTokenError, got \(error)")
        return
      }
      XCTAssertEqual(tokErr, .pkceFailed)
    }
  }

  // MARK: - Open Redirect Defence

  @MainActor
  func testBuildResponseURLRejectsForeignRedirect() async throws {
    let url = URL(string:
      "openid://authorize?client_id=demo&redirect_uri=https://app.example.com/cb" +
      "&state=s2&nonce=n2&scope=preferences" +
      "&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" +
      "&code_challenge_method=S256")!
    let request = try OIDCRequestHandler.shared.parseAuthorizationRequest(from: url)
    let response = try await OIDCRequestHandler.shared.handlePermissionDecision(
      request: request,
      decision: .approved,
      grantedScopes: [.preferences]
    )

    XCTAssertThrowsError(try OIDCRequestHandler.shared.buildResponseURL(
      for: response,
      request: request,
      originalRedirectUri: "https://attacker.example.com/steal"
    )) { error in
      guard case OIDCError.invalidRequest(let message) = error else {
        XCTFail("Expected OIDCError.invalidRequest, got \(error)")
        return
      }
      XCTAssertTrue(message.lowercased().contains("redirect"),
                    "Expected redirect message, got: \(message)")
    }
  }

  @MainActor
  func testBuildResponseURLAcceptsRegisteredRedirect() async throws {
    let url = URL(string:
      "openid://authorize?client_id=demo&redirect_uri=https://app.example.com/cb" +
      "&state=s3&nonce=n3&scope=preferences" +
      "&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" +
      "&code_challenge_method=S256")!
    let request = try OIDCRequestHandler.shared.parseAuthorizationRequest(from: url)
    let response = try await OIDCRequestHandler.shared.handlePermissionDecision(
      request: request,
      decision: .approved,
      grantedScopes: [.preferences]
    )

    let result = try OIDCRequestHandler.shared.buildResponseURL(
      for: response,
      request: request,
      originalRedirectUri: "https://app.example.com/cb"
    )
    XCTAssertEqual(result.host, "app.example.com")
    let comps = URLComponents(url: result, resolvingAgainstBaseURL: false)
    XCTAssertEqual(comps?.queryItems?.first(where: { $0.name == "state" })?.value, "s3")
    XCTAssertNotNil(comps?.queryItems?.first(where: { $0.name == "code" })?.value)
  }

  // MARK: - Random-token heuristic (FIX 5)

  func testLooksLikeRandomTokenAcceptsBase64URL() {
    XCTAssertTrue(CredentialIssuanceService.looksLikeRandomToken(
      "abcdefghijklmnop"))
    XCTAssertTrue(CredentialIssuanceService.looksLikeRandomToken(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"))
  }

  func testLooksLikeRandomTokenRejectsShort() {
    XCTAssertFalse(CredentialIssuanceService.looksLikeRandomToken("short"))
    XCTAssertFalse(CredentialIssuanceService.looksLikeRandomToken(""))
  }

  func testLooksLikeRandomTokenRejectsForbiddenChars() {
    XCTAssertFalse(CredentialIssuanceService.looksLikeRandomToken(
      "this has spaces..............."))
    XCTAssertFalse(CredentialIssuanceService.looksLikeRandomToken(
      "with/slash+plus===needslong"))
  }
}
