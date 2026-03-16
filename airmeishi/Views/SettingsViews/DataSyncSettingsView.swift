import SwiftUI

struct DataSyncSettingsView: View {
  @StateObject private var identityStore = IdentityDataStore.shared
  @StateObject private var backupManager = BackupManager.shared
  @State private var showingAlert = false
  @State private var alertMessage = ""
  @State private var showingShareSheet = false
  @State private var shareItems: [Any] = []

  var body: some View {
    Form {
      Section("Sync & Backup") {
        NavigationLink {
          BackupSettingsView()
        } label: {
          HStack {
            Label("iCloud Backup & Restore", systemImage: "icloud")
            Spacer()
            Text(backupManager.settings.enabled ? "On" : "Off")
              .foregroundColor(Color.Theme.textSecondary)
          }
        }

        HStack {
          Text("Identity records in Vault")
          Spacer()
          Text("\(identityStore.identityCards.count) cards")
            .foregroundColor(Color.Theme.textSecondary)
        }
      }

      Section("Import / Export") {
        NavigationLink {
          VCSettingsView()
        } label: {
          Label("Import W3C Credentials", systemImage: "square.and.arrow.down")
        }

        Button(action: exportGraph) {
          Label("Export Verified Graph Data", systemImage: "square.and.arrow.up")
        }
        .foregroundColor(Color.Theme.textPrimary)
      }
    }
    .navigationTitle("Data & Sync")
    .navigationBarTitleDisplayMode(.inline)
    .sheet(isPresented: $showingShareSheet) {
      ShareSheet(activityItems: shareItems)
    }
    .onAppear {
      backupManager.loadSettings()
    }
    .alert("Export Error", isPresented: $showingAlert) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(alertMessage)
    }
  }

  private func exportGraph() {
    BiometricGatekeeper.shared.authorizeIfRequired(.exportGraph) { result in
      switch result {
      case .failure(let error):
        alertMessage = error.localizedDescription
        showingAlert = true
      case .success:
        let export = SocialGraphExportService.shared.exportGraphJSON()
        switch export {
        case .failure(let error):
          alertMessage = error.localizedDescription
          showingAlert = true
        case .success(let fileURL):
          shareItems = [fileURL]
          showingShareSheet = true
        }
      }
    }
  }
}
