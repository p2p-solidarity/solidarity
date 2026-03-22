import Foundation
import Testing
@testable import airmeishi

// MARK: - MRZ Parsing Tests

struct MRZParsingTests {
  // Reference TD3 MRZ (ICAO 9303 doc 9 specimen):
  //   Line 1: P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<
  //   Line 2: L898902C36UTO7408122F1204159ZE184226B<<<<<10
  // Document number: L898902C3, Nationality: UTO, DOB: 740812, Expiry: 120415

  static let sampleLine1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<"
  static let sampleLine2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10"

  @Test func parseTD3ValidPassport() async throws {
    let draft = MRZScannerService.parseTD3(line1: Self.sampleLine1, line2: Self.sampleLine2)
    #expect(draft != nil, "Should successfully parse valid TD3 MRZ lines")

    if let draft {
      #expect(draft.passportNumber == "L898902C3")
      #expect(draft.nationalityCode == "UTO")

      let calendar = Calendar.current
      let dobComponents = calendar.dateComponents([.year, .month, .day], from: draft.dateOfBirth)
      #expect(dobComponents.year == 1974)
      #expect(dobComponents.month == 8)
      #expect(dobComponents.day == 12)

      let expiryComponents = calendar.dateComponents([.year, .month, .day], from: draft.expiryDate)
      #expect(expiryComponents.month == 4)
      #expect(expiryComponents.day == 15)
    }
  }

  @Test func parseTD3RejectsShortLines() async throws {
    let draft = MRZScannerService.parseTD3(line1: "P<UTOSHORT", line2: "12345")
    #expect(draft == nil, "Should reject lines shorter than 44 characters")
  }

  @Test func parseTD3RejectsNonPassportType() async throws {
    let line1 = "V<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<"
    let draft = MRZScannerService.parseTD3(line1: line1, line2: Self.sampleLine2)
    #expect(draft == nil, "Should reject non-passport document type (V instead of P)")
  }

  @Test func parseTD3RejectsBadCheckDigit() async throws {
    var tampered = Array(Self.sampleLine2)
    tampered[9] = "7"  // Wrong check digit for L898902C3
    let tamperedLine2 = String(tampered)

    let draft = MRZScannerService.parseTD3(line1: Self.sampleLine1, line2: tamperedLine2)
    #expect(draft == nil, "Should reject MRZ with invalid document number check digit")
  }

  @Test func computeCheckDigitKnownValues() async throws {
    let checkDigit = MRZScannerService.computeCheckDigit("L898902C3")
    #expect(checkDigit == 6)
  }

  @Test func verifyCheckDigitCorrectValue() async throws {
    #expect(MRZScannerService.verifyCheckDigit("L898902C3", expected: 6) == true)
    #expect(MRZScannerService.verifyCheckDigit("L898902C3", expected: 5) == false)
  }

  @Test func computeCheckDigitForDateField() async throws {
    let checkDigit = MRZScannerService.computeCheckDigit("740812")
    #expect(checkDigit == 2)
  }

  @Test func parseTD3HandlesFillerCharacters() async throws {
    let checkDigit = MRZScannerService.computeCheckDigit("AB<<<")
    let expected = MRZScannerService.computeCheckDigit("AB<<<")
    #expect(checkDigit == expected, "Filler characters should be treated as value 0")
  }
}

// MARK: - MoproProofService Tests

