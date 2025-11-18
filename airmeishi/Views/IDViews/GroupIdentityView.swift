import SwiftUI

struct GroupIdentityView: View {
    @ObservedObject private var coordinator = IdentityCoordinator.shared
    @ObservedObject private var groupManager = SemaphoreGroupManager.shared

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
            if let selection = currentGroup {
                LabeledContent("Name", value: selection.name)
                if let root = selection.root {
                    LabeledContent("Merkle Root", value: root)
                }
                Text("Members: \(selection.members.count)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            } else {
                Text("No group selected. Create or import a group to begin.")
                    .foregroundColor(.secondary)
            }

            if let commitment = coordinator.state.zkIdentity?.commitment,
               let index = groupManager.members.firstIndex(of: commitment) {
                Text("Your commitment is member #\(index + 1)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }

    private var membersSection: some View {
        Section("Members") {
            if groupManager.members.isEmpty {
                Text("Group has no members yet.")
                    .foregroundColor(.secondary)
            } else {
                ForEach(Array(groupManager.members.enumerated()), id: \.offset) { index, _ in
                    Text("Member #\(index + 1)")
                        .font(.subheadline)
                }
            }
        }
    }

    private var actionsSection: some View {
        Section("Actions") {
            Button {
                groupManager.recomputeRoot()
            } label: {
                Label("Recompute Root", systemImage: "arrow.triangle.2.circlepath")
            }
            .disabled(groupManager.members.isEmpty)
        }
    }

    private var currentGroup: SemaphoreGroupManager.ManagedGroup? {
        guard let id = groupManager.selectedGroupId else { return nil }
        return groupManager.allGroups.first(where: { $0.id == id })
    }
}

#Preview {
    GroupIdentityView()
}
