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
}

struct PassportProofResult: Equatable {
  let proofType: String
  let proofPayload: String
  let trustLevel: String
  let generationFailed: Bool
}

@MainActor
final class PassportPipelineService {
  static let shared = PassportPipelineService()
  private init() {}

  func validateMRZ(_ draft: PassportMRZDraft) -> CardResult<Void> {
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

  func readNFCChip(from draft: PassportMRZDraft) async -> CardResult<PassportChipSnapshot> {
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

  func generateProof(chip: PassportChipSnapshot, draft: PassportMRZDraft) async -> CardResult<PassportProofResult> {
    do {
      let identity = try SemaphoreIdentityManager.shared.loadOrCreateIdentity()
      let proofJSON = try SemaphoreIdentityManager.shared.generateProof(
        groupCommitments: [identity.commitment],
        message: chip.documentHash,
        scope: "passport:\(draft.nationalityCode)"
      )

      // Build payload with proper JSON serialization
      var payloadDict: [String: Any] = [
        "passport_hash": chip.documentHash,
        "mrz": chip.mrzDigest,
      ]
      // proofJSON is a JSON string from Semaphore — parse it to embed as object, not string
      if let proofData = proofJSON.data(using: .utf8),
        let proofObj = try? JSONSerialization.jsonObject(with: proofData)
      {
        payloadDict["semaphore_proof"] = proofObj
      } else {
        payloadDict["semaphore_proof"] = proofJSON
      }
      let payloadData = try JSONSerialization.data(withJSONObject: payloadDict)
      let payloadString = String(data: payloadData, encoding: .utf8) ?? "{}"

      return .success(
        PassportProofResult(
          proofType: "semaphore-zk",
          proofPayload: payloadString,
          trustLevel: "green",
          generationFailed: false
        )
      )
    } catch {
      // Fallback to sd-jwt when Semaphore is unsupported (e.g. simulator) or fails
      let fallbackDict: [String: String] = [
        "passport_hash": chip.documentHash,
        "mrz": chip.mrzDigest,
      ]
      let fallbackData = (try? JSONSerialization.data(withJSONObject: fallbackDict)) ?? Data()
      let fallbackString = String(data: fallbackData, encoding: .utf8) ?? "{}"

      return .success(
        PassportProofResult(
          proofType: "sd-jwt-fallback",
          proofPayload: fallbackString,
          trustLevel: "blue",
          generationFailed: true
        )
      )
    }
  }

  func persistPassportCredential(
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

  private var shouldSimulateNFC: Bool {
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

    return .success(
      PassportChipSnapshot(
        documentHash: String(digestHex.prefix(32)),
        mrzDigest: String(digestHex.suffix(32)),
        chipUID: "SIM-\(String(digestHex.prefix(8)).uppercased())",
        bacVerified: true,
        paceVerified: false,
        passiveAuthPassed: false,
        isSimulated: true,
        readAt: Date()
      )
    )
  }

  #if !targetEnvironment(simulator)
  private func realNFCRead(draft: PassportMRZDraft) async -> CardResult<PassportChipSnapshot> {
    let dateFormatter = DateFormatter()
    dateFormatter.dateFormat = "yyMMdd"

    let reader = NFCPassportReaderService()
    do {
      let result = try await reader.read(
        passportNumber: draft.passportNumber.trimmingCharacters(in: .whitespacesAndNewlines),
        dateOfBirth: dateFormatter.string(from: draft.dateOfBirth),
        expiryDate: dateFormatter.string(from: draft.expiryDate)
      )

      let draftMRZSource = "\(draft.passportNumber)|\(draft.nationalityCode)|\(draft.dateOfBirth.timeIntervalSince1970)|\(draft.expiryDate.timeIntervalSince1970)"
      let mrzDigest = SHA256.hash(data: Data(draftMRZSource.utf8))
      let mrzDigestHex = mrzDigest.map { String(format: "%02x", $0) }.joined()

      return .success(
        PassportChipSnapshot(
          documentHash: result.rawDataHash.count >= 32
            ? String(result.rawDataHash.prefix(32))
            : result.rawDataHash,
          mrzDigest: String(mrzDigestHex.suffix(32)),
          chipUID: result.chipUID,
          bacVerified: result.bacSucceeded,
          paceVerified: result.paceSucceeded,
          passiveAuthPassed: result.passiveAuthPassed,
          isSimulated: false,
          readAt: result.readAt
        )
      )
    } catch let error as NFCPassportReaderService.NFCError {
      if case .cancelled = error {
        return .failure(.configurationError("NFC read cancelled"))
      }
      return .failure(.configurationError(error.localizedDescription ?? "NFC read failed"))
    } catch {
      return .failure(.configurationError("NFC read failed: \(error.localizedDescription)"))
    }
  }
  #endif
}