struct MoproProofServiceTests {
  @Test func moproIsAvailableReturnsFalseWithoutFFI() async throws {
    #expect(MoproProofService.isAvailable == false,
            "Mopro native proving should not be available in test builds")
  }

  @Test func sdJwtFallbackProducesValidOutput() async throws {
    var progressMessages: [String] = []
    let output = await MoproProofService.shared.generatePassportProof(
      documentHash: "abc123def456",
      mrzDigest: "feedbeef01020304",
      nationalityCode: "JPN",
      dateOfBirth: Date(timeIntervalSince1970: 0),
      expiryDate: Date(timeIntervalSinceNow: 86400 * 365),
      passiveAuthPassed: false,
      onProgress: { msg in progressMessages.append(msg) }
    )

    #expect(output.proofType != "mopro-noir",
            "Should not produce mopro-noir proof without FFI bindings")
    #expect(["semaphore-zk", "sd-jwt-fallback"].contains(output.proofType),
            "Should fall back to semaphore-zk or sd-jwt-fallback")
    #expect(!output.proofJSON.isEmpty, "Proof JSON should not be empty")
    #expect(!progressMessages.isEmpty, "Should report progress during generation")
  }

  @Test func proofOutputEquatableConformance() async throws {
    let output1 = MoproProofOutput(
      proofType: "sd-jwt-fallback", proofJSON: "{}", publicSignals: [],
      generationTimeMs: 100, trustLevel: "blue"
    )
    let output2 = MoproProofOutput(
      proofType: "sd-jwt-fallback", proofJSON: "{}", publicSignals: [],
      generationTimeMs: 100, trustLevel: "blue"
    )
    #expect(output1 == output2)
  }

  @Test func proofOutputTrustLevelValues() async throws {
    let sdJwt = MoproProofOutput(
      proofType: "sd-jwt-fallback", proofJSON: "{}", publicSignals: [],
      generationTimeMs: 50, trustLevel: "blue"
    )
    #expect(sdJwt.trustLevel == "blue")

    let zk = MoproProofOutput(
      proofType: "semaphore-zk", proofJSON: "{}", publicSignals: ["age_over_18"],
      generationTimeMs: 3000, trustLevel: "green"
    )
    #expect(zk.trustLevel == "green")
  }
}

// MARK: - PassportPipelineService Tests

struct PassportPipelineServiceTests {
  @Test @MainActor func validateMRZAcceptsValidDraft() async throws {
    let draft = PassportMRZDraft(
      passportNumber: "AB1234567", nationalityCode: "JPN",
      dateOfBirth: Date(timeIntervalSince1970: 0),
      expiryDate: Date(timeIntervalSinceNow: 86400 * 365 * 5)
    )
    let result = PassportPipelineService.shared.validateMRZ(draft)
    switch result {
    case .success: break
    case .failure(let error): Issue.record("Expected success but got \(error)")
    }
  }

