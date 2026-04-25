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
        SettingsSection(title: "Account & Identity") {
          NavigationLink {
            VCSettingsView()
          } label: {
            SettingsRowLabel(title: "Identity Profile")
          }
          .buttonStyle(.plain)

          Button {
            showingSolidarityQR = true
          } label: {
            SettingsRowLabel(title: "Solidarity QR")
          }
          .buttonStyle(.plain)

          Button {
            showingDIDList = true
          } label: {
            SettingsRowLabel(title: "View DIDs")
          }
          .buttonStyle(.plain)
        }

        SettingsSection(title: "QR Sharing") {
          NavigationLink {
            ShareSettingsView()
          } label: {
            SettingsRowLabel(title: "Share Settings")
          }
          .buttonStyle(.plain)
        }

        SettingsSection(title: "Preferences") {
          NavigationLink {
            SecuritySettingsView()
          } label: {
            SettingsRowLabel(title: "Security & Keys")
          }
          .buttonStyle(.plain)

          NavigationLink {
            DataSyncSettingsView()
          } label: {
            SettingsRowLabel(title: "Data & Sync")
          }
          .buttonStyle(.plain)

          NavigationLink {
            AdvancedSettingsView()
          } label: {
            SettingsRowLabel(title: "Advanced")
          }
          .buttonStyle(.plain)
        }

        SettingsSection(title: "Guide") {
          Button {
            showingOnboarding = true
          } label: {
            HStack(spacing: 8) {
              Image(systemName: "arrow.counterclockwise")
                .font(.system(size: 14, weight: .regular))
              Text("Replay Onboarding")
                .font(.system(size: 16, weight: .regular))
              Spacer()
            }
            .foregroundColor(Color.Theme.primaryBlue)
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
              RoundedRectangle(cornerRadius: 12)
                .fill(Color.Theme.searchBg)
            )
          }
          .buttonStyle(.plain)
        }

        SettingsSection(title: "About") {
          HStack {
            Text("Version")
              .font(.system(size: 16))
              .foregroundColor(Color.Theme.textPrimary)
            Spacer()
            Text(versionString)
              .font(.system(size: 16))
              .foregroundColor(Color.Theme.textTertiary)
          }
          .padding(.horizontal, 16)
          .padding(.vertical, 14)
          .frame(maxWidth: .infinity)
          .background(
            RoundedRectangle(cornerRadius: 12)
              .fill(Color.Theme.searchBg)
          )
          .contentShape(Rectangle())
          .onTapGesture {
            devMode.registerVersionTap()
          }
        }
      }
      .padding(.horizontal, 16)
      .padding(.top, 8)
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

// MARK: - Section + row components

private struct SettingsSection<Content: View>: View {
  let title: String
  @ViewBuilder let content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(title)
        .font(.system(size: 14, weight: .regular))
        .foregroundColor(Color.Theme.textPrimary)
      VStack(spacing: 8) {
        content
      }
    }
  }
}

private struct SettingsRowLabel: View {
  let title: String

  var body: some View {
    HStack {
      Text(title)
        .font(.system(size: 16, weight: .regular))
        .foregroundColor(Color.Theme.textPrimary)
      Spacer()
      Image(systemName: "chevron.right")
        .font(.system(size: 13, weight: .semibold))
        .foregroundColor(Color.Theme.textTertiary)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 14)
    .frame(maxWidth: .infinity)
    .background(
      RoundedRectangle(cornerRadius: 12)
        .fill(Color.Theme.searchBg)
    )
    .contentShape(RoundedRectangle(cornerRadius: 12))
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
