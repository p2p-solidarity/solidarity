import SwiftUI

enum DataSyncSettingsSection: Hashable {
  case syncBackup
  case importExport
  case identityKeyRecovery
}

struct DataSyncSettingsView: View {
  @ObservedObject private var devMode = DeveloperModeManager.shared
  @StateObject private var identityStore = IdentityDataStore.shared
  @StateObject private var backupManager = BackupManager.shared
  @State private var showingAlert = false
  @State private var alertTitle = LocalizedStringKey("Export Error")
  @State private var alertMessage = ""
  @State private var showingShareSheet = false
  @State private var shareItems: [Any] = []
  @State private var showingResetConfirm = false
  @State private var isResetting = false

  var body: some View {
    ScrollView {
      VStack(spacing: 24) {
        ForEach(Self.sections(isDeveloperMode: devMode.isDeveloperMode), id: \.self) { section in
          sectionView(section)
        }
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
    .alert(alertTitle, isPresented: $showingAlert) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(alertMessage)
    }
    .confirmationDialog(
      "Reset Identity Keys?",
      isPresented: $showingResetConfirm,
      titleVisibility: .visible
    ) {
      Button("Reset & Disable iCloud DID Sync", role: .destructive, action: resetIdentityKeysToLocal)
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(
        "Removes corrupted iCloud Keychain DID entries and switches your master "
          + "key to local-only. Existing credentials will need to be re-issued. "
          + "You'll be asked to relaunch the app."
      )
    }
  }

  static func sections(isDeveloperMode: Bool) -> [DataSyncSettingsSection] {
    var sections: [DataSyncSettingsSection] = [
      .syncBackup,
      .importExport,
    ]
    if isDeveloperMode {
      sections.append(.identityKeyRecovery)
    }
    return sections
  }

  @ViewBuilder
  private func sectionView(_ section: DataSyncSettingsSection) -> some View {
    switch section {
    case .syncBackup:
      syncBackupSection
    case .importExport:
      importExportSection
    case .identityKeyRecovery:
      identityKeyRecoverySection
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

  // MARK: - Identity Key Recovery

  private var identityKeyRecoverySection: some View {
    SettingsBlockSection("Identity Key Recovery") {
      Button(action: { showingResetConfirm = true }) {
        SettingsBlockDangerRow(
          icon: "key.slash",
          title: "Reset Identity Keys (Local-Only)",
          subtitle: "Use if Save Passport Credential keeps failing"
        )
      }
      .buttonStyle(.plain)
      .disabled(isResetting)
    }
  }

  /// Drops every keychain entry under each historical master alias (legacy,
  /// v1, v2, local) across both local and iCloud-synced scopes, sets the
  /// `useLocalAliasMarker` flag, and prompts a relaunch. After relaunch the
  /// shared `KeychainService` re-initializes with `localMasterAlias`, which
  /// generates fresh keys as `kSecAttrSynchronizable: false` — the iCloud
  /// bag's phantom blockers don't apply outside the sync scope.
  private func resetIdentityKeysToLocal() {
    isResetting = true
    BiometricGatekeeper.shared.authorizeIfRequired(.rotateMasterKey) { result in
      switch result {
      case .failure(let error):
        isResetting = false
        alertTitle = LocalizedStringKey("Authentication Failed")
        alertMessage = error.localizedDescription
        showingAlert = true
      case .success:
        let aliases = [
          KeychainService.legacyMasterAlias,
          KeychainService.v1MasterAlias,
          KeychainService.modernMasterAlias,
          KeychainService.localMasterAlias,
        ]
        for alias in aliases {
          let svc = KeychainService(alias: alias)
          svc.cleanupAllOldKeys()
          svc.clearInMemoryKey()
        }

        IdentityCacheStore().clearAll()

        let defaults = UserDefaults.standard
        defaults.set(true, forKey: KeychainService.useLocalAliasMarker)
        // Also clear the iCloud-sync wait marker so a future toggle back to
        // iCloud-synced mode (manual flag flip) re-runs the 5 s wait.
        defaults.removeObject(forKey: KeychainService.iCloudKeychainSyncWaitMarker)
        for alias in aliases {
          defaults.removeObject(forKey: "solidarity.migration.completed.\(alias)")
        }

        isResetting = false
        alertTitle = LocalizedStringKey("Reset Complete")
        alertMessage = String(
          localized: "Identity keys reset to local-only. Please force-quit and relaunch the app."
        )
        showingAlert = true
      }
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
        alertTitle = LocalizedStringKey("Export Error")
        alertMessage = error.localizedDescription
        showingAlert = true
      case .success:
        let export = SocialGraphExportService.shared.exportGraphJSON()
        switch export {
        case .failure(let error):
          alertTitle = LocalizedStringKey("Export Error")
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
