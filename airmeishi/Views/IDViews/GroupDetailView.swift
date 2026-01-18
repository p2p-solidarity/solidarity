//
//  GroupDetailView.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import SwiftUI

struct GroupDetailView: View {
  let group: GroupModel
  @ObservedObject private var semaphoreManager = SemaphoreGroupManager.shared
  @ObservedObject private var cloudKitManager = CloudKitGroupSyncManager.shared

  @State private var members: [GroupMemberModel] = []
  @State private var isLoadingMembers = false
  @State private var errorMessage: String?

  var isOwner: Bool {
    group.ownerRecordID == cloudKitManager.currentUserRecordID?.recordName
  }

  var body: some View {
    ScrollView {
      LazyVStack(spacing: 20) {
        // MARK: - Error Banner
        if let error = errorMessage {
          Text(error)
            .font(.caption)
            .foregroundColor(.red)
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.red.opacity(0.1))
            .cornerRadius(8)
        }

        // MARK: - Group Info
        GroupInfoSection(group: group, memberCount: members.count)

        // MARK: - Merkle Tree
        MerkleTreeSection(group: group, semaphoreManager: semaphoreManager)

        // MARK: - Invite
        InviteSection(group: group)

        // MARK: - Members
        MembersSection(
          members: members,
          isLoading: isLoadingMembers,
          isOwner: isOwner,
          onKick: kickMember,
          onApprove: approveMember,
          onReject: rejectMember
        )

        // MARK: - Admin Tools
        if isOwner || cloudKitManager.canIssueCredentials(for: group) {
          VStack(alignment: .leading, spacing: 16) {
            Text("Admin Tools")
              .font(.headline)
              .foregroundColor(.secondary)
              .padding(.leading, 4)

            CredentialIssuersSection(group: group)
            GroupVCIssuanceSection(group: group)
            DeliverySettingsSection(group: group)
          }
        }

        // MARK: - OIDC Integration
        OIDCSection(group: group)
      }
      .padding()
    }
    .background(Color(.systemGroupedBackground))
    .navigationTitle(group.name)
    .navigationBarTitleDisplayMode(.inline)
    .task {
      await loadData()
    }
    .refreshable {
      await loadData()
    }
  }

  private func loadData() async {
    // Ensure account status and sync engine are ready
    await cloudKitManager.checkAccountStatus()
    cloudKitManager.startSyncEngine()

    isLoadingMembers = true
    defer { isLoadingMembers = false }

    // Sync Semaphore
    if let uuid = UUID(uuidString: group.id) {
      semaphoreManager.ensureGroupFromInvite(id: uuid, name: group.name, root: group.merkleRoot)
    }

    // Fetch Members
    do {
      members = try await cloudKitManager.getMembers(for: group)

      // Sync Merkle tree memberships with CloudKit members
      if let uuid = UUID(uuidString: group.id) {
        // Make sure the correct group is selected
        SemaphoreGroupManager.shared.selectGroup(uuid)

        // Collect all known commitments from members
        var commitments = members.compactMap { $0.commitment }

        // Ensure our own commitment is also included if present
        if let selfCommitment = SemaphoreIdentityManager.shared.getIdentity()?.commitment,
          !commitments.contains(selfCommitment)
        {
          commitments.append(selfCommitment)
        }

        // Update Semaphore group's members list
        SemaphoreGroupManager.shared.setMembers(commitments)
      }
    } catch {
      print("Error fetching members: \(error)")
      errorMessage = error.localizedDescription
    }
  }

  private func kickMember(_ member: GroupMemberModel) {
    Task {
      do {
        try await cloudKitManager.kickMember(userId: member.userRecordID, from: group)
        await loadData()
      } catch {
        print("Error kicking member: \(error)")
      }
    }
  }

  private func approveMember(_ member: GroupMemberModel) {
    Task {
      do {
        try await cloudKitManager.approveMember(userId: member.userRecordID, from: group)
        await loadData()
      } catch {
        print("Error approving member: \(error)")
      }
    }
  }

  private func rejectMember(_ member: GroupMemberModel) {
    Task {
      do {
        try await cloudKitManager.rejectMember(userId: member.userRecordID, from: group)
        await loadData()
      } catch {
        print("Error rejecting member: \(error)")
      }
    }
  }
}
