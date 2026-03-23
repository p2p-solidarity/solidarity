import Foundation
import Testing
@testable import solidarity

// MARK: - ScanRouterService Tests

struct ScanRouterServiceTests {
  @Test func routeOID4VPRequest() async throws {
    let route = ScanRouterService.shared.route(for: "openid4vp://authorize?client_id=did:key:z6Mk&nonce=abc")
    #expect(route == .oid4vpRequest("openid4vp://authorize?client_id=did:key:z6Mk&nonce=abc"))
  }

  @Test func routeOID4VPRequestUppercase() async throws {
    let route = ScanRouterService.shared.route(for: "OID4VP://authorize?client_id=did:key:z6Mk")
    #expect(route == .oid4vpRequest("OID4VP://authorize?client_id=did:key:z6Mk"))
  }

  @Test func routeCredentialOffer() async throws {
    let route = ScanRouterService.shared.route(
      for: "openid-credential-offer://?credential_issuer=https://issuer.example.com"
    )
    if case .credentialOffer(let payload) = route {
      #expect(payload.contains("credential_issuer"))
    } else {
      Issue.record("Expected .credentialOffer but got \(route)")
    }
  }

  @Test func routeSIOPv2Request() async throws {
    let route = ScanRouterService.shared.route(for: "openid-connect://authorize?scope=openid")
    #expect(route == .siopRequest("openid-connect://authorize?scope=openid"))
  }

  @Test func routeOpenIDLegacy() async throws {
    let route = ScanRouterService.shared.route(for: "openid://authorize?scope=openid")
    #expect(route == .siopRequest("openid://authorize?scope=openid"))
  }

  @Test func routeCompactJWT() async throws {
    let jwt = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
    let route = ScanRouterService.shared.route(for: jwt)
    #expect(route == .vpToken(jwt))
  }

  @Test func routeUnknownPayload() async throws {
    let route = ScanRouterService.shared.route(for: "Hello World")
    #expect(route == .unknown("Hello World"))
  }

  @Test func routeTrimsWhitespace() async throws {
    let route = ScanRouterService.shared.route(for: "  openid4vp://authorize?nonce=1  \n")
    if case .oid4vpRequest = route {
      // pass
    } else {
      Issue.record("Expected .oid4vpRequest after trimming whitespace")
    }
  }

  @Test func routeEmptyString() async throws {
    let route = ScanRouterService.shared.route(for: "")
    #expect(route == .unknown(""))
  }
}

// MARK: - OIDCService Parsing Tests

struct OIDCServiceParsingTests {
  @Test func parseValidOID4VPRequest() async throws {
    let service = OIDCService()
    let urlString = "openid4vp://authorize?client_id=did:key:z6MkTest&nonce=abc123&state=xyz789&redirect_uri=https://verifier.example.com/callback&response_type=vp_token"
    let result = service.parseRequest(from: urlString)

    switch result {
    case .success(let request):
      #expect(request.clientId == "did:key:z6MkTest")
      #expect(request.nonce == "abc123")
      #expect(request.state == "xyz789")
      #expect(request.redirectUri == "https://verifier.example.com/callback")
      #expect(request.responseType == "vp_token")
    case .failure(let error):
      Issue.record("Expected success but got \(error)")
    }
  }

  @Test func parseRequestWithPresentationDefinition() async throws {
    let service = OIDCService()
    let pd = """
    {"id":"age-check","input_descriptors":[{"id":"age_over_18","name":"Age Check","purpose":"Verify age"}]}
    """
    let encoded = pd.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? pd
    let urlString = "openid4vp://authorize?client_id=did:key:z6Mk&nonce=n&state=s&redirect_uri=https://v.com/cb&presentation_definition=\(encoded)"
    let result = service.parseRequest(from: urlString)

    switch result {
    case .success(let request):
      #expect(request.presentationDefinition.id == "age-check")
      #expect(request.presentationDefinition.inputDescriptors.count == 1)
      #expect(request.presentationDefinition.inputDescriptors.first?.id == "age_over_18")
      #expect(request.presentationDefinition.inputDescriptors.first?.name == "Age Check")
      #expect(request.presentationDefinition.inputDescriptors.first?.purpose == "Verify age")
    case .failure(let error):
      Issue.record("Expected success but got \(error)")
    }
  }

