import SwiftUI

struct SettingsView: View {
  @EnvironmentObject private var theme: ThemeManager
  @ObservedObject private var devMode = DeveloperModeManager.shared
  @State private var showingSolidarityQR = false
  @State private var showingDIDList = false
  @State private var showingOnboarding = false
  @AppStorage("iCloudBackupEnabled") private var iCloudBackupEnabled: Bool = true

  var body: some View {
    NavigationStack {
      Form {
        Section("Account & Identity") {
          NavigationLink {
            VCSettingsView()
          } label: {
            Label("Identity Profile", systemImage: "person.text.rectangle")
          }

          Button {
            showingSolidarityQR = true
          } label: {
            Label("Solidarity QR", systemImage: "qrcode")
          }

          Button {
            showingDIDList = true
          } label: {
            Label("View DIDs", systemImage: "key.viewfinder")
          }
        }

        Section(
          header: Text("QR Sharing"),
          footer: Text("Controls which fields and proofs are included when generating your QR code.")
        ) {
          NavigationLink {
            ShareSettingsView()
          } label: {
            Label("Share Settings", systemImage: "checklist")
          }
        }

        Section("Backup") {
          Toggle(isOn: $iCloudBackupEnabled) {
            Label("iCloud Backup", systemImage: "icloud")
          }
        }

        Section("Preferences") {
          NavigationLink {
            SecuritySettingsView()
          } label: {
            Label("Security & Keys", systemImage: "lock.shield")
          }

          NavigationLink {
            DataSyncSettingsView()
          } label: {
            Label("Data & Sync", systemImage: "server.rack")
          }

          NavigationLink {
            AdvancedSettingsView()
          } label: {
            Label("Advanced", systemImage: "gearshape.2")
          }
        }

        Section("Guide") {
          Button {
            showingOnboarding = true
          } label: {
            Label("Replay Onboarding", systemImage: "arrow.counterclockwise")
          }
        }

        Section("About") {
          HStack {
            Text("Version")
            Spacer()
            Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? String(localized: "Unknown"))
              .foregroundColor(.secondary)
          }
          .contentShape(Rectangle())
          .onTapGesture {
            devMode.registerVersionTap()
          }
        }
      }
      .navigationTitle("Settings")
      .scrollContentBackground(.hidden)
      .background(Color.Theme.pageBg.ignoresSafeArea())
      .sheet(isPresented: $showingSolidarityQR) {
        if let card = CardManager.shared.businessCards.first {
          SolidarityQRView(businessCard: card)
        }
      }
      .sheet(isPresented: $showingDIDList) {
        DIDListSheet()
      }
      .fullScreenCover(isPresented: $showingOnboarding) {
        OnboardingReplayView {
          showingOnboarding = false
        }
      }
    }
  }
}

// MARK: - DID List Sheet

private struct DIDListSheet: View {
  @ObservedObject private var coordinator = IdentityCoordinator.shared
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      List {
        if let activeDID = coordinator.state.currentProfile.activeDID {
          Section("Active DID") {
            didRow(did: activeDID.did)
          }
        }

        Section(footer: Text("DID keys are stored in Secure Enclave and synced via iCloud Keychain.")) {
          HStack {
            Text("Key Storage")
            Spacer()
            Text("Secure Enclave")
              .foregroundColor(.secondary)
          }

          HStack {
            Text("Sync")
            Spacer()
            Text("iCloud Keychain")
              .foregroundColor(.secondary)
          }
        }
      }
      .navigationTitle("Your DIDs")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button("Done") { dismiss() }
        }
      }
    }
  }

  private func didRow(did: String) -> some View {
    let method = did.hasPrefix("did:key") ? "did:key" : did.hasPrefix("did:ethr") ? "did:ethr" : "did:web"
    return VStack(alignment: .leading, spacing: 4) {
      Text(method.uppercased())
        .font(.caption.weight(.bold))
        .foregroundColor(.secondary)
      Text(did)
        .font(.system(size: 12, design: .monospaced))
        .foregroundColor(.primary)
        .textSelection(.enabled)
    }
    .padding(.vertical, 4)
  }
}

// MARK: - Onboarding Replay Wrapper

private struct OnboardingReplayView: View {
  var onDismiss: () -> Void

  var body: some View {
    ZStack(alignment: .topTrailing) {
      OnboardingFlowView()

      Button(action: onDismiss) {
        Image(systemName: "xmark")
          .font(.system(size: 14, weight: .bold))
          .foregroundColor(Color.Theme.textSecondary)
          .padding(10)
          .background(Color.Theme.searchBg)
          .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
      }
      .padding(.top, 54)
      .padding(.trailing, 20)
    }
  }
}

#Preview {
  SettingsView()
    .environmentObject(ThemeManager.shared)
}
