//
//  YourGroupsSectionView.swift
//  airmeishi
//
//  Created by Antigravity on 2025-12-03.
//

import SwiftUI
import CloudKit

struct YourGroupsSectionView: View {
    @ObservedObject var groupManager: CloudKitGroupSyncManager
    @Binding var selectedGroupToDelete: GroupModel?
    @Binding var showDeleteConfirm: Bool

    // MARK: - Derived Groups

    private var publicGroups: [GroupModel] {
        groupManager.groups.filter { !$0.isPrivate }
    }

    private var privateOwnedGroups: [GroupModel] {
        guard let me = groupManager.currentUserRecordID?.recordName else { return [] }
        return groupManager.groups.filter { $0.isPrivate && $0.ownerRecordID == me }
    }

    private var privateSharedGroups: [GroupModel] {
        guard let me = groupManager.currentUserRecordID?.recordName else { return [] }
        return groupManager.groups.filter { $0.isPrivate && $0.ownerRecordID != me }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Your Groups")
                .font(.title3)
                .fontWeight(.bold)
                .foregroundColor(.white)
                .padding(.horizontal, 20)
                .padding(.top, 8)

            if groupManager.groups.isEmpty {
                Text("No groups found. Create one to get started.")
                    .foregroundColor(.white.opacity(0.6))
                    .padding(.horizontal, 20)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    // Public Groups
                    if !publicGroups.isEmpty {
                        Text("Public Groups")
                            .font(.subheadline)
                            .foregroundColor(.white.opacity(0.7))
                            .padding(.horizontal, 20)

                        LazyVStack(spacing: 16) {
                            ForEach(publicGroups) { group in
                                NavigationLink(destination: GroupDetailView(group: group)) {
                                    GroupManagementCardView(group: group) {
                                        selectedGroupToDelete = group
                                        showDeleteConfirm = true
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 20)
                    }

                    // Private (Owned)
                    if !privateOwnedGroups.isEmpty {
                        Text("Your Private Groups")
                            .font(.subheadline)
                            .foregroundColor(.white.opacity(0.7))
                            .padding(.horizontal, 20)
                            .padding(.top, 4)

                        LazyVStack(spacing: 16) {
                            ForEach(privateOwnedGroups) { group in
                                NavigationLink(destination: GroupDetailView(group: group)) {
                                    GroupManagementCardView(group: group) {
                                        selectedGroupToDelete = group
                                        showDeleteConfirm = true
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 20)
                    }

                    // Private (Shared with you)
                    if !privateSharedGroups.isEmpty {
                        Text("Shared With You")
                            .font(.subheadline)
                            .foregroundColor(.white.opacity(0.7))
                            .padding(.horizontal, 20)
                            .padding(.top, 4)

                        LazyVStack(spacing: 16) {
                            ForEach(privateSharedGroups) { group in
                                NavigationLink(destination: GroupDetailView(group: group)) {
                                    GroupManagementCardView(group: group) {
                                        // Shared groups might not be deletable by non-owners,
                                        // but keeping the option for now as per request.
                                        selectedGroupToDelete = group
                                        showDeleteConfirm = true
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 20)
                    }
                }
            }
        }
    }
}