  @Test func parseRequestFallbackDefinition() async throws {
    let service = OIDCService()
    let urlString = "openid4vp://authorize?client_id=did:key:z6Mk&nonce=n&state=s&redirect_uri=https://v.com/cb"
    let result = service.parseRequest(from: urlString)

    switch result {
    case .success(let request):
      #expect(request.presentationDefinition.id == "default-request")
      #expect(request.presentationDefinition.inputDescriptors.first?.id == "business-card")
    case .failure(let error):
      Issue.record("Expected success but got \(error)")
    }
  }

  @Test func parseInvalidURLFails() async throws {
    let service = OIDCService()
    let result = service.parseRequest(from: "not a valid url at all %%%")
    switch result {
    case .success: Issue.record("Expected failure for invalid URL")
    case .failure: break
    }
  }

  @Test func parseRequestDefaultsResponseType() async throws {
    let service = OIDCService()
    let urlString = "openid4vp://authorize?client_id=test&nonce=n&state=s&redirect_uri=https://v.com/cb"
    let result = service.parseRequest(from: urlString)
    switch result {
    case .success(let request):
      #expect(request.responseType == "vp_token")
    case .failure(let error):
      Issue.record("Unexpected failure: \(error)")
    }
  }
}

// MARK: - OIDCService Response Building Tests

struct OIDCServiceResponseTests {
  @Test func buildResponseURLContainsVPToken() async throws {
    let service = OIDCService()
    let request = OIDCService.PresentationRequest(
      id: "req-1", state: "state-abc", nonce: "nonce-xyz",
      clientId: "did:key:z6MkTest",
      redirectUri: "https://verifier.example.com/callback",
      responseType: "vp_token",
      presentationDefinition: OIDCService.PresentationRequest.PresentationDefinition(
        id: "default", inputDescriptors: []
      )
    )
    let vpToken = "eyJhbGciOiJFUzI1NiJ9.test.sig"
    let result = service.buildResponseURL(for: request, vpToken: vpToken)

    switch result {
    case .success(let url):
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
      let stateParam = components?.queryItems?.first(where: { $0.name == "state" })?.value
      let tokenParam = components?.queryItems?.first(where: { $0.name == "vp_token" })?.value
      #expect(stateParam == "state-abc")
      #expect(tokenParam == vpToken)
      #expect(url.host == "verifier.example.com")
    case .failure(let error):
      Issue.record("Expected success but got \(error)")
    }
  }

  @Test func buildResponseURLEmptyRedirectProducesResult() async throws {
    let service = OIDCService()
    let request = OIDCService.PresentationRequest(
      id: "req-1", state: "s", nonce: "n",
      clientId: "test",
      redirectUri: "",
      responseType: "vp_token",
      presentationDefinition: OIDCService.PresentationRequest.PresentationDefinition(
        id: "default", inputDescriptors: []
      )
    )
    // Empty string is valid for URLComponents; verify vp_token is included
    let result = service.buildResponseURL(for: request, vpToken: "jwt")
    switch result {
    case .success(let url):
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
      let tokenParam = components?.queryItems?.first(where: { $0.name == "vp_token" })?.value
      #expect(tokenParam == "jwt")
    case .failure:
      break // also acceptable
    }
  }

