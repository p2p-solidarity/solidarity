import CryptoKit
import Foundation

struct PassportMRZDraft: Equatable {
  var passportNumber: String
  var nationalityCode: String
  var dateOfBirth: Date
  var expiryDate: Date
}

struct PassportChipSnapshot: Equatable {
  let documentHash: String
  let mrzDigest: String
  let dg1MRZData: String
  let chipUID: String
  let bacVerified: Bool
  let paceVerified: Bool
  let passiveAuthPassed: Bool
  let isSimulated: Bool
  let readAt: Date

  // Displayable fields parsed from chip MRZ (DG1)
  let nationalityCode: String
  let maskedDocNumber: String
  let dataGroupsRead: [String]
}

struct PassportProofResult: Equatable {
  let proofType: String
  let proofPayload: String
  let trustLevel: String
  let generationFailed: Bool
}

final class PassportPipelineService {
  static let shared = PassportPipelineService()
  private init() {}

  @MainActor func validateMRZ(_ draft: PassportMRZDraft) -> CardResult<Void> {
    let passport = draft.passportNumber.trimmingCharacters(in: .whitespacesAndNewlines)
    let nationality = draft.nationalityCode.trimmingCharacters(in: .whitespacesAndNewlines)

    guard passport.count >= 6 else {
      return .failure(.validationError("Passport number is too short."))
    }
    guard nationality.count == 3 else {
      return .failure(.validationError("Nationality code must be 3 letters."))
    }
    guard draft.expiryDate > Date() else {
      return .failure(.validationError("Passport appears to be expired."))
    }
    return .success(())
  }

  @MainActor func readNFCChip(from draft: PassportMRZDraft) async -> CardResult<PassportChipSnapshot> {
    switch validateMRZ(draft) {
    case .failure(let error):
      return .failure(error)
    case .success:
      break
    }

    logPipelineConfiguration()

    if shouldSimulateNFC {
      print("[PassportPipeline] NFC read: using simulator/dev-mode simulated read")
      return await simulatedNFCRead(draft: draft)
    }

    #if !targetEnvironment(simulator)
    return await realNFCRead(draft: draft)
    #else
    return await simulatedNFCRead(draft: draft)
    #endif
  }

  /// Generate proof using Mopro (OpenPassport Noir) → Semaphore → SD-JWT fallback chain.
  func generateProof(
    chip: PassportChipSnapshot,
    draft: PassportMRZDraft,
    onProgress: @escaping @Sendable (String) -> Void
  ) async -> CardResult<PassportProofResult> {
    // Force passive-auth=false for simulated chips. Synthetic chip data
    // cannot satisfy CSCA → DSC → SOD validation; surface this in the
    // proof inputs so downstream trust decisions don't see a green badge
    // backed by dev-mode data.
    let effectivePassiveAuth = chip.isSimulated ? false : chip.passiveAuthPassed

    do {
      let output = try await MoproProofService.shared.generatePassportProof(
        documentHash: chip.documentHash,
        mrzDigest: chip.mrzDigest,
        dg1MRZData: chip.dg1MRZData,
        nationalityCode: draft.nationalityCode,
        dateOfBirth: draft.dateOfBirth,
        expiryDate: draft.expiryDate,
        passiveAuthPassed: effectivePassiveAuth,
        onProgress: onProgress
      )

      // For simulated chips, override trustLevel to "white" (selfIssued tier).
      // Trust level lives on the credential too; we lock both ends here.
      let effectiveTrustLevel = chip.isSimulated ? "white" : output.trustLevel

      return .success(
        PassportProofResult(
          proofType: output.proofType,
          proofPayload: output.proofJSON,
          trustLevel: effectiveTrustLevel,
          generationFailed: output.proofType == "sd-jwt-fallback"
        )
      )
    } catch let error as MoproProofError {
      // Surface MRZ mismatch (and any future structured proof errors) to the
      // user via the standard alert path so they re-scan the MRZ.
      return .failure(.validationError(error.errorDescription ?? "Passport proof generation failed."))
    } catch {
      return .failure(.configurationError("Passport proof generation failed: \(error.localizedDescription)"))
    }
  }

