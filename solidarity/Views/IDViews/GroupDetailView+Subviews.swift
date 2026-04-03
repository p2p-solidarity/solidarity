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

// MARK: - OIDC Section

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