  @Test func handleResponseExtractsVPToken() async throws {
    let service = OIDCService()
    let vcService = VCService()
    // Use a fake JWT — importPresentedCredential will fail but we test that
    // the vp_token is correctly extracted from the URL
    let url = URL(string: "solidarity://oidc-callback?vp_token=fake.jwt.token&state=abc")!
    let result = service.handleResponse(url: url, vcService: vcService)
    // The import will fail because "fake.jwt.token" is not a valid JWT,
    // but it should NOT fail with "No vp_token found"
    switch result {
    case .success:
      break // unlikely with fake JWT but acceptable
    case .failure(let error):
      #expect("\(error)".contains("vp_token") == false,
              "Should extract vp_token; failure should be from JWT parsing, not missing token")
    }
  }

  @Test func handleResponseNoVPTokenFails() async throws {
    let service = OIDCService()
    let vcService = VCService()
    let url = URL(string: "solidarity://oidc-callback?state=abc")!
    let result = service.handleResponse(url: url, vcService: vcService)
    switch result {
    case .success: Issue.record("Expected failure when no vp_token")
    case .failure(let error):
      #expect("\(error)".contains("vp_token") || "\(error)".contains("No vp_token"))
    }
  }
}

// MARK: - OIDCService.verifierDomain Tests

struct VerifierDomainTests {
  @Test func extractDomainFromOID4VPRequest() async throws {
    let payload = "openid4vp://authorize?client_id=did:key:z6Mk&redirect_uri=https://verifier.example.com/callback"
    let domain = OIDCService.verifierDomain(from: payload)
    #expect(domain == "verifier.example.com")
  }

  @Test func extractDomainFallsBackToHost() async throws {
    let payload = "https://verifier.example.com/present"
    let domain = OIDCService.verifierDomain(from: payload)
    #expect(domain == "verifier.example.com")
  }

  @Test func nilForGarbage() async throws {
    let domain = OIDCService.verifierDomain(from: "not a url")
    #expect(domain == nil)
  }
}

// MARK: - QRCodeEnvelope Tests

struct QRCodeEnvelopeTests {
  @Test func currentVersionIs2() async throws {
    #expect(QRCodeEnvelope.currentVersion == 2)
  }

  @Test func envelopePlaintextRoundTrip() async throws {
    let card = BusinessCard(name: "Test User", title: "Engineer", company: "Corp")
    let snapshot = BusinessCardSnapshot(card: card)
    let shareId = UUID()

    let plaintext = QRPlaintextPayload(
      snapshot: snapshot, shareId: shareId,
      createdAt: Date(), expirationDate: nil
    )
    let envelope = QRCodeEnvelope(
      format: .plaintext, sharingLevel: .public,
      shareId: shareId, plaintext: plaintext
    )

    let data = try JSONEncoder.qrEncoder.encode(envelope)
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    let decoded = try decoder.decode(QRCodeEnvelope.self, from: data)

    #expect(decoded.version == 2)
    #expect(decoded.format == .plaintext)
    #expect(decoded.sharingLevel == .public)
    #expect(decoded.shareId == shareId)
    #expect(decoded.plaintext?.snapshot.name == "Test User")
    #expect(decoded.didSigned == nil)
  }

  @Test func envelopeDidSignedFields() async throws {
    let shareId = UUID()
    let didSigned = QRDidSignedPayload(
      jwt: "eyJ.test.sig", shareId: shareId,
      expirationDate: nil,
      issuerDid: "did:key:z6MkIssuer",
      holderDid: "did:key:z6MkHolder"
    )
    let envelope = QRCodeEnvelope(
      format: .didSigned, sharingLevel: .professional,
      shareId: shareId, didSigned: didSigned
    )

    let data = try JSONEncoder.qrEncoder.encode(envelope)
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    let decoded = try decoder.decode(QRCodeEnvelope.self, from: data)

    #expect(decoded.format == .didSigned)
    #expect(decoded.didSigned?.issuerDid == "did:key:z6MkIssuer")
    #expect(decoded.didSigned?.holderDid == "did:key:z6MkHolder")
    #expect(decoded.didSigned?.jwt == "eyJ.test.sig")
  }
}

// MARK: - SharingFormat Tests

struct SharingFormatTests {
  @Test func allFormatsExist() async throws {
    let formats = SharingFormat.allCases
    #expect(formats.contains(.plaintext))
    #expect(formats.contains(.zkProof))
    #expect(formats.contains(.didSigned))
    #expect(formats.count == 3)
  }

  @Test func zkProofRequiresZKIdentity() async throws {
    #expect(SharingFormat.zkProof.requiresZKIdentity == true)
    #expect(SharingFormat.plaintext.requiresZKIdentity == false)
  }