  @MainActor func persistPassportCredential(
    draft: PassportMRZDraft,
    proof: PassportProofResult,
    chip: PassportChipSnapshot? = nil
  ) -> CardResult<IdentityCardEntity> {
    let holderDid = DIDService().currentDescriptor()
    let didValue: String
    switch holderDid {
    case .success(let descriptor):
      didValue = descriptor.did
    case .failure:
      didValue = "did:key:pending"
    }

    // Simulated chip data must NOT be persisted as a government-tier
    // credential — it would be indistinguishable from a real passport
    // VC at presentation time. Demote to selfIssued / white tier.
    let isSimulated = chip?.isSimulated ?? false
    let issuerType = isSimulated ? "selfIssued" : "government"
    let trustLevel = isSimulated ? "white" : proof.trustLevel
    var metadataTags: [String] = ["passport", proof.proofType]
    if isSimulated {
      metadataTags.append("isSimulated:true")
      metadataTags.append("dev-build")
    }

    let issuerDid: String
    if isSimulated {
      issuerDid = "did:dev:simulated-passport"
    } else {
      issuerDid = "did:gov:\(draft.nationalityCode.lowercased())"
    }

    let passportCard = IdentityCardEntity(
      type: "passport",
      issuerType: issuerType,
      trustLevel: trustLevel,
      title: isSimulated
        ? "Passport \(draft.nationalityCode.uppercased()) (DEV BUILD)"
        : "Passport \(draft.nationalityCode.uppercased())",
      issuerDid: issuerDid,
      holderDid: didValue,
      issuedAt: Date(),
      expiresAt: draft.expiryDate,
      status: proof.generationFailed ? "fallback" : (isSimulated ? "simulated" : "verified"),
      sourceReference: isSimulated ? "MRZ+NFC(simulated)" : "MRZ+NFC",
      rawCredentialJWT: proof.proofPayload,
      metadataTags: metadataTags
    )

    IdentityDataStore.shared.addIdentityCard(passportCard)

    // Claims reference the card ID for proof lookup — the full proof data
    // lives in passportCard.rawCredentialJWT, not duplicated here.
    let cardRef = ",\"identity_card_id\":\"\(passportCard.id)\""
    let simRef = isSimulated ? ",\"is_simulated\":true" : ""

    let ageClaim = ProvableClaimEntity(
      identityCardId: passportCard.id,
      claimType: "age_over_18",
      title: "I am over 18",
      issuerType: issuerType,
      trustLevel: trustLevel,
      source: "Passport",
      payload: "{\"claim\":\"age_over_18\",\"proof\":\"\(proof.proofType)\"\(cardRef)\(simRef)}"
    )
    IdentityDataStore.shared.addProvableClaim(ageClaim)

    let humanClaim = ProvableClaimEntity(
      identityCardId: passportCard.id,
      claimType: "is_human",
      title: "I am a real person",
      issuerType: issuerType,
      trustLevel: trustLevel,
      source: "Passport",
      payload: "{\"claim\":\"is_human\",\"proof\":\"\(proof.proofType)\"\(cardRef)\(simRef)}"
    )
    IdentityDataStore.shared.addProvableClaim(humanClaim)

    // Field-level claim — passport DG1 binds a name to this holder.
    // sourceField lets VerifiedClaimIndex answer "is name verified?" so
    // when the user issues a self-card VC the name is index-verified
    // (L3 government) instead of L1 self-attested.
    let nameClaim = ProvableClaimEntity(
      identityCardId: passportCard.id,
      claimType: "field_name",
      title: isSimulated ? "Name (dev-mode passport)" : "Name verified by passport",
      issuerType: issuerType,
      trustLevel: trustLevel,
      source: "Passport",
      payload: "{\"claim\":\"field_name\",\"proof\":\"\(proof.proofType)\"\(cardRef)\(simRef)}",
      sourceField: BusinessCardField.name.rawValue
    )
    IdentityDataStore.shared.addProvableClaim(nameClaim)

    return .success(passportCard)
  }

  // MARK: - Private

