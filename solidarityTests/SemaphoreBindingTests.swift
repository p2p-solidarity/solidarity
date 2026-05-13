import XCTest
@testable import solidarity

@MainActor
final class SemaphoreBindingTests: XCTestCase {
  func testDeterministicGroupRootIsOrderIndependent() {
    let rootA = SemaphoreIdentityManager.deterministicGroupRoot(for: ["c1", "c2", "c3"])
    let rootB = SemaphoreIdentityManager.deterministicGroupRoot(for: ["c3", "c1", "c2"])
    XCTAssertEqual(rootA, rootB)
  }

  func testDeterministicGroupRootChangesWhenMembersChange() {
    let rootA = SemaphoreIdentityManager.deterministicGroupRoot(for: ["c1", "c2"])
    let rootB = SemaphoreIdentityManager.deterministicGroupRoot(for: ["c1", "c3"])
    XCTAssertNotEqual(rootA, rootB)
  }

  func testGroupCredentialRejectsProofWithMismatchedRootSignalScope() async throws {
    let info = GroupCredentialContext.GroupCredentialInfo(
      groupId: "group-123",
      groupName: "Test Group",
      merkleRoot: "expected-root",
      issuedBy: "owner",
      issuedAt: Date(),
      proofRequired: true
    )

    var card = BusinessCard(name: "Group User")
    card.groupContext = .group(info)

    let forgedProof = """
    {"version":1,"semaphore_proof":"{\\"proof\\":\\"fake\\"}","group_root":"wrong-root","signal":"wrong-signal","scope":"wrong-scope","member_count":1}
    """

    let result = try await GroupCredentialService.shared.verifyGroupCredential(card: card, proof: forgedProof)
    XCTAssertEqual(result, .invalidProof)
  }

  // MARK: - verifySemaphoreProof (verifyVpToken path)

  /// Regression: a Semaphore proof envelope shaped like MoproProofService's
  /// passport fallback (no top-level group_root/signal/scope on the OUTER
  /// payload) must NOT be hard-rejected with "Missing Semaphore binding
  /// context" before the cryptographic check runs. Earlier behaviour failed
  /// every Mopro Semaphore-fallback proof at this guard, leaving QR-scan
  /// verifyVpToken unable to verify any locally-generated passport ZK proof.
  func testVerifySemaphoreProofUsesEnvelopeAsAuthoritativeBindingContext() {
    // Construct a payload mirroring MoproProofService.generateWithSemaphore:
    // outer fields lack root/signal/scope; envelope carries them.
    let envelopeDict: [String: Any] = [
      "version": 1,
      "semaphore_proof": "{\"proof\":\"opaque-rust-bytes\"}",
      "group_root": "envelope-root",
      "signal": "envelope-signal",
      "scope": "envelope-scope",
      "member_count": 2,
      "group_commitments": ["1", "2"],
    ]
    let outerDict: [String: Any] = [
      "passport_hash": "deadbeef",
      "mrz": "abc",
      "proof_type": "semaphore-zk",
      "passive_auth": true,
      "semaphore_proof": envelopeDict,
    ]
    let data = try! JSONSerialization.data(withJSONObject: outerDict)
    let payload = String(decoding: data, as: UTF8.self)

    let result = ProofVerifierService.shared.verifySemaphoreProof(payload)

    // Crypto verify will fail here (the proof string is opaque), but we MUST
    // get past the binding-context guard. Confirm the rejection reason is
    // about cryptographic verification, not the missing-binding-context
    // guard that previously blocked all such payloads.
    XCTAssertFalse(result.isValid)
    XCTAssertNotEqual(result.title, "Missing Semaphore binding context",
                      "Envelope-only proofs should reach the cryptographic check, not be rejected at the binding-context guard.")
  }

  /// When the OUTER payload also asserts root/signal/scope and they DISAGREE
  /// with the envelope, verification must reject. This is the consistency
  /// check we still need so a relying party that pinned an expected scope
  /// can't be tricked by a different envelope.
  func testVerifySemaphoreProofRejectsOuterEnvelopeMismatch() {
    let envelopeDict: [String: Any] = [
      "version": 1,
      "semaphore_proof": "{\"proof\":\"opaque\"}",
      "group_root": "envelope-root",
      "signal": "envelope-signal",
      "scope": "envelope-scope",
      "member_count": 2,
      "group_commitments": ["1", "2"],
    ]
    let outerDict: [String: Any] = [
      "proof_type": "semaphore-zk",
      "semaphore_proof": envelopeDict,
      // Outer scope disagrees with envelope's scope:
      "scope": "different-scope",
    ]
    let data = try! JSONSerialization.data(withJSONObject: outerDict)
    let payload = String(decoding: data, as: UTF8.self)

    let result = ProofVerifierService.shared.verifySemaphoreProof(payload)
    XCTAssertFalse(result.isValid)
    XCTAssertEqual(result.title, "Invalid binding context")
  }
}
