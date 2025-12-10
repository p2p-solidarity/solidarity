//
//  CredentialIssuersSection.swift
//  airmeishi
//
//  Section for managing credential issuers in GroupDetailView
//

import SwiftUI

struct CredentialIssuersSection: View {
    let group: GroupModel
    @ObservedObject private var groupManager = CloudKitGroupSyncManager.shared
    @State private var members: [GroupMemberModel] = []
    @State private var showAddIssuer = false
    
    var isOwner: Bool {
        group.ownerRecordID == groupManager.currentUserRecordID?.recordName
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Credential Issuers")
                    .font(.headline)
                    .foregroundColor(.secondary)
                Spacer()
                if isOwner {
                    Button(action: { showAddIssuer = true }) {
                        Image(systemName: "plus.circle.fill")
                            .foregroundColor(.blue)
                    }
                }
            }
            
            // Owner (always shown)
            IssuerRow(
                userRecordID: group.ownerRecordID,
                isOwner: true,
                canRemove: false
            )
            
            // Additional issuers
            ForEach(members.filter { group.credentialIssuers.contains($0.userRecordID) }) { member in
                IssuerRow(
                    userRecordID: member.userRecordID,
                    isOwner: false,
                    canRemove: isOwner,
                    onRemove: {
                        Task {
                            try? await groupManager.removeCredentialIssuer(
                                userId: member.userRecordID,
                                from: group
                            )
                        }
                    }
                )
            }
            
            if members.filter({ group.credentialIssuers.contains($0.userRecordID) }).isEmpty {
                Text(isOwner
                     ? "No additional issuers configured yet."
                     : "Only the group owner can assign additional credential issuers.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(12)
        .sheet(isPresented: $showAddIssuer) {
            AddIssuerView(group: group, members: members)
        }
        .task {
            // Refresh data to ensure we see new members
            try? await groupManager.fetchLatestChanges()
            members = (try? await groupManager.getMembers(for: group)) ?? []
        }
    }
}

struct IssuerRow: View {
    let userRecordID: String
    let isOwner: Bool
    let canRemove: Bool
    var onRemove: (() -> Void)? = nil
    
    var body: some View {
        HStack {
            Image(systemName: isOwner ? "crown.fill" : "person.badge.key.fill")
                .foregroundColor(isOwner ? .yellow : .blue)
            Text(userRecordID)
                .font(.subheadline)
                .lineLimit(1)
                .truncationMode(.middle)
            if isOwner {
                Text("(Owner)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            Spacer()
            if canRemove, let onRemove = onRemove {
                Button(role: .destructive, action: onRemove) {
                    Image(systemName: "minus.circle.fill")
                }
            }
        }
        .padding(.vertical, 4)
    }
}
