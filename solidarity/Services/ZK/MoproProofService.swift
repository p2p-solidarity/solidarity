//
//  MoproProofService.swift
//  solidarity
//
//  Wraps OpenPassport mopro proving for on-device ZK proof generation.
//  Falls back to Semaphore or SD-JWT when native proving is unavailable.
//

import CryptoKit
import Foundation
import OpenPassportSwift
import os

private let logger = Logger(subsystem: "solidarity.zk", category: "MoproProofService")

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

  // MARK: - Crash sentinel

  /// Tracks whether the native prover previously crashed the process.
  /// The Barretenberg C++ backend throws foreign exceptions that Rust/Swift
  /// cannot catch — the only safe approach is to skip OpenPassport after a
  /// crash and fall back to Semaphore/SD-JWT.
  static let crashSentinelKey = "solidarity.mopro.noir.proving_in_progress"
  static let crashCountKey = "solidarity.mopro.noir.crash_count"
  static let crashSentinelBuildKey = "solidarity.mopro.noir.crash_build"
  static let maxCrashRetries = 2

  /// Current build identifier used to auto-reset the crash sentinel whenever
  /// the app is upgraded. A prior crash on an older build shouldn't keep
  /// OpenPassport disabled after the user installs a new version that may
  /// have fixed the crashing path.
  static let currentBuildIdentifier: String = {
    let short = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "?"
    let build = (Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "?"
    return "\(short)(\(build))"
  }()

  /// Sentinel evaluated **once per process** at first access. Reading the
  /// persisted flag is destructive (it increments the crash count and clears
  /// the armed bit); if `isAvailable` were consumed from a SwiftUI view body
  /// — which it is (PassportOnboardingFlowView+Steps.swift) — every
  /// re-render during proving would clear our own armed sentinel and
  /// eventually trip the retry cap without any real crash. Capturing the
  /// state once preserves the "was armed by a previous, crashed process"
  /// semantics across all subsequent reads.
  ///
  /// Auto-resets when the build identifier changes so a new TestFlight build
  /// gets a clean sentinel slate without needing a manual reset.
  static let crashSnapshotAtLaunch: Bool = {
    let storedBuild = UserDefaults.standard.string(forKey: crashSentinelBuildKey)
    if storedBuild != currentBuildIdentifier {
      logger.warning(
        "Native prover sentinel auto-reset — build changed from \(storedBuild ?? "nil", privacy: .public) to \(currentBuildIdentifier, privacy: .public)"
      )
      UserDefaults.standard.removeObject(forKey: crashSentinelKey)
      UserDefaults.standard.removeObject(forKey: crashCountKey)
      UserDefaults.standard.set(currentBuildIdentifier, forKey: crashSentinelBuildKey)
      return false
    }
    guard UserDefaults.standard.bool(forKey: crashSentinelKey) else { return false }
    let count = UserDefaults.standard.integer(forKey: crashCountKey) + 1
    UserDefaults.standard.set(count, forKey: crashCountKey)
    UserDefaults.standard.set(false, forKey: crashSentinelKey)
    logger.warning("Native prover crash detected at launch (count=\(count)/\(maxCrashRetries)) on build \(currentBuildIdentifier, privacy: .public)")
    return count >= maxCrashRetries
  }()

  /// Call before entering native prover code.
  static func armCrashSentinel() {
    UserDefaults.standard.set(true, forKey: crashSentinelKey)
    UserDefaults.standard.synchronize()
  }

  /// Call after native prover returns (success *or* catchable throw).
  /// Pair with `armCrashSentinel()` via `defer` so every non-crash exit
  /// clears the flag.
  static func disarmCrashSentinel() {
    UserDefaults.standard.set(false, forKey: crashSentinelKey)
    UserDefaults.standard.set(0, forKey: crashCountKey)
  }

  /// Reset crash history (e.g. after app update or circuit file change).
  static func resetCrashSentinel() {
    UserDefaults.standard.removeObject(forKey: crashSentinelKey)
    UserDefaults.standard.removeObject(forKey: crashCountKey)
  }

  /// Whether OpenPassport native proving is available in this build.
  /// Always logs both the crash-sentinel state **and** the file-bundle state so
  /// a disabled build can be diagnosed (sentinel trip vs. missing resource) in
  /// one pass without guessing.
  static var isAvailable: Bool {
    let sentinelTripped = crashSnapshotAtLaunch
    let circuitPath = Bundle.main.path(forResource: "openpassport_disclosure", ofType: "acir")
      ?? Bundle.main.path(forResource: "openpassport_disclosure", ofType: "json")
      ?? Bundle.main.path(forResource: "disclosure", ofType: "json")
    let srsPath = Bundle.main.path(forResource: "openpassport_srs", ofType: "bin")
    let hasCircuit = circuitPath != nil
    let hasSRS = srsPath != nil
    let circuitDesc = circuitPath ?? "nil"
    let srsDesc = srsPath ?? "nil"
    logger.info(
      "OpenPassport availability: sentinelTripped=\(sentinelTripped), circuit=\(hasCircuit) path=\(circuitDesc), srs=\(hasSRS) path=\(srsDesc)"
    )
    if sentinelTripped {
      logger.warning("OpenPassport DISABLED — native prover crashed in a previous session (files present: circuit=\(hasCircuit), srs=\(hasSRS))")
      return false
    }
    if !hasCircuit {
      logger.warning("Missing circuit file (openpassport_disclosure.acir) — OpenPassport will fall back")
    }
    if !hasSRS {
      logger.warning("Missing SRS file (openpassport_srs.bin) — OpenPassport will fall back")
    }
    return hasCircuit && hasSRS
  }

  // MARK: - Passport Proof Generation

  // swiftlint:disable function_parameter_count
  /// Generate a ZK proof from passport chip data using OpenPassport disclosure circuit.
  /// Falls back to Semaphore -> SD-JWT if OpenPassport proving is unavailable.
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

    logger.info("========== PASSPORT PROOF GENERATION START ==========")
    logger.info("nationality=\(nationalityCode), passiveAuth=\(passiveAuthPassed)")
    logger.info("dg1MRZData length=\(dg1MRZData.count), documentHash=\(documentHash.prefix(16))...")
    logger.info("mrzDigest=\(mrzDigest.prefix(16))..., expiryDate=\(expiryDate)")

    // ── Step 1: OpenPassport (Mopro/Noir) ──
    logger.info("── Step 1/3: OpenPassport (Noir/Mopro) ──")
    if Self.isAvailable {
      logger.info("Attempting Noir proof generation via OpenPassport circuit...")
      if let result = await generateWithOpenPassport(
        documentHash: documentHash,
        mrzDigest: mrzDigest,
        dg1MRZData: dg1MRZData,
        fallbackNationalityCode: nationalityCode,
        fallbackDateOfBirth: dateOfBirth,
        expiryDate: expiryDate,
        onProgress: onProgress
      ) {
        logger.info("✅ OpenPassport proof SUCCEEDED in \(result.generationTimeMs)ms — proofType=mopro-noir, trustLevel=green")
        return result
      }
      logger.warning("❌ OpenPassport proof FAILED — falling back to Semaphore")
    } else {
      logger.warning("OpenPassport SKIPPED — isAvailable=false (see prior log for sentinelTripped / file status)")
    }

    // ── Step 2: Semaphore ZK ──
    let semaphoreSupported = SemaphoreIdentityManager.proofsSupported
    logger.info("── Step 2/3: Semaphore ZK ── supported=\(semaphoreSupported)")
    if semaphoreSupported {
      onProgress("Trying Semaphore ZK...")
      logger.info("Attempting Semaphore proof generation...")
      if let result = await generateWithSemaphore(
        documentHash: documentHash,
        mrzDigest: mrzDigest,
        nationalityCode: nationalityCode,
        passiveAuthPassed: passiveAuthPassed,
        startTime: start
      ) {
        logger.info("✅ Semaphore ZK proof SUCCEEDED in \(result.generationTimeMs)ms — proofType=semaphore-zk, trustLevel=green")
        return result
      }
      logger.warning("❌ Semaphore ZK proof FAILED — falling back to SD-JWT")
    } else {
      logger.warning("Semaphore ZK SKIPPED — proofsSupported=false (check: canImport(Semaphore), not x86_64 simulator)")
    }

    // ── Step 3: SD-JWT Fallback ──
    logger.warning("── Step 3/3: SD-JWT Fallback ── (not true ZK, trustLevel=blue)")
    onProgress("Using SD-JWT fallback...")
    let result = generateSDJWTFallback(
      documentHash: documentHash,
      mrzDigest: mrzDigest,
      nationalityCode: nationalityCode,
      dateOfBirth: dateOfBirth,
      passiveAuthPassed: passiveAuthPassed,
      startTime: start
    )
    logger.info("SD-JWT fallback completed in \(result.generationTimeMs)ms — proofType=sd-jwt-fallback")
    logger.info("========== PASSPORT PROOF GENERATION END (used: \(result.proofType)) ==========")
    return result
  }
  // swiftlint:enable function_parameter_count

  // MARK: - OpenPassport Native Proof

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

      logger.info("[Noir] generateWithOpenPassport ENTRY — dg1MRZData.count=\(dg1MRZData.count), fallbackNationality=\(fallbackNationalityCode)")

      guard
        let circuitPath = Bundle.main.path(forResource: "openpassport_disclosure", ofType: "acir")
          ?? Bundle.main.path(forResource: "openpassport_disclosure", ofType: "json")
          ?? Bundle.main.path(forResource: "disclosure", ofType: "json")
      else {
        logger.warning("[Noir] EXIT reason=circuit-missing — OpenPassport disclosure circuit not found in bundle")
        ZKLog.info("OpenPassport disclosure circuit not found in bundle")
        return nil
      }
      logger.info("[Noir] circuitPath=\(circuitPath)")

      // SRS file is required for Barretenberg proving backend.
      // Without it, the C++ prover throws a foreign exception that Rust cannot catch, causing a crash.
      guard let srsPath = Bundle.main.path(forResource: "openpassport_srs", ofType: "bin") else {
        logger.warning("[Noir] EXIT reason=srs-missing — OpenPassport SRS file not found in bundle")
        ZKLog.info("OpenPassport SRS file not found in bundle, skipping Noir proving")
        return nil
      }
      logger.info("[Noir] srsPath=\(srsPath)")

      onProgress("Preparing OpenPassport disclosure witness...")
      logger.info("[Noir] Building disclosure witness...")
      guard let witness = buildDisclosureWitness(
        rawMRZ: dg1MRZData,
        fallbackNationalityCode: fallbackNationalityCode,
        fallbackDateOfBirth: fallbackDateOfBirth
      ) else {
        logger.warning("[Noir] EXIT reason=witness-build-failed — could not build witness from MRZ data (length=\(dg1MRZData.count))")
        ZKLog.info("Failed to build disclosure witness from MRZ data")
        return nil
      }
      let inputKeys = Array(witness.inputs.keys).sorted().joined(separator: ",")
      let mrzPrefix = witness.mrzHashHex.prefix(16)
      let nationality = witness.disclosedNationality
      let over18 = witness.isOlderThan18
      logger.info(
        "[Noir] Witness built — mrzHash=\(mrzPrefix)..., nationality=\(nationality), over18=\(over18), inputs.keys=\(inputKeys)"
      )

      if !mrzDigest.isEmpty && witness.mrzHashHex != mrzDigest.lowercased() {
        logger.warning("[Noir] MRZ digest mismatch — caller=\(mrzDigest.prefix(16))..., dg1=\(witness.mrzHashHex.prefix(16))...")
        onProgress("MRZ digest mismatch detected; using DG1-derived digest.")
      }

      do {
        onProgress("Generating OpenPassport proof on device...")
        logger.info("[Noir] Calling generateNoirProof — arming crash sentinel...")

        // `defer` fires on every non-crash exit (success or catchable throw) so
        // recoverable Swift errors don't leave the sentinel armed and push the
        // retry cap toward a permanent disable. The armed window covers both
        // generate and verify — both go through the same Barretenberg backend
        // that can raise uncatchable foreign exceptions.
        Self.armCrashSentinel()
        defer { Self.disarmCrashSentinel() }

        let proveStart = DispatchTime.now()
        let proof = try generateNoirProof(
          circuitPath: circuitPath,
          srsPath: srsPath,
          inputs: witness.inputs
        )
        let proveMs = elapsedMs(from: proveStart)
        logger.info("[Noir] generateNoirProof RETURNED in \(proveMs)ms — proof.count=\(proof.proof.count), vk.count=\(proof.vk.count)")

        let verifyStart = DispatchTime.now()
        let verified = try verifyNoirProof(proof: proof.proof, vk: proof.vk)
        let verifyMs = elapsedMs(from: verifyStart)
        logger.info("[Noir] verifyNoirProof RETURNED verified=\(verified) in \(verifyMs)ms")
        guard verified else {
          logger.warning("[Noir] EXIT reason=verify-false — proof generated but verification returned false")
          ZKLog.info("OpenPassport proof verification failed immediately after generation")
          return nil
        }

        let elapsed = elapsedMs(from: start)
        onProgress("OpenPassport proof generated in \(elapsed)ms")
        logger.info("[Noir] SUCCESS — total=\(elapsed)ms (prove=\(proveMs)ms, verify=\(verifyMs)ms)")

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
        logger.error("[Noir] EXIT reason=threw — \(String(describing: error))")
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
        logger.warning(
          "[Noir] normalizedMRZ: sanitized=\(sanitized.count) chars (need >=88) — raw=\(rawMRZ.count) chars, fallback nationality=\(fallbackNationalityCode)"
        )
        ZKLog.info(
          "OpenPassport skipped: DG1 MRZ incomplete (\(sanitized.count) chars, expected >= 88). " +
            "fallback_nationality=\(fallbackNationalityCode), fallback_dob=\(yyMMdd(from: fallbackDateOfBirth))"
        )
        return nil
      }
      logger.info("[Noir] normalizedMRZ: raw=\(rawMRZ.count) → sanitized=\(sanitized.count) → prefix88")
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
}
