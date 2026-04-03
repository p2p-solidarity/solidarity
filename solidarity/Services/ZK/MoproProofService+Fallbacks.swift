//
//  MoproProofService+Fallbacks.swift
//  solidarity
//
//  Semaphore and SD-JWT fallback proof generation for MoproProofService.
//

import Foundation

extension MoproProofService {

  // MARK: - Semaphore Fallback

  func generateWithSemaphore(
    documentHash: String,
    mrzDigest: String,
    nationalityCode: String,
    startTime: DispatchTime
  ) async -> MoproProofOutput? {
    guard SemaphoreIdentityManager.proofsSupported else { return nil }

    do {
      let identity = try SemaphoreIdentityManager.shared.loadOrCreateIdentity()

      // Use existing multi-member group, or bootstrap a minimal 2-member group
      // for passport self-attestation (anchor + user = anonymity set of 2).
      let groupCommitments: [String]
      if let existingGroup = SemaphoreGroupManager.shared.proofCommitments(containing: identity.commitment) {
        groupCommitments = existingGroup
      } else {
        groupCommitments = [identity.commitment, SemaphoreIdentityManager.passportAnchorCommitment]
        ZKLog.info("Using bootstrap passport anchor for Semaphore proof (no existing group).")
      }

      let proofJSON = try SemaphoreIdentityManager.shared.generateProof(
        groupCommitments: groupCommitments,
        message: documentHash,
        scope: "passport:\(nationalityCode)"
      )

      var payloadDict: [String: Any] = [
        "passport_hash": documentHash,
        "mrz": mrzDigest,
        "proof_type": "semaphore-zk",
      ]
      if let proofData = proofJSON.data(using: .utf8),
         let proofObject = try? JSONSerialization.jsonObject(with: proofData) {
        payloadDict["semaphore_proof"] = proofObject
      } else {
        payloadDict["semaphore_proof"] = proofJSON
      }

      let payloadData = try JSONSerialization.data(withJSONObject: payloadDict)
      let payloadString = String(data: payloadData, encoding: .utf8) ?? "{}"
      let elapsed = elapsedMs(from: startTime)

      return MoproProofOutput(
        proofType: "semaphore-zk",
        proofJSON: payloadString,
        publicSignals: ["age_over_18", "is_human"],
        generationTimeMs: elapsed,
        trustLevel: "green"
      )
    } catch {
      ZKLog.error("Semaphore proof generation failed: \(error)")
      return nil
    }
  }

  // MARK: - SD-JWT Fallback

  // swiftlint:disable:next function_parameter_count
  func generateSDJWTFallback(
    documentHash: String,
    mrzDigest: String,
    nationalityCode: String,
    dateOfBirth: Date,
    passiveAuthPassed: Bool,
    startTime: DispatchTime
  ) -> MoproProofOutput {
    let fallbackDict: [String: Any] = [
      "passport_hash": documentHash,
      "mrz": mrzDigest,
      "proof_type": "sd-jwt-fallback",
      "nationality": nationalityCode,
      "passive_auth": passiveAuthPassed,
    ]
    let fallbackData = (try? JSONSerialization.data(withJSONObject: fallbackDict)) ?? Data()
    let fallbackString = String(data: fallbackData, encoding: .utf8) ?? "{}"
    let elapsed = elapsedMs(from: startTime)

    return MoproProofOutput(
      proofType: "sd-jwt-fallback",
      proofJSON: fallbackString,
      publicSignals: [],
      generationTimeMs: elapsed,
      trustLevel: "blue"
    )
  }

  func elapsedMs(from start: DispatchTime) -> UInt64 {
    let end = DispatchTime.now()
    return (end.uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000
  }
}
