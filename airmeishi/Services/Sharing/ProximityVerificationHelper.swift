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

    if let proof = proof, SemaphoreIdentityManager.proofsSupported {
      let context = SemaphoreIdentityManager.shared.bindingContext(from: proof)
      guard let context else { return .failed }
      guard context.commitments.contains(commitment) else { return .failed }

      let expectedRoot = SemaphoreIdentityManager.bindingRoot(for: context.commitments)
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
