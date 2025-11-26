import SwiftUI

struct GroupIdentityView: View {
    @ObservedObject private var coordinator = IdentityCoordinator.shared
    @ObservedObject private var groupManager = CloudKitGroupSyncManager.shared

    var body: some View {
        List {
            headerSection
            membersSection
            actionsSection
        }
        .listStyle(.insetGrouped)
    }

    private var headerSection: some View {
        Section("Selected Group") {
            // For now, we don't have a "selected group" concept in the manager globally,
            // but we can list all groups or just show a placeholder.
            // Or we can iterate over groups.
            // Given the original view was for a SINGLE selected group, this view might need a redesign.
            // For MVP, I'll just list the groups.
            
            if groupManager.groups.isEmpty {
                Text("No groups found. Create or join a group.")
                    .foregroundColor(.secondary)
            } else {
                ForEach(groupManager.groups) { group in
                    VStack(alignment: .leading) {
                        Text(group.name)
                            .font(.headline)
                        Text("Members: \(group.memberCount)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
        }
    }

    private var membersSection: some View {
        Section("Members Details") {
            // CloudKit groups don't expose full member list locally unless fetched.
            // We only have memberCount in GroupModel.
            // So we can't list members easily here without fetching.
            Text("Member details are managed via CloudKit.")
                .foregroundColor(.secondary)
        }
    }

    private var actionsSection: some View {
        Section("Actions") {
            Button {
                Task {
                    try? await groupManager.fetchLatestChanges()
                }
            } label: {
                Label("Refresh Groups", systemImage: "arrow.clockwise")
            }
        }
    }
}

#Preview {
    GroupIdentityView()
}
