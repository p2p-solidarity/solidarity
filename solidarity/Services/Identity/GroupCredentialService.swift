import Combine
import Foundation

@MainActor
final class GroupCredentialService: ObservableObject {
  static let shared = GroupCredentialService()

  private let groupSyncManager = CloudKitGroupSyncManager.shared
  private let semaphoreManager = SemaphoreIdentityManager.shared
  private let vcService = VCService()  // Or shared if it's a singleton

  // MARK: - Issuance

  /// Issues a Group Credential to target members
  /// - Parameters:
  ///   - card: The BusinessCard to wrap in the credential
  ///   - group: The Group issuing the credential
  ///   - targetMembers: Specific members to issue to (nil means all active members)
  ///   - expiration: Optional expiration date
  /// - Returns: A list of results (success/failure per member)
  func issueGroupCredential(
    for card: BusinessCard,
    group: GroupModel,
    targetMembers: [GroupMemberModel]? = nil,
    expiration: Date? = nil,
    nameOverride: String? = nil
  ) async throws -> [GroupCredentialResult] {

    // 1. Verify permission (must be owner or authorized issuer)
    guard let currentUser = groupSyncManager.currentUserRecordID,
      group.canIssueCredentials(userRecordID: currentUser.recordName)
    else {
      throw GroupCredentialError.permissionDenied
    }

    // 2. Determine recipients
    let recipients: [GroupMemberModel]
    if let targetMembers = targetMembers {
      recipients = targetMembers
    } else {
      // Fetch all active members if not specified
      recipients = try await groupSyncManager.getActiveMembers(for: group)
    }

    var results: [GroupCredentialResult] = []

    // 3. Prepare Credential Context
    // Note: The merkleRoot here is the *current* root of the group.
    // This fixes the root for this credential issuance.
    guard let merkleRoot = group.merkleRoot else {
      throw GroupCredentialError.groupIntegrityError("Missing Merkle Root")
    }

    let credentialInfo = GroupCredentialContext.GroupCredentialInfo(
      groupId: group.id,
      groupName: group.name,
      merkleRoot: merkleRoot,
      issuedBy: currentUser.recordName,
      issuedAt: Date(),
      proofRequired: true
    )

    // 4. Issue for each recipient
    for member in recipients {
      do {
        // Create a copy of the card with the group context
        var groupCard = card

        // Apply optional name override just for this issued credential
        if let override = nameOverride?.trimmingCharacters(in: .whitespacesAndNewlines),
          !override.isEmpty
        {
          groupCard.name = override
        }

        groupCard.groupContext = .group(credentialInfo)

        // Set expiration if provided
        if let expiration = expiration {
          groupCard.sharingPreferences.expirationDate = expiration
        }

        // In a real VC flow, we would sign this with the Issuer's DID.
        // For now, we are simulating the issuance by preparing the card data.
        // The actual "sending" happens via the DeliveryService (Proximity/Sakura).

        results.append(.success(memberId: member.userRecordID, card: groupCard))
      } catch {
        results.append(.failure(memberId: member.userRecordID, error: error))
      }
    }

    return results
  }

  // MARK: - Verification

  /// Verifies a Group Credential
  /// - Parameters:
  ///   - card: The card containing the group context
  ///   - proof: The Semaphore proof provided by the holder
  /// - Returns: Verification result
  func verifyGroupCredential(
    card: BusinessCard,
    proof: String?
  ) async throws -> GroupCredentialVerificationResult {

    guard let context = card.groupContext else {
      return .invalid("Not a Group Credential")
    }

    switch context {
    case .personal:
      return .valid(context: context)  // Personal VCs are valid if signature matches (checked elsewhere)

    case .group(let info):
      // 1. Check Expiration
      if let expiration = card.sharingPreferences.expirationDate, expiration < Date() {
        return .expired
      }

      // 2. Check Semaphore Proof
      if info.proofRequired {
        guard let proof = proof else {
          return .missingProof
        }

        // Verify proof format and validity.
        //
        // Scope MUST differ from signal — Semaphore derives the
        // anonymity-collapsing nullifier from `(identitySecret, scope)`.
        // If scope == groupId == signal, every proof from a given member
        // in this group produces the same nullifier and the verifier can
        // link presentations across sessions. We use a versioned context
        // string for scope and the groupId for signal (the message being
        // attested). The prover side mirrors this in
        // `generateVerificationProof(for:)`.
        let expectedSignal = Self.groupCredentialSignal(groupId: info.groupId)
        let expectedScope = Self.groupCredentialScope(groupId: info.groupId)

        do {
          let isValidProof = try semaphoreManager.verifyProof(
            proof,
            expectedRoot: info.merkleRoot,
            expectedSignal: expectedSignal,
            expectedScope: expectedScope
          )

          if !isValidProof {
            return .invalidProof
          }

        } catch {
          return .invalidProof
        }
      }

      return .valid(context: context)
    }
  }

  // MARK: - Scope / signal derivation
  //
  // Domain-separated. Different from each other so the per-(secret, scope)
  // nullifier is stable per group context but distinct from the signal
  // payload. If we ever issue group credentials in a new context (e.g.
  // group voting) the scope domain string changes and replays from the
  // credential context don't carry over.

  // Pure derivations — `nonisolated` so callers (and tests) can use them
  // without hopping to the main actor.
  nonisolated static let groupCredentialScopeDomain = "groupCredential.v1"

  nonisolated static func groupCredentialScope(groupId: String) -> String {
    "\(groupCredentialScopeDomain).\(groupId)"
  }

  nonisolated static func groupCredentialSignal(groupId: String) -> String {
    groupId
  }

  // MARK: - Proof Generation

  /// Generates a Semaphore proof for a specific group
  /// - Parameter group: The group to prove membership in
  /// - Returns: The generated proof string
  func generateVerificationProof(for group: GroupModel) async throws -> String {
    // Ensure we have the latest merkle tree data
    // In a real app, we might need to fetch the latest siblings from the server
    // if the local tree is outdated.

    // Use the group ID as the external nullifier/signal
    // Use the group ID as the external nullifier/signal
    guard let uuid = UUID(uuidString: group.id) else {
      throw GroupCredentialError.groupIntegrityError("Invalid Group ID")
    }

    // Use SemaphoreGroupManager to find the group and its members (commitments)
    // We need the local list of commitments to rebuild the tree for the proof
    let semaphoreGroup = SemaphoreGroupManager.shared.allGroups.first(where: { $0.id == uuid })

    guard let members = semaphoreGroup?.members, !members.isEmpty else {
      throw GroupCredentialError.groupIntegrityError("No local semaphore members found for group")
    }
    let canonicalMembers = Array(Set(members)).sorted()
    guard canonicalMembers.count > 1 else {
      throw GroupCredentialError.groupIntegrityError(
        "Semaphore group requires at least 2 distinct members for proof generation"
      )
    }

    return try SemaphoreIdentityManager.shared.generateProof(
      groupCommitments: canonicalMembers,
      message: Self.groupCredentialSignal(groupId: group.id),
      scope: Self.groupCredentialScope(groupId: group.id)
    )
  }
}

// MARK: - Supporting Types

enum GroupCredentialResult {
  case success(memberId: String, card: BusinessCard)
  case failure(memberId: String, error: Error)
}

enum GroupCredentialVerificationResult: Equatable {
  case valid(context: GroupCredentialContext)
  case expired
  case missingProof
  case invalidProof
  case invalid(String)
}

enum GroupCredentialError: Error {
  case permissionDenied
  case groupIntegrityError(String)
}
