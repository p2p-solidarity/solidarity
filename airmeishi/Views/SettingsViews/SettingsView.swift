import SwiftUI

struct SettingsView: View {
  @EnvironmentObject private var theme: ThemeManager
  @ObservedObject private var devMode = DeveloperModeManager.shared

  var body: some View {
    NavigationStack {
      Form {
        Section("Account & Identity") {
          NavigationLink {
            VCSettingsView()
          } label: {
            Label("Identity Profile", systemImage: "person.text.rectangle")
          }
        }

        Section("Preferences") {
          NavigationLink {
            SecuritySettingsView()
          } label: {
            Label("Security & Keys", systemImage: "lock.shield")
          }

          NavigationLink {
            DataSyncSettingsView()
          } label: {
            Label("Data & Sync", systemImage: "server.rack")
          }

          NavigationLink {
            AdvancedSettingsView()
          } label: {
            Label("Advanced", systemImage: "gearshape.2")
          }
        }

        Section("About") {
          HStack {
            Text("Version")
            Spacer()
            Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? String(localized: "Unknown"))
              .foregroundColor(.secondary)
          }
          .contentShape(Rectangle())
          .onTapGesture {
            devMode.registerVersionTap()
          }
        }
      }
      .navigationTitle("Settings")
    }
  }
}

#Preview {
  SettingsView()
    .environmentObject(ThemeManager.shared)
}