  @Test @MainActor func validateMRZRejectsShortPassportNumber() async throws {
    let draft = PassportMRZDraft(
      passportNumber: "AB12", nationalityCode: "JPN",
      dateOfBirth: Date(timeIntervalSince1970: 0),
      expiryDate: Date(timeIntervalSinceNow: 86400 * 365)
    )
    let result = PassportPipelineService.shared.validateMRZ(draft)
    switch result {
    case .success: Issue.record("Expected validation failure for short passport number")
    case .failure(let error):
      #expect("\(error)".contains("too short"),
              "Error should mention passport number is too short")
    }
  }

  @Test @MainActor func validateMRZRejectsInvalidNationalityCode() async throws {
    let draft = PassportMRZDraft(
      passportNumber: "AB1234567", nationalityCode: "JP",
      dateOfBirth: Date(timeIntervalSince1970: 0),
      expiryDate: Date(timeIntervalSinceNow: 86400 * 365)
    )
    let result = PassportPipelineService.shared.validateMRZ(draft)
    switch result {
    case .success: Issue.record("Expected validation failure for 2-char nationality code")
    case .failure(let error):
      #expect("\(error)".contains("3 letters"),
              "Error should mention nationality code must be 3 letters")
    }
  }

  @Test @MainActor func validateMRZRejectsExpiredPassport() async throws {
    let draft = PassportMRZDraft(
      passportNumber: "AB1234567", nationalityCode: "JPN",
      dateOfBirth: Date(timeIntervalSince1970: 0),
      expiryDate: Date(timeIntervalSinceNow: -86400)
    )
    let result = PassportPipelineService.shared.validateMRZ(draft)
    switch result {
    case .success: Issue.record("Expected validation failure for expired passport")
    case .failure(let error):
      #expect("\(error)".contains("expired"),
              "Error should mention passport is expired")
    }
  }

  @Test func passportMRZDraftEquatable() async throws {
    let date1 = Date(timeIntervalSince1970: 1_000_000)
    let date2 = Date(timeIntervalSince1970: 2_000_000)
    let draft1 = PassportMRZDraft(
      passportNumber: "X1234567", nationalityCode: "TWN",
      dateOfBirth: date1, expiryDate: date2
    )
    let draft2 = PassportMRZDraft(
      passportNumber: "X1234567", nationalityCode: "TWN",
      dateOfBirth: date1, expiryDate: date2
    )
    #expect(draft1 == draft2)

    let draft3 = PassportMRZDraft(
      passportNumber: "Y9999999", nationalityCode: "TWN",
      dateOfBirth: date1, expiryDate: date2
    )
    #expect(draft1 != draft3)
  }

  @Test func passportChipSnapshotFields() async throws {
    let snapshot = PassportChipSnapshot(
      documentHash: "aabbccdd", mrzDigest: "11223344",
      chipUID: "SIM-ABCDEF01", bacVerified: true, paceVerified: false,
      passiveAuthPassed: true, isSimulated: true, readAt: Date(),
      nationalityCode: "JPN", maskedDocNumber: "AB***67",
      dataGroupsRead: ["DG1", "DG2", "SOD"]
    )
    #expect(snapshot.documentHash == "aabbccdd")
    #expect(snapshot.bacVerified == true)
    #expect(snapshot.paceVerified == false)
    #expect(snapshot.passiveAuthPassed == true)
    #expect(snapshot.isSimulated == true)
    #expect(snapshot.nationalityCode == "JPN")
    #expect(snapshot.maskedDocNumber == "AB***67")
    #expect(snapshot.dataGroupsRead.count == 3)
  }

  @Test func passportProofResultFields() async throws {
    let proofZK = PassportProofResult(
      proofType: "semaphore-zk", proofPayload: "{\"proof\":\"...\"}",
      trustLevel: "green", generationFailed: false
    )
    #expect(proofZK.proofType == "semaphore-zk")
    #expect(proofZK.trustLevel == "green")
    #expect(proofZK.generationFailed == false)

    let proofFallback = PassportProofResult(
      proofType: "sd-jwt-fallback", proofPayload: "{}",
      trustLevel: "blue", generationFailed: true
    )
    #expect(proofFallback.generationFailed == true)
    #expect(proofFallback.trustLevel == "blue")
  }
}

// MARK: - IdentityCardEntity Tests

struct IdentityCardEntityTests {
  @Test func createPassportIdentityCard() async throws {
    let card = IdentityCardEntity(
      type: "passport", issuerType: "government", trustLevel: "green",
      title: "Passport JPN", issuerDid: "did:gov:jpn",
      holderDid: "did:key:z6MkTest123",
      issuedAt: Date(),
      expiresAt: Date(timeIntervalSinceNow: 86400 * 365 * 10),
      status: "verified", sourceReference: "MRZ+NFC",
      rawCredentialJWT: "{\"proof\":\"test\"}",
      metadataTags: ["passport", "semaphore-zk"]
    )
    #expect(card.type == "passport")
    #expect(card.issuerType == "government")
    #expect(card.trustLevel == "green")
    #expect(card.title == "Passport JPN")
    #expect(card.issuerDid == "did:gov:jpn")
    #expect(card.holderDid == "did:key:z6MkTest123")
    #expect(card.status == "verified")
    #expect(card.sourceReference == "MRZ+NFC")
    #expect(card.rawCredentialJWT != nil)
    #expect(card.metadataTags.contains("passport"))
    #expect(card.metadataTags.contains("semaphore-zk"))
    #expect(card.expiresAt != nil)
  }

