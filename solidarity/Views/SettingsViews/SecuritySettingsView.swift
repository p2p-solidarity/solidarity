import SwiftUI

struct SecuritySettingsView: View {
  @StateObject private var policyStore = SensitiveActionPolicyStore.shared
  @State private var showingAlert = false
  @State private var alertMessage = ""

  var body: some View {
    Form {
      Section(
        header: Text("Key Rotation"),
        footer: Text("Rotating the master key will invalidate active verifiable credentials across your network until re-issued.")
      ) {
        Button(role: .destructive) {
          rotateMasterKey()
        } label: {
          Label("Rotate DID Master Key", systemImage: "key.fill")
        }
      }

      Section("Biometric Requirements") {
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
    .navigationTitle("Security & Keys")
    .navigationBarTitleDisplayMode(.inline)
    .alert("Security", isPresented: $showingAlert) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(alertMessage)
    }
  }

  private func faceIdLabel(for action: SensitiveAction) -> String {
    switch action {
    case .issueCredential:
      return String(localized: "Require Face ID for issuance")
    case .presentProof:
      return String(localized: "Require Face ID for proofs")
    case .exportGraph:
      return String(localized: "Require Face ID for exports")
    case .rotateMasterKey:
      return String(localized: "Require Face ID for key rotation")
    case .revealRecoveryBundle:
      return String(localized: "Require Face ID for recovery")
    case .registerTrustAnchor:
      return String(localized: "Require Face ID for trusted issuers")
    }
  }

  private func rotateMasterKey() {
    BiometricGatekeeper.shared.authorizeIfRequired(.rotateMasterKey) { result in
      switch result {
      case .failure(let error):
        alertMessage = error.localizedDescription
        showingAlert = true
      case .success:
        // Reset key FIRST — only clear cache after confirmed success
        switch KeychainService.shared.resetSigningKey() {
        case .failure(let error):
          alertMessage = error.localizedDescription
          showingAlert = true
        case .success:
          // Synchronously clear stale cache before refresh to avoid race
          IdentityCacheStore().clearDescriptorSync()
          _ = KeychainService.shared.ensurePairwiseKey(for: "solidarity.gg")
          IdentityCoordinator.shared.refreshIdentity()
          alertMessage = String(localized: "Master key rotated successfully.")
          showingAlert = true
        }
      }
    }
  }
}
