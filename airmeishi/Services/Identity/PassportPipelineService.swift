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

    if shouldSimulateNFC {
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
    let output = await MoproProofService.shared.generatePassportProof(
      documentHash: chip.documentHash,
      mrzDigest: chip.mrzDigest,
      nationalityCode: draft.nationalityCode,
      dateOfBirth: draft.dateOfBirth,
      expiryDate: draft.expiryDate,
      passiveAuthPassed: chip.passiveAuthPassed,
      onProgress: onProgress
    )

    return .success(
      PassportProofResult(
        proofType: output.proofType,
        proofPayload: output.proofJSON,
        trustLevel: output.trustLevel,
        generationFailed: output.proofType == "sd-jwt-fallback"
      )
    )
  }

  @MainActor func persistPassportCredential(
    draft: PassportMRZDraft,
    proof: PassportProofResult
  ) -> CardResult<IdentityCardEntity> {
    let holderDid = DIDService().currentDescriptor()
    let didValue: String
    switch holderDid {
    case .success(let descriptor):
      didValue = descriptor.did
    case .failure:
      didValue = "did:key:pending"
    }

    let passportCard = IdentityCardEntity(
      type: "passport",
      issuerType: "government",
      trustLevel: proof.trustLevel,
      title: "Passport \(draft.nationalityCode.uppercased())",
      issuerDid: "did:gov:\(draft.nationalityCode.lowercased())",
      holderDid: didValue,
      issuedAt: Date(),
      expiresAt: draft.expiryDate,
      status: proof.generationFailed ? "fallback" : "verified",
      sourceReference: "MRZ+NFC",
      rawCredentialJWT: proof.proofPayload,
      metadataTags: ["passport", proof.proofType]
    )

    IdentityDataStore.shared.addIdentityCard(passportCard)

    // Claims reference the card ID for proof lookup — the full proof data
    // lives in passportCard.rawCredentialJWT, not duplicated here.
    let cardRef = ",\"identity_card_id\":\"\(passportCard.id)\""

    let ageClaim = ProvableClaimEntity(
      identityCardId: passportCard.id,
      claimType: "age_over_18",
      title: "I am over 18",
      issuerType: "government",
      trustLevel: proof.trustLevel,
      source: "Passport",
      payload: "{\"claim\":\"age_over_18\",\"proof\":\"\(proof.proofType)\"\(cardRef)}"
    )
    IdentityDataStore.shared.addProvableClaim(ageClaim)

    let humanClaim = ProvableClaimEntity(
      identityCardId: passportCard.id,
      claimType: "is_human",
      title: "I am a real person",
      issuerType: "government",
      trustLevel: proof.trustLevel,
      source: "Passport",
      payload: "{\"claim\":\"is_human\",\"proof\":\"\(proof.proofType)\"\(cardRef)}"
    )
    IdentityDataStore.shared.addProvableClaim(humanClaim)

    return .success(passportCard)
  }

  // MARK: - Private

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

    let source = "\(draft.passportNumber)|\(draft.nationalityCode)|\(draft.dateOfBirth.timeIntervalSince1970)|\(draft.expiryDate.timeIntervalSince1970)"
    let digest = SHA256.hash(data: Data(source.utf8))
    let digestHex = digest.map { String(format: "%02x", $0) }.joined()

    let raw = draft.passportNumber
    let masked = raw.count > 3 ? String(raw.prefix(2)) + String(repeating: "*", count: raw.count - 3) + String(raw.suffix(1)) : raw

    return .success(
      PassportChipSnapshot(
        documentHash: String(digestHex.prefix(32)),
        mrzDigest: String(digestHex.suffix(32)),
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
}
