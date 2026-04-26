//
//  MoproProofService+Fallbacks.swift
//  solidarity
//
//  Semaphore and SD-JWT fallback proof generation for MoproProofService.
//

import Foundation
import os

private let logger = Logger(subsystem: "solidarity.zk", category: "MoproProofFallbacks")

extension MoproProofService {

  // MARK: - Semaphore crash sentinel

  static let semaphoreSentinelKey = "solidarity.semaphore.proving_in_progress"
  static let semaphoreCrashCountKey = "solidarity.semaphore.crash_count"

  /// Snapshot-at-launch equivalent of OpenPassport's sentinel. Read once per
  /// process so consuming code can check freely without clobbering the armed
  /// flag mid-proof.
  static let semaphoreCrashSnapshotAtLaunch: Bool = {
    guard UserDefaults.standard.bool(forKey: semaphoreSentinelKey) else { return false }
    let count = UserDefaults.standard.integer(forKey: semaphoreCrashCountKey) + 1
    UserDefaults.standard.set(count, forKey: semaphoreCrashCountKey)
    UserDefaults.standard.set(false, forKey: semaphoreSentinelKey)
    logger.warning("Semaphore prover crash detected at launch (count=\(count)/\(maxCrashRetries))")
    return count >= maxCrashRetries
  }()

  static func armSemaphoreSentinel() {
    UserDefaults.standard.set(true, forKey: semaphoreSentinelKey)
    UserDefaults.standard.synchronize()
  }

  static func disarmSemaphoreSentinel() {
    UserDefaults.standard.set(false, forKey: semaphoreSentinelKey)
    UserDefaults.standard.set(0, forKey: semaphoreCrashCountKey)
  }

  static func resetSemaphoreCrashSentinel() {
    UserDefaults.standard.removeObject(forKey: semaphoreSentinelKey)
    UserDefaults.standard.removeObject(forKey: semaphoreCrashCountKey)
  }

  // MARK: - Semaphore Fallback

  func generateWithSemaphore(
    documentHash: String,
    mrzDigest: String,
    nationalityCode: String,
    passiveAuthPassed: Bool,
    startTime: DispatchTime
  ) async -> MoproProofOutput? {
    guard SemaphoreIdentityManager.proofsSupported else {
      logger.warning("[Semaphore] proofsSupported=false, skipping")
      return nil
    }

    if Self.semaphoreCrashSnapshotAtLaunch {
      logger.warning("[Semaphore] DISABLED — native prover crashed in a previous session")
      return nil
    }

    do {
      logger.info("[Semaphore] Loading or creating identity...")
      let identity = try SemaphoreIdentityManager.shared.loadOrCreateIdentity()
      logger.info("[Semaphore] Identity loaded — commitment=\(identity.commitment.prefix(16))...")

      // Use existing multi-member group, or bootstrap a minimal 2-member group
      // for passport self-attestation (anchor + user = anonymity set of 2).
      let groupCommitments: [String]
      if let existingGroup = SemaphoreGroupManager.shared.proofCommitments(containing: identity.commitment) {
        groupCommitments = existingGroup
        logger.info("[Semaphore] Found existing group with \(existingGroup.count) members")
      } else {
        groupCommitments = [identity.commitment, SemaphoreIdentityManager.passportAnchorCommitment]
        logger.info("[Semaphore] No existing group — using bootstrap anchor (anonymity set=2)")
      }

      logger.info("[Semaphore] Generating proof — scope=passport:\(nationalityCode), groupSize=\(groupCommitments.count)")

      // `defer` clears the armed flag on every non-crash exit — required to
      // stop catchable Swift throws from accumulating toward the retry cap
      // and permanently disabling Semaphore.
      Self.armSemaphoreSentinel()
      defer { Self.disarmSemaphoreSentinel() }

      let proofJSON = try SemaphoreIdentityManager.shared.generateProof(
        groupCommitments: groupCommitments,
        message: documentHash,
        scope: "passport:\(nationalityCode)"
      )
      logger.info("[Semaphore] Proof generated — payload length=\(proofJSON.count)")

      var payloadDict: [String: Any] = [
        "passport_hash": documentHash,
        "mrz": mrzDigest,
        "proof_type": "semaphore-zk",
        "passive_auth": passiveAuthPassed,
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

      // Trust level is gated on CSCA passive authentication. Without a verified
      // CSCA chain the chip data is unauthenticated — treat as self-issued.
      let trustLevel = passiveAuthPassed ? "green" : "white"
      let publicSignals: [String] = passiveAuthPassed ? ["age_over_18", "is_human"] : []

      return MoproProofOutput(
        proofType: "semaphore-zk",
        proofJSON: payloadString,
        publicSignals: publicSignals,
        generationTimeMs: elapsed,
        trustLevel: trustLevel
      )
    } catch {
      logger.error("[Semaphore] Proof generation FAILED: \(error.localizedDescription)")
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
    logger.warning("[SD-JWT] Generating fallback proof — NOT true ZK, no anonymity guarantee")
    logger.info("[SD-JWT] passiveAuth=\(passiveAuthPassed), nationality=\(nationalityCode)")
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

    // SD-JWT fallback is not true ZK; trust level mirrors CSCA passive auth result.
    // green = government-verified passport, white = unauthenticated self-issued.
    let trustLevel = passiveAuthPassed ? "green" : "white"

    return MoproProofOutput(
      proofType: "sd-jwt-fallback",
      proofJSON: fallbackString,
      publicSignals: [],
      generationTimeMs: elapsed,
      trustLevel: trustLevel
    )
  }

  func elapsedMs(from start: DispatchTime) -> UInt64 {
    let end = DispatchTime.now()
    return (end.uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000
  }
}