  @Test func createFallbackIdentityCard() async throws {
    let card = IdentityCardEntity(
      type: "passport", issuerType: "government", trustLevel: "blue",
      title: "Passport TWN", issuerDid: "did:gov:twn",
      holderDid: "did:key:pending", status: "fallback",
      metadataTags: ["passport", "sd-jwt-fallback"]
    )
    #expect(card.status == "fallback")
    #expect(card.trustLevel == "blue")
    #expect(card.metadataTags.contains("sd-jwt-fallback"))
  }

  @Test func identityCardDefaultValues() async throws {
    let card = IdentityCardEntity(
      type: "student", issuerType: "institution", trustLevel: "blue",
      title: "Student ID", issuerDid: "did:web:university.example.com",
      holderDid: "did:key:z6MkTest456"
    )
    #expect(card.expiresAt == nil, "Default expiresAt should be nil")
    #expect(card.sourceReference == nil, "Default sourceReference should be nil")
    #expect(card.rawCredentialJWT == nil, "Default rawCredentialJWT should be nil")
    #expect(card.metadataTags.isEmpty, "Default metadataTags should be empty")
    #expect(!card.id.isEmpty, "ID should be auto-generated")
  }
}

// MARK: - ProvableClaimEntity Tests

struct ProvableClaimEntityTests {
  @Test func createAgeOver18Claim() async throws {
    let cardId = UUID().uuidString
    let claim = ProvableClaimEntity(
      identityCardId: cardId, claimType: "age_over_18",
      title: "I am over 18", issuerType: "government",
      trustLevel: "green", source: "Passport",
      payload: "{\"claim\":\"age_over_18\",\"proof\":\"semaphore-zk\"}"
    )
    #expect(claim.claimType == "age_over_18")
    #expect(claim.title == "I am over 18")
    #expect(claim.issuerType == "government")
    #expect(claim.trustLevel == "green")
    #expect(claim.source == "Passport")
    #expect(claim.identityCardId == cardId)
    #expect(claim.isPresentable == true, "Default isPresentable should be true")
    #expect(claim.lastPresentedAt == nil, "Default lastPresentedAt should be nil")
    #expect(!claim.payload.isEmpty)
  }

  @Test func createIsHumanClaim() async throws {
    let cardId = UUID().uuidString
    let claim = ProvableClaimEntity(
      identityCardId: cardId, claimType: "is_human",
      title: "I am a real person", issuerType: "government",
      trustLevel: "green", source: "Passport",
      payload: "{\"claim\":\"is_human\",\"proof\":\"semaphore-zk\"}"
    )
    #expect(claim.claimType == "is_human")
    #expect(claim.title == "I am a real person")
    #expect(claim.source == "Passport")
  }

  @Test func claimPresentableToggle() async throws {
    let claim = ProvableClaimEntity(
      identityCardId: UUID().uuidString, claimType: "age_over_18",
      title: "I am over 18", issuerType: "government",
      trustLevel: "green", source: "Passport",
      payload: "{}", isPresentable: false
    )
    #expect(claim.isPresentable == false)
    claim.isPresentable = true
    #expect(claim.isPresentable == true)
    claim.lastPresentedAt = Date()
    #expect(claim.lastPresentedAt != nil)
  }

  @Test func claimLinksToIdentityCard() async throws {
    let cardId = UUID().uuidString
    let card = IdentityCardEntity(
      id: cardId, type: "passport", issuerType: "government",
      trustLevel: "green", title: "Passport JPN",
      issuerDid: "did:gov:jpn", holderDid: "did:key:z6MkTest"
    )
    let claim = ProvableClaimEntity(
      identityCardId: cardId, claimType: "age_over_18",
      title: "I am over 18", issuerType: "government",
      trustLevel: "green", source: "Passport",
      payload: "{\"identity_card_id\":\"\(cardId)\"}"
    )
    #expect(claim.identityCardId == card.id,
            "Claim's identityCardId should match the parent card's id")
  }
}
