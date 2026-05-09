import SwiftUI

struct DataSyncSettingsView: View {
  @StateObject private var identityStore = IdentityDataStore.shared
  @StateObject private var backupManager = BackupManager.shared
  @State private var showingAlert = false
  @State private var alertMessage = ""
  @State private var showingShareSheet = false
  @State private var shareItems: [Any] = []

  var body: some View {
    ScrollView {
      VStack(spacing: 24) {
        syncBackupSection
        importExportSection
      }
      .padding(.vertical, 24)
    }
    .background(Color.Theme.pageBg.ignoresSafeArea())
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

  // MARK: - Sync & Backup

  private var syncBackupSection: some View {
    SettingsBlockSection("Sync & Backup") {
      NavigationLink {
        BackupSettingsView()
      } label: {
        SettingsBlockRow(
          icon: "icloud",
          title: "iCloud Backup & Restore",
          trailingText: backupManager.settings.enabled ? "On" : "Off"
        )
      }
      .buttonStyle(.plain)

      SettingsBlockInfoRow(
        icon: "list.bullet.rectangle",
        title: "Identity records in Vault",
        value: "\(identityStore.identityCards.count) cards"
      )
    }
  }

  // MARK: - Import / Export

  private var importExportSection: some View {
    SettingsBlockSection("Import / Export") {
      NavigationLink {
        VCSettingsView()
      } label: {
        SettingsBlockRow(
          icon: "square.and.arrow.down",
          title: "Import W3C Credentials"
        )
      }
      .buttonStyle(.plain)

      Button(action: exportGraph) {
        SettingsBlockRow(
          icon: "square.and.arrow.up",
          title: "Export Verified Graph Data"
        )
      }
      .buttonStyle(.plain)
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
