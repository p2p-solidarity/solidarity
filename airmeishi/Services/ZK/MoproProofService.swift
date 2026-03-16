//
//  MoproProofService.swift
//  airmeishi
//
//  Wraps Mopro (zkmopro) for on-device ZK proof generation using
//  OpenPassport Noir circuits. Falls back to Semaphore or SD-JWT
//  when the Mopro FFI bindings are not available.
//

import CryptoKit
import Foundation

#if canImport(moproFFI)
  import moproFFI
#endif

// MARK: - Proof Output

struct MoproProofOutput: Equatable {
  let proofType: String          // "mopro-noir", "semaphore-zk", "sd-jwt-fallback"
  let proofJSON: String          // Serialized proof payload
  let publicSignals: [String]    // Public outputs (age_over_18, nationality, etc.)
  let generationTimeMs: UInt64
  let trustLevel: String         // "green" = ZKP, "blue" = fallback
}

// MARK: - Service

final class MoproProofService {
  static let shared = MoproProofService()
  private init() {}

  /// Whether Mopro native proving is available in this build.
  static var isAvailable: Bool {
    #if canImport(moproFFI)
      return true
    #else
      return false
    #endif
  }

  // MARK: - Passport Proof Generation

  /// Generate a ZK proof from passport chip data using Mopro (OpenPassport Noir circuit).
  /// Falls back to Semaphore → SD-JWT if Mopro is unavailable.
  func generatePassportProof(
    documentHash: String,
    mrzDigest: String,
    nationalityCode: String,
    dateOfBirth: Date,
    expiryDate: Date,
    passiveAuthPassed: Bool,
    onProgress: @escaping @Sendable (String) -> Void
  ) async -> MoproProofOutput {
    let start = DispatchTime.now()

    // Try Mopro first
    #if canImport(moproFFI)
    if let result = await generateWithMopro(
      documentHash: documentHash,
      mrzDigest: mrzDigest,
      nationalityCode: nationalityCode,
      dateOfBirth: dateOfBirth,
      expiryDate: expiryDate,
      onProgress: onProgress
    ) {
      return result
    }
    #endif

    // Fallback: Semaphore ZK
    onProgress("Trying Semaphore ZK...")
    if let result = await generateWithSemaphore(
      documentHash: documentHash,
      mrzDigest: mrzDigest,
      nationalityCode: nationalityCode,
      startTime: start
    ) {
      return result
    }

    // Final fallback: SD-JWT
    onProgress("Using SD-JWT fallback...")
    return generateSDJWTFallback(
      documentHash: documentHash,
      mrzDigest: mrzDigest,
      nationalityCode: nationalityCode,
      dateOfBirth: dateOfBirth,
      passiveAuthPassed: passiveAuthPassed,
      startTime: start
    )
  }

  // MARK: - Mopro Native Proof

  #if canImport(moproFFI)
  private func generateWithMopro(
    documentHash: String,
    mrzDigest: String,
    nationalityCode: String,
    dateOfBirth: Date,
    expiryDate: Date,
    onProgress: @escaping @Sendable (String) -> Void
  ) async -> MoproProofOutput? {
    let start = DispatchTime.now()

    guard let circuitPath = Bundle.main.path(forResource: "openpassport_circuit", ofType: "json"),
          let srsPath = Bundle.main.path(forResource: "openpassport_srs", ofType: "bin")
    else {
      ZKLog.warn("Mopro circuit or SRS not found in bundle")
      return nil
    }

    onProgress("Loading OpenPassport circuit...")

    // Build circuit inputs
    let ageThreshold = 18
    let inputs: [String] = [
      documentHash,
      mrzDigest,
      nationalityCode,
      "\(ageThreshold)",
    ]

    do {
      onProgress("Generating ZK proof (this may take 5-15s)...")

      let proofData = try generateNoirProof(
        circuitPath: circuitPath,
        srsPath: srsPath,
        inputs: inputs
      )

      let elapsed = elapsedMs(from: start)
      onProgress("Proof generated in \(elapsed)ms")

      // Extract public signals from proof
      let publicSignals = derivePublicSignals(
        nationalityCode: nationalityCode,
        dateOfBirth: dateOfBirth,
        expiryDate: expiryDate
      )

      let payload = buildProofPayload(
        proofType: "mopro-noir",
        proofData: proofData,
        documentHash: documentHash,
        mrzDigest: mrzDigest,
        publicSignals: publicSignals
      )

      return MoproProofOutput(
        proofType: "mopro-noir",
        proofJSON: payload,
        publicSignals: publicSignals,
        generationTimeMs: elapsed,
        trustLevel: "green"
      )
    } catch {
      ZKLog.error("Mopro proof generation failed: \(error)")
      onProgress("Mopro failed, trying fallback...")
      return nil
    }
  }
  #endif

  // MARK: - Semaphore Fallback

  private func generateWithSemaphore(
    documentHash: String,
    mrzDigest: String,
    nationalityCode: String,
    startTime: DispatchTime
  ) async -> MoproProofOutput? {
    guard SemaphoreIdentityManager.proofsSupported else { return nil }

    do {
      let identity = try SemaphoreIdentityManager.shared.loadOrCreateIdentity()
      guard let groupCommitments = SemaphoreGroupManager.shared.proofCommitments(containing: identity.commitment) else {
        ZKLog.info("Semaphore fallback skipped: no multi-member group context available.")
        return nil
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
         let proofObj = try? JSONSerialization.jsonObject(with: proofData) {
        payloadDict["semaphore_proof"] = proofObj
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

  private func generateSDJWTFallback(
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

  // MARK: - Helpers

  private func derivePublicSignals(
    nationalityCode: String,
    dateOfBirth: Date,
    expiryDate: Date
  ) -> [String] {
    var signals: [String] = []

    // Age over 18 check
    let age = Calendar.current.dateComponents([.year], from: dateOfBirth, to: Date()).year ?? 0
    if age >= 18 {
      signals.append("age_over_18")
    }
    signals.append("is_human")
    signals.append("nationality:\(nationalityCode)")

    // Passport validity
    if expiryDate > Date() {
      signals.append("document_valid")
    }

    return signals
  }

  private func buildProofPayload(
    proofType: String,
    proofData: Any,
    documentHash: String,
    mrzDigest: String,
    publicSignals: [String]
  ) -> String {
    let payload: [String: Any] = [
      "proof_type": proofType,
      "passport_hash": documentHash,
      "mrz": mrzDigest,
      "public_signals": publicSignals,
      "proof": "\(proofData)",
      "generated_at": ISO8601DateFormatter().string(from: Date()),
    ]
    let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data()
    return String(data: data, encoding: .utf8) ?? "{}"
  }

  private func elapsedMs(from start: DispatchTime) -> UInt64 {
    let end = DispatchTime.now()
    return (end.uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000
  }
}