  private func logPipelineConfiguration() {
    let openPassportEnabled = MoproProofService.isAvailable

    let hasMasterList = Bundle.main.url(forResource: "masterList", withExtension: "pem") != nil
    let hasCircuit = Bundle.main.path(forResource: "openpassport_disclosure", ofType: "acir") != nil
      || Bundle.main.path(forResource: "openpassport_disclosure", ofType: "json") != nil
      || Bundle.main.path(forResource: "disclosure", ofType: "json") != nil
    let hasSRS = Bundle.main.path(forResource: "openpassport_srs", ofType: "bin") != nil

    #if targetEnvironment(simulator)
    let environmentName = "simulator"
    #else
    let environmentName = "device"
    #endif

    print("""
    [PassportPipeline] ── configuration ──
      environment:              \(environmentName)
      OpenPassport available:    \(openPassportEnabled)
      masterList.pem in bundle: \(hasMasterList)
      disclosure circuit:       \(hasCircuit)
      SRS file:                 \(hasSRS)
    """)

    #if targetEnvironment(simulator)
    print("[PassportPipeline] running on simulator — NFC will use simulated read")
    #endif
    if !openPassportEnabled {
      print("[PassportPipeline] ⚠ OpenPassport ZK unavailable (missing circuit/SRS files) — proof will fall back to Semaphore → SD-JWT")
    }
    #if !targetEnvironment(simulator)
    if !hasMasterList {
      print("[PassportPipeline] ⚠ masterList.pem missing — passiveAuthPassed will always be false (cannot verify passport authenticity)")
    }
    #endif
  }

  @MainActor private var shouldSimulateNFC: Bool {
    #if targetEnvironment(simulator)
    return true
    #else
    return DeveloperModeManager.shared.isDeveloperMode && DeveloperModeManager.shared.simulateNFC
    #endif
  }

  private func simulatedNFCRead(draft: PassportMRZDraft) async -> CardResult<PassportChipSnapshot> {
    do {
      try await Task.sleep(nanoseconds: 1_300_000_000)
    } catch {
      return .failure(.configurationError("NFC read cancelled"))
    }

    let syntheticMRZ = syntheticMRZ(from: draft)
    let digest = SHA256.hash(data: Data(syntheticMRZ.utf8))
    let digestHex = digest.map { String(format: "%02x", $0) }.joined()

    let raw = draft.passportNumber
    let masked = raw.count > 3 ? String(raw.prefix(2)) + String(repeating: "*", count: raw.count - 3) + String(raw.suffix(1)) : raw

    return .success(
      PassportChipSnapshot(
        documentHash: digestHex,
        mrzDigest: digestHex,
        dg1MRZData: syntheticMRZ,
        chipUID: "SIM-\(String(digestHex.prefix(8)).uppercased())",
        bacVerified: true,
        paceVerified: false,
        passiveAuthPassed: false,
        isSimulated: true,
        readAt: Date(),
        nationalityCode: draft.nationalityCode,
        maskedDocNumber: masked,
        dataGroupsRead: ["DG1 (sim)"]
      )
    )
  }

