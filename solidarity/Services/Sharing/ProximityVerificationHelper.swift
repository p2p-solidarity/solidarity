//
//  ProximityVerificationHelper.swift
//  solidarity
//
//  Helper to verify issuer commitment and optional Semaphore proof for proximity.
//

import Foundation

enum ProximityVerificationHelper {
  static func verify(commitment: String?, proof: String?, message: String, scope: String) -> VerificationStatus {
    guard let commitment = commitment, !commitment.isEmpty else {
      return .failed
    }

    if let proof = proof, SemaphoreIdentityManager.proofsSupported {
      let context = SemaphoreIdentityManager.shared.bindingContext(from: proof)
      guard let context else { return .failed }
      guard context.commitments.contains(commitment) else { return .failed }
      guard context.commitments.count > 1 else { return .failed }

      // Circuit-only root check. If the build has no Semaphore library
      // we cannot derive a circuit root — defer to verifyProof which is
      // the canonical check anyway. We never substitute the deterministic
      // SHA256 fingerprint here because it will never equal the envelope's
      // circuit root.
      guard let expectedRoot = SemaphoreIdentityManager.bindingRootIfCircuitAvailable(for: context.commitments) else {
        return .pending
      }
      guard context.groupRoot == expectedRoot else { return .failed }

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
