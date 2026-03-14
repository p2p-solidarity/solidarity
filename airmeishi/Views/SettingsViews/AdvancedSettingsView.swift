import SwiftUI

struct AdvancedSettingsView: View {
  @ObservedObject private var devMode = DeveloperModeManager.shared
  @State private var showingPassportPipeline = false
  @State private var showingZKSettings = false
  @State private var showingOIDCRequest = false
  @State private var showingAlert = false
  @State private var alertMessage = ""
  @State private var showingResetConfirm = false

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
            Label("Passport Pipeline", systemImage: "passport")
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
        _ = StorageManager.shared.clearAllData()
        IdentityDataStore.shared.clearAllContacts()
        IdentityDataStore.shared.clearAllIdentityData()
        IdentityCacheStore().clearDescriptor()
        UserDefaults.standard.removeObject(forKey: "solidarity.onboarding.completed")
        UserDefaults.standard.removeObject(forKey: "solidarity.identity.swiftdata.migrated.v1")
        alertMessage = String(localized: "Local data reset completed.")
        showingAlert = true
      }
    }
  }
}
