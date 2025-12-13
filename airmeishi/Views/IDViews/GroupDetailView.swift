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

// MARK: - Subviews

struct GroupInfoSection: View {
  let group: GroupModel
  let memberCount: Int

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Group Info")
        .font(.headline)
        .foregroundColor(.secondary)

      if let current = CloudKitGroupSyncManager.shared.currentUserRecordID?.recordName {
        if group.ownerRecordID == current {
          Label("You are the owner", systemImage: "crown.fill")
            .font(.caption)
            .foregroundColor(.yellow)
        } else if group.credentialIssuers.contains(current) {
          Label("You can issue Group VCs", systemImage: "person.badge.key.fill")
            .font(.caption)
            .foregroundColor(.blue)
        }
      }

      VStack(alignment: .leading, spacing: 8) {
        LabeledContent("Name", value: group.name)
        if !group.description.isEmpty {
          LabeledContent("Description", value: group.description)
        }
        LabeledContent("ID", value: group.id)
          .font(.caption)
          .foregroundColor(.secondary)
          .textSelection(.enabled)

        LabeledContent("Members", value: "\(memberCount)")
      }
      .padding()
      .background(Color(.secondarySystemGroupedBackground))
      .cornerRadius(12)
    }
  }
}

struct MerkleTreeSection: View {
  let group: GroupModel
  @ObservedObject var semaphoreManager: SemaphoreGroupManager

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Merkle Tree")
        .font(.headline)
        .foregroundColor(.secondary)

      VStack(alignment: .leading, spacing: 12) {
        if let root = semaphoreManager.merkleRoot {
          VStack(alignment: .leading, spacing: 4) {
            Text("Root Hash")
              .font(.caption)
              .foregroundColor(.secondary)
            Text(root)
              .font(.system(.caption, design: .monospaced))
              .textSelection(.enabled)
              .padding(8)
              .background(Color(.systemGray6))
              .cornerRadius(8)
          }
        } else {
          Text("No Root Calculated")
            .foregroundColor(.secondary)
        }

        Button(action: {
          semaphoreManager.recomputeRoot()
        }) {
          Label("Recompute Root", systemImage: "arrow.triangle.2.circlepath")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)

        if let commitment = SemaphoreIdentityManager.shared.getIdentity()?.commitment {
          if let index = semaphoreManager.indexOf(commitment) {
            Text("You are a member of this group (leaf index: \(index)).")
              .font(.caption)
              .foregroundColor(.green)
          } else {
            Text("You are currently not a member of this group's Merkle tree.")
              .font(.caption)
              .foregroundColor(.orange)
          }
        }
      }
      .padding()
      .background(Color(.secondarySystemGroupedBackground))
      .cornerRadius(12)
    }
  }
}

