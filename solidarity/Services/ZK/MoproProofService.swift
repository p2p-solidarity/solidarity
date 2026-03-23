//
//  MoproProofService.swift
//  solidarity
//
//  Wraps OpenPassport mopro proving for on-device ZK proof generation.
//  Falls back to Semaphore or SD-JWT when native proving is unavailable.
//

import CryptoKit
import Foundation

#if ENABLE_OPEN_PASSPORT
  import OpenPassportSwift
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

  /// Whether OpenPassport native proving is available in this build.
  static var isAvailable: Bool {
    #if ENABLE_OPEN_PASSPORT
      return true
    #else
      return false
    #endif
  }

  // MARK: - Passport Proof Generation

  // swiftlint:disable function_parameter_count
  /// Generate a ZK proof from passport chip data using OpenPassport disclosure circuit.
  /// Falls back to Semaphore → SD-JWT if OpenPassport proving is unavailable.
  func generatePassportProof(
    documentHash: String,
    mrzDigest: String,
    dg1MRZData: String,
    nationalityCode: String,
    dateOfBirth: Date,
    expiryDate: Date,
    passiveAuthPassed: Bool,
    onProgress: @escaping @Sendable (String) -> Void
  ) async -> MoproProofOutput {
    let start = DispatchTime.now()

    // Try OpenPassport proving first.
    #if ENABLE_OPEN_PASSPORT
    if let result = await generateWithOpenPassport(
      documentHash: documentHash,
      mrzDigest: mrzDigest,
      dg1MRZData: dg1MRZData,
      fallbackNationalityCode: nationalityCode,
      fallbackDateOfBirth: dateOfBirth,
      expiryDate: expiryDate,
      onProgress: onProgress
    ) {
      return result
    }
    #endif

    // Fallback: Semaphore ZK.
    onProgress("Trying Semaphore ZK...")
    if let result = await generateWithSemaphore(
      documentHash: documentHash,
      mrzDigest: mrzDigest,
      nationalityCode: nationalityCode,
      startTime: start
    ) {
      return result
    }

    // Final fallback: SD-JWT.
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
  // swiftlint:enable function_parameter_count

  // MARK: - OpenPassport Native Proof

  #if ENABLE_OPEN_PASSPORT
    private struct DisclosureWitness {
      let inputs: [String: [String]]
      let mrzHashHex: String
      let disclosedNationality: String
      let isOlderThan18: Bool
      let publicSignals: [String]
    }

    // swiftlint:disable:next function_parameter_count
    private func generateWithOpenPassport(
      documentHash: String,
      mrzDigest: String,
      dg1MRZData: String,
      fallbackNationalityCode: String,
      fallbackDateOfBirth: Date,
      expiryDate: Date,
      onProgress: @escaping @Sendable (String) -> Void
    ) async -> MoproProofOutput? {
      let start = DispatchTime.now()

      guard
        let circuitPath = Bundle.main.path(forResource: "openpassport_disclosure", ofType: "json")
          ?? Bundle.main.path(forResource: "disclosure", ofType: "json")
      else {
        ZKLog.info("OpenPassport disclosure circuit not found in bundle")
        return nil
      }

      // SRS file is required for Barretenberg proving backend.
      // Without it, the C++ prover throws a foreign exception that Rust cannot catch, causing a crash.
      guard let srsPath = Bundle.main.path(forResource: "openpassport_srs", ofType: "bin") else {
        ZKLog.info("OpenPassport SRS file not found in bundle, skipping Noir proving")
        return nil
      }

      onProgress("Preparing OpenPassport disclosure witness...")
      guard let witness = buildDisclosureWitness(
        rawMRZ: dg1MRZData,
        fallbackNationalityCode: fallbackNationalityCode,
        fallbackDateOfBirth: fallbackDateOfBirth
      ) else {
        ZKLog.info("Failed to build disclosure witness from MRZ data")
        return nil
      }

      if !mrzDigest.isEmpty && witness.mrzHashHex != mrzDigest.lowercased() {
        onProgress("MRZ digest mismatch detected; using DG1-derived digest.")
      }

      do {
        onProgress("Generating OpenPassport proof on device...")

        let proof = try generateNoirProof(
          circuitPath: circuitPath,
          srsPath: srsPath,
          inputs: witness.inputs
        )

        let verified = try verifyNoirProof(proof: proof.proof, vk: proof.vk)
        guard verified else {
          ZKLog.info("OpenPassport proof verification failed immediately after generation")
          return nil
        }

        let elapsed = elapsedMs(from: start)
        onProgress("OpenPassport proof generated in \(elapsed)ms")

        var publicSignals = witness.publicSignals
        if expiryDate > Date() {
          publicSignals.append("document_valid")
        }

        let payload = buildOpenPassportPayload(
          proof: proof,
          documentHash: documentHash,
          mrzDigest: mrzDigest,
          witness: witness,
          publicSignals: publicSignals,
          generationTimeMs: elapsed
        )

        return MoproProofOutput(
          proofType: "mopro-noir",
          proofJSON: payload,
          publicSignals: publicSignals,
          generationTimeMs: elapsed,
          trustLevel: "green"
        )
      } catch {
        ZKLog.error("OpenPassport proof generation failed: \(error)")
        onProgress("OpenPassport failed, trying fallback...")
        return nil
      }
    }

    private func buildDisclosureWitness(
      rawMRZ: String,
      fallbackNationalityCode: String,
      fallbackDateOfBirth: Date
    ) -> DisclosureWitness? {
      guard
        let mrzData = normalizedMRZ(
          from: rawMRZ,
          fallbackNationalityCode: fallbackNationalityCode,
          fallbackDateOfBirth: fallbackDateOfBirth
        )
      else {
        return nil
      }

      let mrzHashBytes = Array(SHA256.hash(data: Data(mrzData)))
      let mrzHashHex = mrzHashBytes.map { String(format: "%02x", $0) }.joined()

      let nationalityBytes = Array(mrzData[54...56])
      let nationalityCode = String(bytes: nationalityBytes, encoding: .ascii)?
        .replacingOccurrences(of: "<", with: "") ?? "UNK"

      let currentDateBytes = asciiBytes(from: yyMMdd(from: Date()))
      let dobBytes = Array(mrzData[57...62])
      let isOlderThan18 = isAgeAtLeastThreshold(dobYYMMDD: dobBytes, currentYYMMDD: currentDateBytes, threshold: 18)

      let revealNationality = true
      let revealOlderThan = true
      let revealName = false

      let outName = Array(repeating: UInt8(0), count: 39)
      let outNationality = nationalityBytes

      let inputs: [String: [String]] = [
        "mrz_data": toFieldValues(mrzData),
        "mrz_hash": toFieldValues(mrzHashBytes),
        "disclose_nationality": [boolField(revealNationality)],
        "disclose_older_than": [boolField(revealOlderThan)],
        "disclose_name": [boolField(revealName)],
        "age_threshold": ["18"],
        "current_date": toFieldValues(currentDateBytes),
        "out_nationality": toFieldValues(outNationality),
        "out_name": toFieldValues(outName),
        "out_is_older": [boolField(isOlderThan18)],
      ]

      var publicSignals = ["is_human"]
      if isOlderThan18 {
        publicSignals.append("age_over_18")
      }
      publicSignals.append("nationality:\(nationalityCode)")

      return DisclosureWitness(
        inputs: inputs,
        mrzHashHex: mrzHashHex,
        disclosedNationality: nationalityCode,
        isOlderThan18: isOlderThan18,
        publicSignals: publicSignals
      )
    }

    // swiftlint:disable:next function_parameter_count
    private func buildOpenPassportPayload(
      proof: NoirProofResult,
      documentHash: String,
      mrzDigest: String,
      witness: DisclosureWitness,
      publicSignals: [String],
      generationTimeMs: UInt64
    ) -> String {
      let payload: [String: Any] = [
        "proof_type": "mopro-noir",
        "engine": "openpassport-disclosure",
        "passport_hash": documentHash,
        "mrz": mrzDigest,
        "mrz_hash": witness.mrzHashHex,
        "disclosed_nationality": witness.disclosedNationality,
        "is_over_18": witness.isOlderThan18,
        "public_signals": publicSignals,
        "proof_b64": proof.proof.base64EncodedString(),
        "vk_b64": proof.vk.base64EncodedString(),
        "generated_at": ISO8601DateFormatter().string(from: Date()),
        "generation_time_ms": Int64(generationTimeMs),
      ]
      let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data()
      return String(data: data, encoding: .utf8) ?? "{}"
    }

    private func normalizedMRZ(
      from rawMRZ: String,
      fallbackNationalityCode: String,
      fallbackDateOfBirth: Date
    ) -> [UInt8]? {
      let sanitized = rawMRZ
        .uppercased()
        .filter { character in
          character.isASCII && (character.isLetter || character.isNumber || character == "<")
        }

      // OpenPassport disclosure proof must be based on real DG1 MRZ bytes.
      // If DG1 data is incomplete, we skip OpenPassport and fall back to the next proof engine.
      guard sanitized.count >= 88 else {
        ZKLog.info(
          "OpenPassport skipped: DG1 MRZ incomplete (\(sanitized.count) chars, expected >= 88). " +
            "fallback_nationality=\(fallbackNationalityCode), fallback_dob=\(yyMMdd(from: fallbackDateOfBirth))"
        )
        return nil
      }
      return Array(sanitized.prefix(88).utf8)
    }

    private func boolField(_ value: Bool) -> String {
      value ? "1" : "0"
    }

    private func toFieldValues(_ bytes: [UInt8]) -> [String] {
      bytes.map { String($0) }
    }

    private func asciiBytes(from value: String) -> [UInt8] {
      Array(value.utf8)
    }

    private func yyMMdd(from date: Date) -> String {
      let formatter = DateFormatter()
      formatter.dateFormat = "yyMMdd"
      formatter.locale = Locale(identifier: "en_US_POSIX")
      formatter.timeZone = TimeZone(secondsFromGMT: 0)
      return formatter.string(from: date)
    }

    private func isAgeAtLeastThreshold(
      dobYYMMDD: [UInt8],
      currentYYMMDD: [UInt8],
      threshold: UInt16
    ) -> Bool {
      guard dobYYMMDD.count == 6, currentYYMMDD.count == 6 else { return false }

      let birthYear = decimalPair(dobYYMMDD[0], dobYYMMDD[1])
      let birthMonth = decimalPair(dobYYMMDD[2], dobYYMMDD[3])
      let birthDay = decimalPair(dobYYMMDD[4], dobYYMMDD[5])

      let currentYear = decimalPair(currentYYMMDD[0], currentYYMMDD[1])
      let currentMonth = decimalPair(currentYYMMDD[2], currentYYMMDD[3])
      let currentDay = decimalPair(currentYYMMDD[4], currentYYMMDD[5])

      var age: UInt16
      if currentYear >= birthYear {
        age = currentYear - birthYear
      } else {
        age = 100 + currentYear - birthYear
      }

      let birthdayPassed = currentMonth > birthMonth || (currentMonth == birthMonth && currentDay >= birthDay)
      if !birthdayPassed && age > 0 {
        age -= 1
      }

      return age >= threshold
    }

    private func decimalPair(_ first: UInt8, _ second: UInt8) -> UInt16 {
      let firstDigit = first >= 48 && first <= 57 ? first - 48 : 0
      let secondDigit = second >= 48 && second <= 57 ? second - 48 : 0
      return UInt16(firstDigit) * 10 + UInt16(secondDigit)
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

  private func elapsedMs(from start: DispatchTime) -> UInt64 {
    let end = DispatchTime.now()
    return (end.uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000
  }
}
