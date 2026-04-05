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
    Form {
      Section("Interface & Display") {
        NavigationLink {
          AppearanceSettingsView()
        } label: {
          Label("Appearance", systemImage: "paintbrush")
        }
      }

      Section("Developer Tools") {
        if devMode.isDeveloperMode {
          NavigationLink {
            GroupManagementView()
          } label: {
            Label("Developer Group Management", systemImage: "person.3")
          }

          Button {
            showingPassportPipeline = true
          } label: {
            Label("Passport Pipeline", systemImage: "doc.viewfinder")
          }

          Toggle(isOn: $devMode.simulateNFC) {
            Label("Simulate NFC", systemImage: "wave.3.forward")
          }

          Button {
            showingZKSettings = true
          } label: {
            Label("ZK Identity Settings", systemImage: "shield.checkered")
          }

          Button {
            showingOIDCRequest = true
          } label: {
            Label("OIDC Request Scanner", systemImage: "qrcode")
          }

          Button("Reset Passport Credential", role: .destructive) {
            resetPassportCredential()
          }

          Button(role: .destructive) {
            showingWipeConfirm = true
          } label: {
            Label("Wipe Everything (Factory Reset)", systemImage: "trash.slash")
          }

          Button(role: .destructive) {
            devMode.disableDeveloperMode()
          } label: {
            Label("Disable Developer Mode", systemImage: "xmark.circle")
          }
        } else {
          Text("Tap the version number in the main settings screen several times to enable developer mode.")
            .font(.caption)
            .foregroundColor(.secondary)
        }
      }

      Section("Danger Zone") {
        Button("Reset Local App Data", role: .destructive) {
          showingResetConfirm = true
        }
      }
    }
    .navigationTitle("Advanced Settings")
    .navigationBarTitleDisplayMode(.inline)
    .sheet(isPresented: $showingPassportPipeline) {
      PassportOnboardingFlowView { _ in
        showingPassportPipeline = false
      }
    }
    .sheet(isPresented: $showingZKSettings) {
      ZKSettingsView()
    }
    .sheet(isPresented: $showingOIDCRequest) {
      OIDCRequestView()
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
    .confirmationDialog(
      "Wipe everything?",
      isPresented: $showingWipeConfirm,
      titleVisibility: .visible
    ) {
      Button("Wipe", role: .destructive) {
        wipeEverything()
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This deletes ALL data including private keys, DIDs, credentials, and keychain items. Relaunch the app after wipe.")
    }
  }

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
        // Encrypted files (business cards, contacts, preferences)
        _ = StorageManager.shared.clearAllData()

        // SwiftData stores
        IdentityDataStore.shared.clearAllContacts()
        IdentityDataStore.shared.clearAllIdentityData()

        // Identity caches (DID documents, JWKs, descriptor)
        IdentityCacheStore().clearAll()

        // Verifiable Credential library
        VCLibrary.shared.clearAll()

        // Cryptographic keys (KeyManager symmetric + KeychainService signing)
        _ = KeyManager.shared.clearAllKeys()
        KeychainService.shared.resetSigningKey()

        // Secure message history
        SecureMessageStorage.shared.clearAllHistory()

        // Offline operation queue
        _ = OfflineManager.shared.clearPendingOperations()

        // All UserDefaults (sharing prefs, profile, dev mode, etc.)
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
    // Encrypted files (business cards, contacts, preferences)
    _ = StorageManager.shared.clearAllData()

    // SwiftData stores
    IdentityDataStore.shared.clearAllContacts()
    IdentityDataStore.shared.clearAllIdentityData()

    // Identity caches (DID documents, JWKs, descriptor)
    IdentityCacheStore().clearAll()

    // Verifiable Credential library
    VCLibrary.shared.clearAll()

    // Cryptographic keys (KeyManager symmetric)
    _ = KeyManager.shared.clearAllKeys()

    // Master DID signing key — delete, do NOT regenerate
    _ = KeychainService.shared.deleteSigningKey()
    KeychainService.shared.clearInMemoryKey()

    // File encryption key (AES-256)
    _ = EncryptionManager.shared.deleteEncryptionKey()

    // Secure message history
    SecureMessageStorage.shared.clearAllHistory()

    // Offline operation queue
    _ = OfflineManager.shared.clearPendingOperations()

    // Broad keychain sweep: pairwise RP keys, Semaphore identity,
    // messaging keys, identity cache, and any legacy airmeishi items
    sweepAppKeychainItems()

    // All UserDefaults (sharing prefs, profile, dev mode, etc.)
    if let bundleId = Bundle.main.bundleIdentifier {
      UserDefaults.standard.removePersistentDomain(forName: bundleId)
    }
  }

  /// Enumerates keychain items and deletes every entry whose tag/service/account
  /// begins with one of the app-owned prefixes. Covers pairwise DID keys,
  /// Semaphore identity material, messaging keys, DID cache, and legacy entries.
  private func sweepAppKeychainItems() {
    let appPrefixes = [
      "solidarity.",
      "airmeishi.",
      "com.kidneyweakx.solidarity",
      "com.kidneyweakx.airmeishi",
    ]

    func matchesAppPrefix(_ value: String) -> Bool {
      appPrefixes.contains { value.hasPrefix($0) }
    }

    // Sweep SecKey entries (signing keys: master, pairwise RP, legacy)
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
          matchesAppPrefix(tag)
        else { continue }
        let deleteQuery: [String: Any] = [
          kSecClass as String: kSecClassKey,
          kSecAttrApplicationTag as String: tagData,
          kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
        ]
        SecItemDelete(deleteQuery as CFDictionary)
      }
    }

    // Sweep generic password entries (messaging keys, identity cache,
    // Semaphore identity, encryption keys, any legacy items)
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
        guard matchesAppPrefix(service) || matchesAppPrefix(account) else { continue }
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
