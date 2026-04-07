import SwiftUI

struct GroupIdentityView: View {
  @ObservedObject private var coordinator = IdentityCoordinator.shared
  @ObservedObject private var groupManager = CloudKitGroupSyncManager.shared

  var body: some View {
    ScrollView {
      VStack(spacing: 16) {
        headerSection
        membersSection
        actionsSection
      }
      .padding(16)
    }
    .background(Color.Theme.pageBg.ignoresSafeArea())
  }

  private var headerSection: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("SELECTED GROUP")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textTertiary)
        .padding(.bottom, 8)

      VStack(spacing: 1) {
        if groupManager.groups.isEmpty {
          Text("No groups found. Create or join a group.")
            .font(.system(size: 14))
            .foregroundColor(Color.Theme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(Color.Theme.searchBg)
        } else {
          ForEach(groupManager.groups) { group in
            NavigationLink(destination: GroupDetailView(group: group)) {
              VStack(alignment: .leading, spacing: 4) {
                Text(group.name)
                  .font(.system(size: 14, weight: .semibold))
                  .foregroundColor(Color.Theme.textPrimary)
                Text("Members: \(group.memberCount)")
                  .font(.system(size: 12, design: .monospaced))
                  .foregroundColor(Color.Theme.textSecondary)
              }
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(16)
              .background(Color.Theme.searchBg)
            }
          }
        }
      }
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    }
  }

  private var membersSection: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("MEMBERS DETAILS")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textTertiary)
        .padding(.bottom, 8)

      Text("Member details are managed via CloudKit.")
        .font(.system(size: 14))
        .foregroundColor(Color.Theme.textSecondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.Theme.searchBg)
        .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    }
  }

  @State private var showJoinSheet = false

  private var actionsSection: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("ACTIONS")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textTertiary)
        .padding(.bottom, 8)

      VStack(spacing: 12) {
        Button(
          action: {
            showJoinSheet = true
          },
          label: {
            Label("Join Group", systemImage: "person.badge.plus")
              .frame(maxWidth: .infinity)
          }
        )
        .buttonStyle(ThemedSecondaryButtonStyle())

        Button(
          action: {
            Task {
              try? await groupManager.fetchLatestChanges()
            }
          },
          label: {
            Label("Refresh Groups", systemImage: "arrow.clockwise")
              .frame(maxWidth: .infinity)
          }
        )
        .buttonStyle(ThemedSecondaryButtonStyle())
      }
    }
    .sheet(isPresented: $showJoinSheet) {
      GroupJoinSheet()
    }
  }
}

#Preview {
  GroupIdentityView()
}