struct InviteSection: View {
  let group: GroupModel
  @State private var inviteLink: String?
  @State private var qrImage: UIImage?
  @State private var isLoading = false
  @State private var errorMessage: String?
  @State private var showQRCode = false

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Text("Invite Members")
          .font(.headline)
          .foregroundColor(.secondary)
        Spacer()
      }

      if isLoading {
        HStack {
          Spacer()
          ProgressView()
          Spacer()
        }
        .padding()
      } else if let link = inviteLink {
        VStack(spacing: 16) {
          // Link Display
          HStack {
            Text(link)
              .font(.system(.subheadline, design: .monospaced))
              .lineLimit(1)
              .truncationMode(.middle)
              .foregroundColor(.primary)
              .padding(8)
              .background(Color(.systemGray6))
              .cornerRadius(8)

            Button(action: {
              UIPasteboard.general.string = link
            }) {
              Image(systemName: "doc.on.doc")
                .font(.headline)
                .foregroundColor(.blue)
                .padding(8)
                .background(Color(.systemBlue).opacity(0.1))
                .clipShape(Circle())
            }
          }

          // QR Code Toggle
          Button(action: {
            withAnimation {
              showQRCode.toggle()
            }
          }) {
            HStack {
              Image(systemName: "qrcode")
              Text(showQRCode ? "Hide QR Code" : "Show QR Code")
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
          }
          .buttonStyle(.bordered)

          if showQRCode, let image = qrImage {
            Image(uiImage: image)
              .resizable()
              .interpolation(.none)
              .scaledToFit()
              .frame(width: 180, height: 180)
              .padding()
              .background(Color.white)
              .cornerRadius(12)
              .shadow(radius: 4)
              .transition(.scale.combined(with: .opacity))
          }
        }
      } else {
        Button(action: {
          loadInviteLink()
        }) {
          Text("Generate Invite Link")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
      }

      if let error = errorMessage {
        Text(error)
          .font(.caption)
          .foregroundColor(.red)
      }
    }
    .padding()
    .background(Color(.secondarySystemGroupedBackground))
    .cornerRadius(12)
    .onAppear {
      if inviteLink == nil {
        loadInviteLink()
      }
    }
  }

  private func loadInviteLink() {
    guard !isLoading else { return }
    isLoading = true
    errorMessage = nil

    Task {
      do {
        // This will now reuse existing token if available
        let link = try await CloudKitGroupSyncManager.shared.createInviteLink(for: group)

        // Generate QR Image
        var image: UIImage?
        if let filter = CIFilter(name: "CIQRCodeGenerator") {
          filter.setValue(link.data(using: .ascii), forKey: "inputMessage")
          if let output = filter.outputImage {
            let transform = CGAffineTransform(scaleX: 10, y: 10)
            let scaled = output.transformed(by: transform)
            let context = CIContext()
            if let cgImage = context.createCGImage(scaled, from: scaled.extent) {
              image = UIImage(cgImage: cgImage)
            }
          }
        }

        await MainActor.run {
          self.inviteLink = link
          self.qrImage = image
          self.isLoading = false
        }
      } catch {
        await MainActor.run {
          self.errorMessage = error.localizedDescription
          self.isLoading = false
        }
      }
    }
  }
}

struct MembersSection: View {
  let members: [GroupMemberModel]
  let isLoading: Bool
  let isOwner: Bool
  let onKick: (GroupMemberModel) -> Void
  let onApprove: (GroupMemberModel) -> Void
  let onReject: (GroupMemberModel) -> Void

  var pendingMembers: [GroupMemberModel] {
    members.filter { $0.status == .pending }
  }

  var activeMembers: [GroupMemberModel] {
    members.filter { $0.status == .active || $0.status == .kicked }  // Show kicked? Maybe not.
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text("Members")
          .font(.headline)
          .foregroundColor(.secondary)
        Spacer()

        // Syncing indicator removed as it was based on stale data

        if isLoading {
          ProgressView()
        }
      }

      if members.isEmpty && !isLoading {
        Text("No members found.")
          .foregroundColor(.secondary)
          .padding()
          .frame(maxWidth: .infinity, alignment: .center)
          .background(Color(.secondarySystemGroupedBackground))
          .cornerRadius(12)
      } else {
        LazyVStack(spacing: 16) {
          if !pendingMembers.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
              Text("Pending Requests")
                .font(.subheadline)
                .foregroundColor(.orange)
                .padding(.leading, 4)

              VStack(spacing: 1) {
                ForEach(pendingMembers) { member in
                  PendingMemberRow(
                    member: member,
                    isOwner: isOwner,
                    onApprove: { onApprove(member) },
                    onReject: { onReject(member) }
                  )
                  if member.id != pendingMembers.last?.id {
                    Divider().padding(.leading, 16)
                  }
                }
              }
              .background(Color(.secondarySystemGroupedBackground))
              .cornerRadius(12)
            }
          }

          if !activeMembers.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
              if !pendingMembers.isEmpty {
                Text("Active Members")
                  .font(.subheadline)
                  .foregroundColor(.secondary)
                  .padding(.leading, 4)
              }

              VStack(spacing: 1) {
                ForEach(activeMembers) { member in
                  MemberRow(member: member, isOwner: isOwner, onKick: { onKick(member) })
                  if member.id != activeMembers.last?.id {
                    Divider().padding(.leading, 16)
                  }
                }
              }
              .background(Color(.secondarySystemGroupedBackground))
              .cornerRadius(12)
            }
          }
        }
      }
    }
  }
}

