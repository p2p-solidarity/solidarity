import SwiftUI

struct SettingsView: View {
  @EnvironmentObject private var theme: ThemeManager
  @StateObject private var identityStore = IdentityDataStore.shared
  @StateObject private var policyStore = SensitiveActionPolicyStore.shared
  @StateObject private var cardManager = CardManager.shared
  @ObservedObject private var devMode = DeveloperModeManager.shared

  @State private var showingAlert = false
  @State private var alertMessage = ""
  @State private var showingResetConfirm = false
  @State private var showingShareSheet = false
  @State private var shareItems: [Any] = []

  var body: some View {
    NavigationStack {
      Form {
        accountSection
        keySection
        syncSection
        importExportSection
        advancedSection
        dangerSection
        versionSection
      }
      .navigationTitle("Settings")
      .sheet(isPresented: $showingShareSheet) {
        ShareSheet(activityItems: shareItems)
      }
      .alert("Settings", isPresented: $showingAlert) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(alertMessage)
      }
      .confirmationDialog("Reset local app data?", isPresented: $showingResetConfirm, titleVisibility: .visible) {
        Button("Reset", role: .destructive) {
          resetLocalData()
        }
        Button("Cancel", role: .cancel) {}
      } message: {
        Text("This clears local encrypted files and onboarding status.")
      }
    }
  }

  private var accountSection: some View {
    Section("Account & Identity") {
      NavigationLink {
        VCSettingsView()
      } label: {
        Label("Identity Cards", systemImage: "person.text.rectangle")
      }

      HStack {
        Text("Current DID")
        Spacer()
        Text(shortDid)
          .font(.caption.monospaced())
          .foregroundColor(.secondary)
      }
    }
  }

  private var keySection: some View {
    Section("Keys & Security") {
      Button("Rotate DID Master Key") {
        rotateMasterKey()
      }

      ForEach(SensitiveAction.allCases) { action in
        Toggle(isOn: Binding(
          get: { policyStore.requiresBiometric(action) },
          set: { policyStore.setRequirement($0, for: action) }
        )) {
          Text(faceIdLabel(for: action))
            .font(.subheadline)
        }
      }
    }
  }

  private var syncSection: some View {
    Section("Sync & Backup") {
      NavigationLink {
        BackupSettingsView()
      } label: {
        Label("iCloud Backup & Restore", systemImage: "icloud")
      }

      HStack {
        Text("Identity records")
        Spacer()
        Text("\(identityStore.identityCards.count) cards")
          .foregroundColor(.secondary)
      }
    }
  }

  private var importExportSection: some View {
    Section("Import / Export") {
      NavigationLink {
        VCSettingsView()
      } label: {
        Label("Import Credentials", systemImage: "square.and.arrow.down")
      }

      Button("Export Verified Graph") {
        exportGraph()
      }
    }
  }

  private var advancedSection: some View {
    Section("Advanced") {
      NavigationLink {
        AppearanceSettingsView()
      } label: {
        Label("Appearance", systemImage: "paintbrush")
      }

      if devMode.isDeveloperMode {
        NavigationLink {
          GroupManagementView()
        } label: {
          Label("Developer Group Management", systemImage: "person.3")
        }
      } else {
        Text("Tap version several times to enable developer mode.")
          .font(.caption)
          .foregroundColor(.secondary)
      }
    }
  }

  private var dangerSection: some View {
    Section("Danger Zone") {
      Button("Reset Local App Data", role: .destructive) {
        showingResetConfirm = true
      }
    }
  }

  private var versionSection: some View {
    Section("About") {
      HStack {
        Text("Version")
        Spacer()
        Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "Unknown")
          .foregroundColor(.secondary)
      }
      .contentShape(Rectangle())
      .onTapGesture {
        devMode.registerVersionTap()
      }
    }
  }

  private var shortDid: String {
    switch DIDService().currentDescriptor() {
    case .failure:
      return "did:key:pending"
    case .success(let descriptor):
      let did = descriptor.did
      guard did.count > 24 else { return did }
      return "\(did.prefix(12))...\(did.suffix(8))"
    }
  }

  private func faceIdLabel(for action: SensitiveAction) -> String {
    switch action {
    case .issueCredential:
      return "Face ID for credential issuance"
    case .presentProof:
      return "Face ID for proof presentation"
    case .exportGraph:
      return "Face ID for graph export"
    case .rotateMasterKey:
      return "Face ID for key rotation"
    case .revealRecoveryBundle:
      return "Face ID for recovery bundle access"
    }
  }

  private func rotateMasterKey() {
    BiometricGatekeeper.shared.authorizeIfRequired(.rotateMasterKey) { result in
      switch result {
      case .failure(let error):
        alertMessage = error.localizedDescription
        showingAlert = true
      case .success:
        switch KeychainService.shared.resetSigningKey() {
        case .failure(let error):
          alertMessage = error.localizedDescription
          showingAlert = true
        case .success:
          _ = KeychainService.shared.ensurePairwiseKey(for: "solidarity.gg")
          alertMessage = "Master key rotated successfully."
          showingAlert = true
        }
      }
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

  private func resetLocalData() {
    BiometricGatekeeper.shared.authorizeIfRequired(.rotateMasterKey) { result in
      switch result {
      case .failure(let error):
        alertMessage = error.localizedDescription
        showingAlert = true
      case .success:
        _ = StorageManager.shared.clearAllData()
        UserDefaults.standard.removeObject(forKey: "solidarity.onboarding.completed")
        UserDefaults.standard.removeObject(forKey: "solidarity.identity.swiftdata.migrated.v1")
        alertMessage = "Local data reset completed."
        showingAlert = true
      }
    }
  }
}

#Preview {
  SettingsView()
    .environmentObject(ThemeManager.shared)
}
