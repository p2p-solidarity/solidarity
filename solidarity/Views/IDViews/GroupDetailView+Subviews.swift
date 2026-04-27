//
//  GroupDetailView+Subviews.swift
//  solidarity
//
//  Created by Solidarity Team.
//

import SwiftUI
import CloudKit

// MARK: - Subviews

struct GroupInfoSection: View {
  let group: GroupModel
  let memberCount: Int

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Group Info")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textSecondary)

      if let current = CloudKitGroupSyncManager.shared.currentUserRecordID?.recordName {
        if group.ownerRecordID == current {
          Label("You are the owner", systemImage: "crown.fill")
            .font(.caption)
            .foregroundColor(Color.Theme.dustyMauve)
        } else if group.credentialIssuers.contains(current) {
          Label("You can issue Group VCs", systemImage: "person.badge.key.fill")
            .font(.caption)
            .foregroundColor(Color.Theme.primaryBlue)
        }
      }

      VStack(alignment: .leading, spacing: 8) {
        LabeledContent("Name", value: group.name)
        if !group.description.isEmpty {
          LabeledContent("Description", value: group.description)
        }
        LabeledContent("ID", value: group.id)
          .font(.caption)
          .foregroundColor(Color.Theme.textSecondary)
          .textSelection(.enabled)

        LabeledContent("Members", value: "\(memberCount)")
      }
      .padding(16)
      .background(Color.Theme.searchBg)
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    }
  }
}

struct MerkleTreeSection: View {
  let group: GroupModel
  @ObservedObject var semaphoreManager: SemaphoreGroupManager

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Merkle Tree")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textSecondary)

      VStack(alignment: .leading, spacing: 12) {
        if let root = semaphoreManager.merkleRoot {
          VStack(alignment: .leading, spacing: 4) {
            Text("Root Hash")
              .font(.caption)
              .foregroundColor(Color.Theme.textSecondary)
            Text(root)
              .font(.system(.caption, design: .monospaced))
              .textSelection(.enabled)
              .padding(8)
              .background(Color.Theme.searchBg)
              .cornerRadius(8)
          }
        } else {
          Text("No Root Calculated")
            .foregroundColor(Color.Theme.textSecondary)
        }

        Button(action: {
          semaphoreManager.recomputeRoot()
        }) {
          Label("Recompute Root", systemImage: "arrow.triangle.2.circlepath")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(ThemedSecondaryButtonStyle())

        if let commitment = SemaphoreIdentityManager.shared.getIdentity()?.commitment {
          if let index = semaphoreManager.indexOf(commitment) {
            Text("You are a member of this group (leaf index: \(index)).")
              .font(.caption)
              .foregroundColor(Color.Theme.terminalGreen)
          } else {
            Text("You are currently not a member of this group's Merkle tree.")
              .font(.caption)
              .foregroundColor(Color.Theme.accentRose)
          }
        }
      }
      .padding(16)
      .background(Color.Theme.searchBg)
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    }
  }
}

// MARK: - OIDC Section

struct OIDCSection: View {
  let group: GroupModel
  @ObservedObject private var cloudKitManager = CloudKitGroupSyncManager.shared
  @ObservedObject private var semaphoreManager = SemaphoreIdentityManager.shared
  @ObservedObject private var semaphoreGroupManager = SemaphoreGroupManager.shared

  @State private var generatedProof: String?
  @State private var generationError: String?
  @State private var isGenerating = false
  @State private var showingProofSheet = false

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Identity Info")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textSecondary)

      VStack(alignment: .leading, spacing: 12) {
        // User Name (Record ID)
        if let userID = cloudKitManager.currentUserRecordID?.recordName {
          VStack(alignment: .leading, spacing: 4) {
            Text("User ID")
              .font(.caption)
              .foregroundColor(Color.Theme.textSecondary)
            Text(userID)
              .font(.system(.caption, design: .monospaced))
              .textSelection(.enabled)
          }
        } else {
          Text("User ID not available")
            .font(.caption)
            .foregroundColor(Color.Theme.destructive)
        }

        Divider()

        // Leaf Hash (Commitment)
        if let identity = semaphoreManager.getIdentity() {
          VStack(alignment: .leading, spacing: 4) {
            Text("Leaf Hash (Commitment)")
              .font(.caption)
              .foregroundColor(Color.Theme.textSecondary)
            Text(identity.commitment)
              .font(.system(.caption, design: .monospaced))
              .textSelection(.enabled)
          }
        } else {
          Text("Identity not initialized")
            .font(.caption)
            .foregroundColor(Color.Theme.accentRose)
        }

        if let identity = semaphoreManager.getIdentity(),
          semaphoreGroupManager.indexOf(identity.commitment) != nil
        {
          Button(action: { generateProof() }) {
            HStack {
              if isGenerating {
                ProgressView()
              }
              Label("Generate Group Proof", systemImage: "lock.doc.fill")
            }
            .frame(maxWidth: .infinity)
          }
          .buttonStyle(ThemedSecondaryButtonStyle())
          .disabled(isGenerating)

          if let error = generationError {
            Text(error)
              .font(.caption)
              .foregroundColor(Color.Theme.accentRose)
          }
        }
      }
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Color.Theme.searchBg)
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    }
    .sheet(isPresented: $showingProofSheet) {
      if let proof = generatedProof {
        GroupProofSheet(proofJSON: proof, groupName: group.name)
      }
    }
  }

  private func generateProof() {
    guard let identity = semaphoreManager.getIdentity() else { return }
    isGenerating = true
    generationError = nil
    Task.detached(priority: .userInitiated) {
      do {
        let members = await MainActor.run { semaphoreGroupManager.members }
        let canonical = Array(Set(members + [identity.commitment])).sorted()
        guard canonical.count > 1 else {
          throw SemaphoreIdentityManager.Error.invalidCommitment(
            "Group needs at least 2 distinct members for a proof"
          )
        }
        let proofJSON = try SemaphoreIdentityManager.shared.generateProof(
          groupCommitments: canonical,
          message: GroupCredentialService.groupCredentialSignal(groupId: group.id),
          scope: GroupCredentialService.groupCredentialScope(groupId: group.id)
        )
        await MainActor.run {
          generatedProof = proofJSON
          isGenerating = false
          showingProofSheet = true
        }
      } catch {
        await MainActor.run {
          generationError = error.localizedDescription
          isGenerating = false
        }
      }
    }
  }
}

// MARK: - Group Proof Sheet

struct GroupProofSheet: View {
  let proofJSON: String
  let groupName: String
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 12) {
          Text("Group Membership Proof")
            .font(.system(size: 12, weight: .bold, design: .monospaced))
            .foregroundColor(Color.Theme.textSecondary)
          Text(groupName)
            .font(.headline)

          Text(proofJSON)
            .font(.system(.caption, design: .monospaced))
            .textSelection(.enabled)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.Theme.searchBg)
            .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))

          Button {
            UIPasteboard.general.string = proofJSON
          } label: {
            Label("Copy Proof", systemImage: "doc.on.doc")
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(ThemedSecondaryButtonStyle())
        }
        .padding(16)
      }
      .navigationTitle("Proof")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button("Done") { dismiss() }
        }
      }
    }
  }
}
