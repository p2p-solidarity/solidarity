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
    VStack(alignment: .leading, spacing: 12) {
      sectionHeader("INTERFACE")

      NavigationLink {
        AppearanceSettingsView()
      } label: {
        rowLabel(icon: "paintbrush", title: "Appearance")
      }
      .buttonStyle(.plain)
      .padding(.horizontal, 16)
    }
  }

  // MARK: - Developer Tools

  private var devToolsSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      sectionHeader("DEVELOPER TOOLS")

      VStack(spacing: 8) {
        NavigationLink {
          GroupManagementView()
        } label: {
          rowLabel(icon: "person.3", title: "Group Management")
        }
        .buttonStyle(.plain)

        Button { showingPassportPipeline = true } label: {
          rowLabel(icon: "doc.viewfinder", title: "Passport Pipeline")
        }
        .buttonStyle(.plain)

        nfcToggleRow

        Button { showingZKSettings = true } label: {
          rowLabel(icon: "shield.checkered", title: "ZK Identity Settings")
        }
        .buttonStyle(.plain)

        Button { showingOIDCRequest = true } label: {
          rowLabel(icon: "qrcode", title: "OIDC Request Scanner")
        }
        .buttonStyle(.plain)
      }
      .padding(.horizontal, 16)
    }
  }

  private var nfcToggleRow: some View {
    HStack {
      Image(systemName: "wave.3.forward")
        .font(.system(size: 16, weight: .bold))
        .foregroundColor(Color.Theme.terminalGreen)
        .frame(width: 24)

      Text("Simulate NFC")
        .font(.system(size: 14, weight: .bold))
        .foregroundColor(Color.Theme.textPrimary)

      Spacer()

      Toggle("", isOn: $devMode.simulateNFC)
        .labelsHidden()
        .tint(Color.Theme.terminalGreen)
    }
    .padding(16)
    .background(Color.Theme.searchBg)
    .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
  }

  // MARK: - Danger Zone

  private var dangerZoneSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      sectionHeader("DANGER ZONE")

      VStack(spacing: 8) {
        Button { showingResetConfirm = true } label: {
          dangerRowLabel(icon: "arrow.counterclockwise", title: "Reset App Data", subtitle: "Clears data, preserves keys")
        }
        .buttonStyle(.plain)

        if devMode.isDeveloperMode {
          Button { resetPassportCredential() } label: {
            dangerRowLabel(icon: "doc.badge.xmark", title: "Reset Passport Credential")
          }
          .buttonStyle(.plain)

          Button { showingWipeConfirm = true } label: {
            dangerRowLabel(icon: "trash.slash", title: "Wipe Everything", subtitle: "Deletes all data + keys")
          }
          .buttonStyle(.plain)

          Rectangle()
            .fill(Color.Theme.divider)
            .frame(height: 1)

          Button { devMode.disableDeveloperMode() } label: {
            HStack {
              Image(systemName: "xmark.circle")
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(Color.Theme.textSecondary)
                .frame(width: 24)

              Text("Disable Developer Mode")
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(Color.Theme.textSecondary)

              Spacer()
            }
            .padding(16)
            .background(Color.Theme.searchBg)
            .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
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

  // MARK: - Shared Components

  private func sectionHeader(_ title: String) -> some View {
    Text("[ \(title) ]")
      .font(.system(size: 12, weight: .bold, design: .monospaced))
      .foregroundColor(Color.Theme.textSecondary)
      .padding(.horizontal, 24)
  }

  private func rowLabel(icon: String, title: String) -> some View {
    HStack {
      Image(systemName: icon)
        .font(.system(size: 16, weight: .bold))
        .foregroundColor(Color.Theme.terminalGreen)
        .frame(width: 24)

      Text(title)
        .font(.system(size: 14, weight: .bold))
        .foregroundColor(Color.Theme.textPrimary)

      Spacer()

      Image(systemName: "chevron.right")
        .font(.system(size: 10, weight: .bold))
        .foregroundColor(Color.Theme.textPlaceholder)
    }
    .padding(16)
    .background(Color.Theme.searchBg)
    .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
  }

  private func dangerRowLabel(icon: String, title: String, subtitle: String? = nil) -> some View {
    HStack {
      Image(systemName: icon)
        .font(.system(size: 16, weight: .bold))
        .foregroundColor(Color.Theme.destructive)
        .frame(width: 24)

      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.system(size: 14, weight: .bold))
          .foregroundColor(Color.Theme.destructive)
        if let subtitle {
          Text(subtitle)
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .foregroundColor(Color.Theme.textTertiary)
        }
      }

      Spacer()
    }
    .padding(16)
    .background(Color.Theme.searchBg)
    .overlay(Rectangle().stroke(Color.Theme.destructive.opacity(0.3), lineWidth: 1))
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
        KeychainService.shared.resetSigningKey()
        SecureMessageStorage.shared.clearAllHistory()
        _ = OfflineManager.shared.clearPendingOperations()
        if let bundleId = Bundle.main.bundleIdentifier {
          UserDefaults.standard.removePersistentDomain(forName: bundleId)
        }
        alertMessage = String(localized: "Local data reset completed.")
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