  #if !targetEnvironment(simulator)
  private nonisolated func realNFCRead(draft: PassportMRZDraft) async -> CardResult<PassportChipSnapshot> {
    let dateFormatter = DateFormatter()
    dateFormatter.dateFormat = "yyMMdd"
    dateFormatter.locale = Locale(identifier: "en_US_POSIX")

    let reader = NFCPassportReaderService()
    do {
      let result = try await reader.read(
        passportNumber: draft.passportNumber.trimmingCharacters(in: .whitespacesAndNewlines),
        dateOfBirth: dateFormatter.string(from: draft.dateOfBirth),
        expiryDate: dateFormatter.string(from: draft.expiryDate)
      )

      // Use chip-signed MRZ data for digest, falling back to draft only if chip MRZ is empty
      let mrzSource: String
      if !result.dg1MRZData.isEmpty {
        mrzSource = result.dg1MRZData
      } else {
        mrzSource = "\(draft.passportNumber)|\(draft.nationalityCode)|\(draft.dateOfBirth.timeIntervalSince1970)|\(draft.expiryDate.timeIntervalSince1970)"
      }
      let mrzDigest = SHA256.hash(data: Data(mrzSource.utf8))
      let mrzDigestHex = mrzDigest.map { String(format: "%02x", $0) }.joined()

      // Parse nationality and document number from chip MRZ for display
      let parsedNationality: String
      let parsedDocNumber: String
      let chipMRZ = result.dg1MRZData
      if chipMRZ.count >= 44 {
        // TD3 line 2: positions 10-12 = nationality, positions 0-8 = document number
        let line2Start = chipMRZ.count > 88 ? chipMRZ.index(chipMRZ.startIndex, offsetBy: 44) : chipMRZ.startIndex
        let natStart = chipMRZ.index(line2Start, offsetBy: 10, limitedBy: chipMRZ.endIndex) ?? chipMRZ.endIndex
        let natEnd = chipMRZ.index(line2Start, offsetBy: 13, limitedBy: chipMRZ.endIndex) ?? chipMRZ.endIndex
        parsedNationality = natStart < natEnd ? String(chipMRZ[natStart..<natEnd]).replacingOccurrences(of: "<", with: "") : draft.nationalityCode
        let docEnd = chipMRZ.index(line2Start, offsetBy: 9, limitedBy: chipMRZ.endIndex) ?? chipMRZ.endIndex
        let rawDoc = String(chipMRZ[line2Start..<docEnd]).replacingOccurrences(of: "<", with: "")
        parsedDocNumber = rawDoc.count > 3 ? String(rawDoc.prefix(2)) + String(repeating: "*", count: rawDoc.count - 3) + String(rawDoc.suffix(1)) : rawDoc
      } else {
        parsedNationality = draft.nationalityCode
        let raw = draft.passportNumber
        parsedDocNumber = raw.count > 3 ? String(raw.prefix(2)) + String(repeating: "*", count: raw.count - 3) + String(raw.suffix(1)) : raw
      }

      return .success(
        PassportChipSnapshot(
          documentHash: result.rawDataHash,
          mrzDigest: mrzDigestHex,
          dg1MRZData: chipMRZ,
          chipUID: result.chipUID,
          bacVerified: result.bacSucceeded,
          paceVerified: result.paceSucceeded,
          passiveAuthPassed: result.passiveAuthPassed,
          isSimulated: false,
          readAt: result.readAt,
          nationalityCode: parsedNationality,
          maskedDocNumber: parsedDocNumber,
          dataGroupsRead: ["COM", "SOD", "DG1", "DG2", "DG14", "DG15"]
        )
      )
    } catch let error as NFCPassportReaderService.NFCError {
      if case .cancelled = error {
        return .failure(.configurationError("NFC read cancelled"))
      }
      return .failure(.configurationError(error.errorDescription ?? "NFC read failed"))
    } catch {
      return .failure(.configurationError("NFC read failed: \(error.localizedDescription)"))
    }
  }
  #endif

  private func syntheticMRZ(from draft: PassportMRZDraft) -> String {
    let nationality = sanitizeICAOCode(draft.nationalityCode)
    let dob = yyMMdd(from: draft.dateOfBirth)
    let expiry = yyMMdd(from: draft.expiryDate)

    let line1Prefix = "P<\(nationality)"
    let line1 = String((line1Prefix + String(repeating: "<", count: 44)).prefix(44))

    var line2 = Array(repeating: Character("<"), count: 44)
    for (index, character) in nationality.enumerated() {
      line2[10 + index] = character
    }
    for (index, character) in dob.enumerated() {
      line2[13 + index] = character
    }
    for (index, character) in expiry.enumerated() {
      line2[21 + index] = character
    }

    return line1 + String(line2)
  }

  private func sanitizeICAOCode(_ value: String) -> String {
    let cleaned = value
      .uppercased()
      .filter { $0.isLetter || $0 == "<" }
    return String((cleaned + "<<<").prefix(3))
  }

  private func yyMMdd(from date: Date) -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyMMdd"
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    return formatter.string(from: date)
  }
}