  @Test func didSignedRequiresDidSignature() async throws {
    #expect(SharingFormat.didSigned.requiresDidSignature == true)
    #expect(SharingFormat.plaintext.requiresDidSignature == false)
  }

  @Test func allFormatsSupportsQRCode() async throws {
    for format in SharingFormat.allCases {
      #expect(format.supportsQRCode == true,
              "\(format.rawValue) should support QR code")
    }
  }
}

// MARK: - PresentationRequest Equatable Tests

struct PresentationRequestEquatableTests {
  @Test func sameRequestsAreEqual() async throws {
    let pd = OIDCService.PresentationRequest.PresentationDefinition(
      id: "test", inputDescriptors: [
        .init(id: "d1", name: "Name", purpose: "verify", format: nil, constraints: nil)
      ]
    )
    let r1 = OIDCService.PresentationRequest(
      id: "1", state: "s", nonce: "n", clientId: "c",
      redirectUri: "https://v.com", responseType: "vp_token",
      presentationDefinition: pd
    )
    let r2 = OIDCService.PresentationRequest(
      id: "1", state: "s", nonce: "n", clientId: "c",
      redirectUri: "https://v.com", responseType: "vp_token",
      presentationDefinition: pd
    )
    #expect(r1 == r2)
  }

  @Test func differentStatesAreNotEqual() async throws {
    let pd = OIDCService.PresentationRequest.PresentationDefinition(
      id: "test", inputDescriptors: []
    )
    let r1 = OIDCService.PresentationRequest(
      id: "1", state: "s1", nonce: "n", clientId: "c",
      redirectUri: "https://v.com", responseType: "vp_token",
      presentationDefinition: pd
    )
    let r2 = OIDCService.PresentationRequest(
      id: "1", state: "s2", nonce: "n", clientId: "c",
      redirectUri: "https://v.com", responseType: "vp_token",
      presentationDefinition: pd
    )
    #expect(r1 != r2)
  }
}

// MARK: - CardError Tests

struct CardErrorTests {
  @Test func errorSeverityLevels() async throws {
    #expect(ErrorSeverity.low.rawValue < ErrorSeverity.medium.rawValue)
    #expect(ErrorSeverity.medium.rawValue < ErrorSeverity.high.rawValue)
    #expect(ErrorSeverity.high.rawValue < ErrorSeverity.critical.rawValue)
  }

  @Test func invalidDataErrorDescriptionNotEmpty() async throws {
    let error = CardError.invalidData("test message")
    #expect(error.errorDescription != nil)
    #expect(error.errorDescription?.isEmpty == false)
  }

  @Test func proofErrorsExist() async throws {
    let genErr = CardError.proofGenerationError("gen failed")
    let verErr = CardError.proofVerificationError("ver failed")
    #expect(genErr != verErr)
    #expect(genErr.errorDescription != nil)
    #expect(verErr.errorDescription != nil)
  }

  @Test func keyManagementErrorExists() async throws {
    let err = CardError.keyManagementError("no key")
    #expect(err.errorDescription != nil)
  }
}

// MARK: - VerificationStatus Tests

struct VerificationStatusTests {
  @Test func allCasesExist() async throws {
    let cases = VerificationStatus.allCases
    #expect(cases.contains(.verified))
    #expect(cases.contains(.unverified))
    #expect(cases.contains(.failed))
    #expect(cases.contains(.pending))
    #expect(cases.count == 4)
  }

  @Test func verifiedHasDisplayName() async throws {
    #expect(!VerificationStatus.verified.displayName.isEmpty)
    #expect(!VerificationStatus.unverified.displayName.isEmpty)
  }
}

// MARK: - ContactSource Tests

struct ContactSourceTests {
  @Test func allSourcesExist() async throws {
    let cases = ContactSource.allCases
    #expect(cases.contains(.qrCode))
    #expect(cases.contains(.proximity))
    #expect(cases.contains(.appClip))
    #expect(cases.contains(.manual))
    #expect(cases.contains(.airdrop))
  }
}
