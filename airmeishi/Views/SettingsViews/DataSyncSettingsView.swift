import SwiftUI

struct DataSyncSettingsView: View {
  @StateObject private var identityStore = IdentityDataStore.shared
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
          Label("iCloud Backup & Restore", systemImage: "icloud")
        }

        HStack {
          Text("Identity records in Vault")
          Spacer()
          Text("\(identityStore.identityCards.count) cards")
            .foregroundColor(.secondary)
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
