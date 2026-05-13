import Security
import SwiftUI

struct AdvancedSettingsView: View {
  @ObservedObject private var devMode = DeveloperModeManager.shared
  @State private var showingPassportPipeline = false
  @State private var showingZKSettings = false
  @State private var showingOIDCRequest = false
  @State private var showingAlert = false
  @State private var alertMessage = ""
  @State private var showingResetConfirm = false
  @State private var showingWipeConfirm = false

  var body: some View {
    ScrollView {
      VStack(spacing: 24) {
        interfaceSection
        if devMode.isDeveloperMode { devToolsSection }
        dangerZoneSection
      }
      .padding(.vertical, 24)
    }
    .background(Color.Theme.pageBg.ignoresSafeArea())
    .navigationTitle("Advanced")
    .navigationBarTitleDisplayMode(.inline)
    .sheet(isPresented: $showingPassportPipeline) {
      PassportOnboardingFlowView { _ in showingPassportPipeline = false }
    }
    .sheet(isPresented: $showingZKSettings) { ZKSettingsView() }
    .sheet(isPresented: $showingOIDCRequest) { OIDCRequestView() }
    .alert("Settings", isPresented: $showingAlert) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(alertMessage)
    }
    .confirmationDialog(
      "Reset local app data?",
      isPresented: $showingResetConfirm,
      titleVisibility: .visible
    ) {
      Button("Reset", role: .destructive) { resetLocalData() }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This clears local encrypted files, contacts, credentials, and onboarding status. Keys are preserved.")
    }
    .confirmationDialog(
      "Wipe everything?",
      isPresented: $showingWipeConfirm,
      titleVisibility: .visible
    ) {
      Button("Wipe", role: .destructive) { wipeEverything() }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This deletes ALL data including private keys, DIDs, credentials, and keychain items. Relaunch the app after wipe.")
    }
  }

  // MARK: - Interface

  private var interfaceSection: some View {
    SettingsBlockSection("Interface") {
      NavigationLink {
        AppearanceSettingsView()
      } label: {
        SettingsBlockRow(icon: "paintbrush", title: "Appearance")
      }
      .buttonStyle(.plain)
    }
  }

  // MARK: - Developer Tools

  private var devToolsSection: some View {
    SettingsBlockSection("Developer Tools") {
      NavigationLink {
        GroupManagementView()
      } label: {
        SettingsBlockRow(icon: "person.3", title: "Group Management")
      }
      .buttonStyle(.plain)

      Button { showingPassportPipeline = true } label: {
        SettingsBlockRow(icon: "doc.viewfinder", title: "Passport Pipeline")
      }
      .buttonStyle(.plain)

      SettingsBlockToggleRow(
        icon: "wave.3.forward",
        title: "Simulate NFC",
        isOn: $devMode.simulateNFC
      )

      Button { showingZKSettings = true } label: {
        SettingsBlockRow(icon: "shield.checkered", title: "ZK Identity Settings")
      }
      .buttonStyle(.plain)

      Button { showingOIDCRequest = true } label: {
        SettingsBlockRow(icon: "qrcode", title: "OIDC Request Scanner")
      }
      .buttonStyle(.plain)
    }
  }

  // MARK: - Danger Zone

  private var dangerZoneSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      SettingsBlockSectionHeader(title: "Danger Zone")

      VStack(spacing: 8) {
        Button { showingResetConfirm = true } label: {
          SettingsBlockDangerRow(
            icon: "arrow.counterclockwise",
            title: "Reset App Data",
            subtitle: "Clears data, preserves keys"
          )
        }
        .buttonStyle(.plain)

        if devMode.isDeveloperMode {
          Button { resetPassportCredential() } label: {
            SettingsBlockDangerRow(
              icon: "xmark.bin",
              title: "Reset Passport Credential"
            )
          }
          .buttonStyle(.plain)

          Button { showingWipeConfirm = true } label: {
            SettingsBlockDangerRow(
              icon: "trash.slash",
              title: "Wipe Everything",
              subtitle: "Deletes all data + keys"
            )
          }
          .buttonStyle(.plain)

          Rectangle()
            .fill(Color.Theme.divider)
            .frame(height: 1)

          Button { devMode.disableDeveloperMode() } label: {
            SettingsBlockRow(
              icon: "xmark.circle",
              title: "Disable Developer Mode",
              showsChevron: false,
              iconColor: Color.Theme.textSecondary
            )
          }
          .buttonStyle(.plain)
        }
      }
      .padding(.horizontal, 16)

      if !devMode.isDeveloperMode {
        Text("Tap the version number in Settings to enable developer mode.")
          .font(.system(size: 10, design: .monospaced))
          .foregroundColor(Color.Theme.textTertiary)
          .padding(.horizontal, 24)
      }
    }
  }

  // MARK: - Actions

  private func resetPassportCredential() {
    IdentityDataStore.shared.removePassportCredentials()
    alertMessage = String(localized: "Passport credential has been reset.")
    showingAlert = true
  }

  private func resetLocalData() {
    BiometricGatekeeper.shared.authorizeIfRequired(.rotateMasterKey) { result in
      switch result {
      case .failure(let error):
        alertMessage = error.localizedDescription
        showingAlert = true
      case .success:
        _ = StorageManager.shared.clearAllData()
        IdentityDataStore.shared.clearAllContacts()
        IdentityDataStore.shared.clearAllIdentityData()
        IdentityCacheStore().clearAll()
        VCLibrary.shared.clearAll()
        _ = KeyManager.shared.clearAllKeys()
        SecureMessageStorage.shared.clearAllHistory()
        _ = OfflineManager.shared.clearPendingOperations()
        if let bundleId = Bundle.main.bundleIdentifier {
          UserDefaults.standard.removePersistentDomain(forName: bundleId)
        }

        switch KeychainService.shared.resetSigningKey() {
        case .failure(let error):
          let detail = error.localizedDescription
          alertMessage = String(localized: "Data cleared but key reset failed.") + "\n" + detail
        case .success:
          alertMessage = String(localized: "Local data reset completed.")
        }
        showingAlert = true
      }
    }
  }

  private func wipeEverything() {
    BiometricGatekeeper.shared.authorizeIfRequired(.rotateMasterKey) { result in
      switch result {
      case .failure(let error):
        alertMessage = error.localizedDescription
        showingAlert = true
      case .success:
        performFullWipe()
        alertMessage = String(localized: "All data wiped. Please relaunch the app.")
        showingAlert = true
      }
    }
  }

  private func performFullWipe() {
    _ = StorageManager.shared.clearAllData()
    IdentityDataStore.shared.clearAllContacts()
    IdentityDataStore.shared.clearAllIdentityData()
    IdentityCacheStore().clearAll()
    VCLibrary.shared.clearAll()
    _ = KeyManager.shared.clearAllKeys()
    _ = KeychainService.shared.deleteSigningKey()
    KeychainService.shared.clearInMemoryKey()
    _ = EncryptionManager.shared.deleteEncryptionKey()
    SecureMessageStorage.shared.clearAllHistory()
    _ = OfflineManager.shared.clearPendingOperations()
    sweepAppKeychainItems()
    if let bundleId = Bundle.main.bundleIdentifier {
      UserDefaults.standard.removePersistentDomain(forName: bundleId)
    }
  }

  private func sweepAppKeychainItems() {
    let appPrefixes = [
      "solidarity.", "airmeishi.",
      "com.kidneyweakx.solidarity", "com.kidneyweakx.airmeishi",
    ]

    func matchesApp(_ value: String) -> Bool {
      appPrefixes.contains { value.hasPrefix($0) }
    }

    let keyQuery: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
      kSecReturnAttributes as String: true,
      kSecMatchLimit as String: kSecMatchLimitAll,
    ]
    var keyResult: CFTypeRef?
    if SecItemCopyMatching(keyQuery as CFDictionary, &keyResult) == errSecSuccess,
      let items = keyResult as? [[String: Any]]
    {
      for item in items {
        guard let tagData = item[kSecAttrApplicationTag as String] as? Data,
          let tag = String(data: tagData, encoding: .utf8),
          matchesApp(tag)
        else { continue }
        let deleteQuery: [String: Any] = [
          kSecClass as String: kSecClassKey,
          kSecAttrApplicationTag as String: tagData,
          kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
        ]
        SecItemDelete(deleteQuery as CFDictionary)
      }
    }

    let passwordQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
      kSecReturnAttributes as String: true,
      kSecMatchLimit as String: kSecMatchLimitAll,
    ]
    var passwordResult: CFTypeRef?
    if SecItemCopyMatching(passwordQuery as CFDictionary, &passwordResult) == errSecSuccess,
      let items = passwordResult as? [[String: Any]]
    {
      for item in items {
        let service = item[kSecAttrService as String] as? String ?? ""
        let account = item[kSecAttrAccount as String] as? String ?? ""
        guard matchesApp(service) || matchesApp(account) else { continue }
        var deleteQuery: [String: Any] = [
          kSecClass as String: kSecClassGenericPassword,
          kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
          kSecAttrAccount as String: account,
        ]
        if !service.isEmpty {
          deleteQuery[kSecAttrService as String] = service
        }
        SecItemDelete(deleteQuery as CFDictionary)
      }
    }
  }
}
