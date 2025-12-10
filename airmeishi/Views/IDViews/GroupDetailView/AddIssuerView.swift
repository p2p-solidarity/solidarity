//
//  AddIssuerView.swift
//  airmeishi
//
//  View for adding new credential issuers to a group
//

import SwiftUI

struct AddIssuerView: View {
    let group: GroupModel
    let members: [GroupMemberModel]
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var groupManager = CloudKitGroupSyncManager.shared
    
    var availableMembers: [GroupMemberModel] {
        members.filter { 
            !group.credentialIssuers.contains($0.userRecordID) && 
            $0.userRecordID != group.ownerRecordID 
        }
    }
    
    var body: some View {
        NavigationView {
            List(availableMembers) { member in
                Button(action: {
                    Task {
                        try? await groupManager.addCredentialIssuer(userId: member.userRecordID, to: group)
                        dismiss()
                    }
                }) {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(member.userRecordID)
                                .font(.body)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Text(member.role.rawValue.capitalized)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        Spacer()
                        Image(systemName: "plus.circle")
                            .foregroundColor(.blue)
                    }
                }
            }
            .navigationTitle("Add Issuer")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .overlay {
                if availableMembers.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "person.2.slash")
                            .font(.largeTitle)
                            .foregroundColor(.secondary)
                        Text("No eligible members found")
                            .font(.headline)
                        Text("All members are already issuers or the owner.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
        }
    }
}
