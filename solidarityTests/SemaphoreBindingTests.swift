import XCTest
@testable import airmeishi

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
}