struct PendingMemberRow: View {
  let member: GroupMemberModel
  let isOwner: Bool
  let onApprove: () -> Void
  let onReject: () -> Void

  var body: some View {
    HStack {
      VStack(alignment: .leading, spacing: 4) {
        Text(member.userRecordID)
          .font(.body)
          .lineLimit(1)
          .truncationMode(.middle)

        Text("Requesting to join")
          .font(.caption)
          .foregroundColor(.orange)
      }

      Spacer()

      if isOwner {
        HStack(spacing: 12) {
          Button(action: onReject) {
            Image(systemName: "xmark.circle.fill")
              .foregroundColor(.red)
              .font(.title2)
          }

          Button(action: onApprove) {
            Image(systemName: "checkmark.circle.fill")
              .foregroundColor(.green)
              .font(.title2)
          }
        }
      }
    }
    .padding()
    .background(Color(.secondarySystemGroupedBackground))
  }
}

struct MemberRow: View {
  let member: GroupMemberModel
  let isOwner: Bool
  let onKick: () -> Void

  var body: some View {
    HStack {
      VStack(alignment: .leading, spacing: 4) {
        Text(member.userRecordID)  // Ideally replace with Name
          .font(.body)
          .lineLimit(1)
          .truncationMode(.middle)

        HStack(spacing: 6) {
          Text(member.role.rawValue.capitalized)
            .font(.caption)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(member.role == .owner ? Color.blue.opacity(0.1) : Color.gray.opacity(0.1))
            .foregroundColor(member.role == .owner ? .blue : .secondary)
            .cornerRadius(4)

          if member.status == .kicked {
            Text("Kicked")
              .font(.caption)
              .foregroundColor(.red)
          }
        }
      }

      Spacer()

      if member.hasMessagingData {
        Image(systemName: "bubble.left.and.bubble.right.fill")
          .foregroundColor(.pink)
          .help("Can receive Sakura / Group VC")
      }

      if isOwner && member.role != .owner && member.status != .kicked {
        Button(role: .destructive, action: onKick) {
          Text("Kick")
            .foregroundColor(.red)
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
      }
    }
    .padding()
    .background(Color(.secondarySystemGroupedBackground))  // Ensure background for tap
  }
}

struct OIDCSection: View {
  let group: GroupModel
  @ObservedObject private var cloudKitManager = CloudKitGroupSyncManager.shared
  @ObservedObject private var semaphoreManager = SemaphoreIdentityManager.shared
  @ObservedObject private var semaphoreGroupManager = SemaphoreGroupManager.shared

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Identity Info")
        .font(.headline)
        .foregroundColor(.secondary)

      VStack(alignment: .leading, spacing: 12) {
        // User Name (Record ID)
        if let userID = cloudKitManager.currentUserRecordID?.recordName {
          VStack(alignment: .leading, spacing: 4) {
            Text("User ID")
              .font(.caption)
              .foregroundColor(.secondary)
            Text(userID)
              .font(.system(.caption, design: .monospaced))
              .textSelection(.enabled)
          }
        } else {
          Text("User ID not available")
            .font(.caption)
            .foregroundColor(.red)
        }

        Divider()

        // Leaf Hash (Commitment)
        if let identity = semaphoreManager.getIdentity() {
          VStack(alignment: .leading, spacing: 4) {
            Text("Leaf Hash (Commitment)")
              .font(.caption)
              .foregroundColor(.secondary)
            Text(identity.commitment)
              .font(.system(.caption, design: .monospaced))
              .textSelection(.enabled)
          }
        } else {
          Text("Identity not initialized")
            .font(.caption)
            .foregroundColor(.orange)
        }

        if let identity = semaphoreManager.getIdentity(),
          semaphoreGroupManager.indexOf(identity.commitment) != nil
        {
          Button(action: {
            // TODO: Generate Proof
          }) {
            Label("Generate Group Proof", systemImage: "lock.doc.fill")
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(.bordered)
        }
      }
      .padding()
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Color(.secondarySystemGroupedBackground))
      .cornerRadius(12)
    }
  }
}
