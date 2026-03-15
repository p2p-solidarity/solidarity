//
//  ProximityVerificationHelper.swift
//  airmeishi
//
//  Helper to verify issuer commitment and optional Semaphore proof for proximity.
//

import Foundation

enum ProximityVerificationHelper {
  static func verify(commitment: String?, proof: String?, message: String, scope: String) -> VerificationStatus {
    guard let commitment = commitment, !commitment.isEmpty else {
      return .failed
    }
    let hexSet = CharacterSet(charactersIn: "0123456789abcdefABCDEF")
    let isHex = commitment.unicodeScalars.allSatisfy { hexSet.contains($0) }
    if !isHex || commitment.count < 32 {
      return .failed
    }
    if let proof = proof, SemaphoreIdentityManager.proofsSupported {
      let expectedRoot = SemaphoreIdentityManager.deterministicGroupRoot(for: [commitment])
      let ok = (try? SemaphoreIdentityManager.shared.verifyProof(
        proof,
        expectedRoot: expectedRoot,
        expectedSignal: message,
        expectedScope: scope
      )) ?? false
      return ok ? .verified : .failed
    }
    return .pending
  }
}
