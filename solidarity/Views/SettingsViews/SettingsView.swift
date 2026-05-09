import SwiftUI

struct SettingsView: View {
  @EnvironmentObject private var theme: ThemeManager
  @ObservedObject private var devMode = DeveloperModeManager.shared
  @Environment(\.dismiss) private var dismiss
  @State private var showingSolidarityQR = false
  @State private var showingDIDList = false
  @State private var showingOnboarding = false

  private var versionString: String {
    Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
      ?? String(localized: "Unknown")
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        SettingsBlockSection("Account & Identity") {
          NavigationLink {
            VCSettingsView()
          } label: {
            SettingsBlockRow(icon: "person.text.rectangle", title: "Identity Profile")
          }
          .buttonStyle(.plain)

          Button {
            showingSolidarityQR = true
          } label: {
            SettingsBlockRow(icon: "qrcode", title: "Solidarity QR")
          }
          .buttonStyle(.plain)

          Button {
            showingDIDList = true
          } label: {
            SettingsBlockRow(icon: "key.horizontal", title: "View DIDs")
          }
          .buttonStyle(.plain)
        }

        SettingsBlockSection("QR Sharing") {
          NavigationLink {
            ShareSettingsView()
          } label: {
            SettingsBlockRow(icon: "square.and.arrow.up", title: "Share Settings")
          }
          .buttonStyle(.plain)
        }

        SettingsBlockSection("Preferences") {
          NavigationLink {
            SecuritySettingsView()
          } label: {
            SettingsBlockRow(icon: "lock.shield", title: "Security & Keys")
          }
          .buttonStyle(.plain)

          NavigationLink {
            DataSyncSettingsView()
          } label: {
            SettingsBlockRow(icon: "icloud", title: "Data & Sync")
          }
          .buttonStyle(.plain)

          NavigationLink {
            AdvancedSettingsView()
          } label: {
            SettingsBlockRow(icon: "slider.horizontal.3", title: "Advanced")
          }
          .buttonStyle(.plain)
        }

        SettingsBlockSection("Guide") {
          Button {
            showingOnboarding = true
          } label: {
            SettingsBlockRow(
              icon: "arrow.counterclockwise",
              title: "Replay Onboarding"
            )
          }
          .buttonStyle(.plain)
        }

        VStack(alignment: .leading, spacing: 12) {
          SettingsBlockSectionHeader(title: "About")

          SettingsBlockInfoRow(
            icon: "info.circle",
            title: "Version",
            value: versionString
          )
          .contentShape(Rectangle())
          .onTapGesture {
            devMode.registerVersionTap()
          }
          .padding(.horizontal, 16)
        }
      }
      .padding(.vertical, 24)
      .padding(.bottom, 60)
    }
    .background(Color.Theme.pageBg.ignoresSafeArea())
    .navigationTitle("Settings")
    .navigationBarTitleDisplayMode(.inline)
    .toolbarBackground(Color.Theme.pageBg, for: .navigationBar)
    .toolbarBackground(.visible, for: .navigationBar)
    .toolbar {
      ToolbarItem(placement: .navigationBarLeading) {
        Button {
          dismiss()
        } label: {
          Image(systemName: "chevron.left")
            .font(.system(size: 17, weight: .semibold))
            .foregroundColor(Color.Theme.textPrimary)
        }
      }
    }
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

        Section(footer: Text("DID keys are stored in iCloud Keychain and shared across your signed-in devices.")) {
          HStack {
            Text("Key Storage")
            Spacer()
            Text("iCloud Keychain")
              .foregroundColor(Color.Theme.textSecondary)
          }

          HStack {
            Text("Sync")
            Spacer()
            Text("Same Apple ID devices")
              .foregroundColor(Color.Theme.textSecondary)
          }
        }
      }
      .navigationTitle("Your DIDs")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        SettingsBackToolbar { dismiss() }
      }
    }
  }

  private func didRow(did: String) -> some View {
    let method = did.hasPrefix("did:key") ? "did:key" : "did:web"
    return VStack(alignment: .leading, spacing: 4) {
      Text(method.uppercased())
        .font(.caption.weight(.bold))
        .foregroundColor(Color.Theme.textSecondary)
      Text(did)
        .font(.system(size: 12, design: .monospaced))
        .foregroundColor(Color.Theme.textPrimary)
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
  NavigationStack {
    SettingsView()
      .environmentObject(ThemeManager.shared)
  }
}
