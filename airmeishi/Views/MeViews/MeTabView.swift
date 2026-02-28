//
//  MeTabView.swift
//  airmeishi
//
//  Tab root - single card + consolidated identity section
//

import PassKit
import SwiftUI

struct MeTabView: View {
  @EnvironmentObject private var proximityManager: ProximityManager
  @EnvironmentObject private var theme: ThemeManager
  @Environment(\.colorScheme) private var colorScheme
  @StateObject private var cardManager = CardManager.shared
  @ObservedObject private var coordinator = IdentityCoordinator.shared
  @StateObject private var groupManager = CloudKitGroupSyncManager.shared
  @StateObject private var idm = SemaphoreIdentityManager.shared

  // Card state
  @State private var cardToEdit: BusinessCard?
  @State private var showingCreateCard = false
  @State private var showingAddPass = false
  @State private var pendingPass: PKPass?
  @State private var pendingPassCard: BusinessCard?
  @State private var alertMessage: String?

  // ID state
  @State private var showingGroupManager = false
  @State private var showingOIDCRequest = false
  @State private var showingZKSettings = false
  @State private var selectedGroup: GroupModel?
  @State private var isWorking = false
  @State private var showErrorAlert = false
  @State private var errorMessage: String?

  // Navigation
  @State private var showingSettings = false

  private var profile: UnifiedProfile {
    coordinator.state.currentProfile
  }

  private var isDidKeyActive: Bool {
    guard let did = profile.activeDID?.did else { return true }
    return did.hasPrefix("did:key")
  }

  private var hasIdentity: Bool {
    profile.zkIdentity != nil
  }

  private var themeIconName: String {
    switch theme.appColorScheme {
    case .system: return "circle.lefthalf.filled"
    case .light: return "sun.max"
    case .dark: return "moon"
    }
  }

  var body: some View {
    NavigationStack {
      ZStack {
        Color.Theme.pageBg
          .ignoresSafeArea()

        ScrollView {
          VStack(spacing: 16) {
            myCardSection
            identitySection
            if DeveloperModeManager.shared.isDeveloperMode {
              badgeSection
            }
          }
          .padding(.horizontal, 20)
          .padding(.vertical, 16)
          .padding(.bottom, 80)
        }
      }
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .principal) {
          Text("me")
            .font(.system(size: 18))
            .foregroundColor(Color.Theme.textPrimary)
        }
        ToolbarItem(placement: .navigationBarLeading) {
          Button(action: { showingSettings = true }) {
            Image(systemName: "gearshape")
              .foregroundColor(Color.Theme.darkUI)
          }
        }
        ToolbarItem(placement: .navigationBarTrailing) {
          Menu {
            // Theme toggle
            Menu {
              Button(action: { theme.appColorScheme = .system }) {
                Label("跟隨系統", systemImage: theme.appColorScheme == .system ? "checkmark" : "iphone")
              }
              Button(action: { theme.appColorScheme = .light }) {
                Label("淺色模式", systemImage: theme.appColorScheme == .light ? "checkmark" : "sun.max")
              }
              Button(action: { theme.appColorScheme = .dark }) {
                Label("深色模式", systemImage: theme.appColorScheme == .dark ? "checkmark" : "moon")
              }
            } label: {
              Label("外觀模式", systemImage: themeIconName)
            }

            Divider()

            Button(action: { showingOIDCRequest = true }) {
              Label("OIDC 請求", systemImage: "qrcode")
            }
            Button(action: { showingZKSettings = true }) {
              Label("ZK 設定", systemImage: "shield.checkered")
            }
            Button(action: { coordinator.refreshIdentity() }) {
              Label("重新整理", systemImage: "arrow.clockwise")
            }
          } label: {
            Image(systemName: "ellipsis.circle")
              .foregroundColor(Color.Theme.darkUI)
          }
        }
      }
      .sheet(item: $cardToEdit) { card in
        BusinessCardFormView(businessCard: card, forceCreate: false) { _ in
          cardToEdit = nil
        }
      }
      .sheet(isPresented: $showingCreateCard) {
        BusinessCardFormView(forceCreate: true) { _ in
          showingCreateCard = false
        }
      }
      .sheet(isPresented: $showingSettings) {
        NavigationStack {
          SettingsView()
        }
      }
      .sheet(isPresented: $showingGroupManager) {
        NavigationStack {
          GroupManagementView()
        }
      }
      .sheet(isPresented: $showingOIDCRequest) {
        OIDCRequestView()
      }
      .sheet(isPresented: $showingZKSettings) {
        ZKSettingsView()
      }
      .sheet(isPresented: $showingAddPass) {
        ZStack {
          Color.black.ignoresSafeArea()
          if let pass = pendingPass {
            AddPassesControllerView(pass: pass)
          } else {
            VStack(spacing: 20) {
              ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                .scaleEffect(1.5)
              Text("Preparing Wallet Pass...")
                .font(.subheadline)
                .foregroundColor(.white.opacity(0.8))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
          }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .onAppear {
          if pendingPass == nil, let card = pendingPassCard {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
              generatePassFor(card)
            }
          }
        }
        .onDisappear {
          pendingPass = nil
          pendingPassCard = nil
        }
      }
      .alert("Error", isPresented: .init(get: { alertMessage != nil }, set: { _ in alertMessage = nil })) {
        Button("OK", role: .cancel) { alertMessage = nil }
      } message: {
        Text(alertMessage ?? "")
      }
      .alert("Error", isPresented: $showErrorAlert) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(errorMessage ?? "Unknown error")
      }
      .onAppear {
        groupManager.startSyncEngine()
      }
    }
  }

  // MARK: - My Card Section

  @ViewBuilder
  private var myCardSection: some View {
    if cardManager.isLoading {
      VStack(spacing: 16) {
        ProgressView()
          .progressViewStyle(CircularProgressViewStyle(tint: Color.Theme.textTertiary))
        Text("Loading card...")
          .font(.subheadline)
          .foregroundColor(Color.Theme.textSecondary)
      }
      .frame(maxWidth: .infinity)
      .padding(.vertical, 40)
    } else if let card = cardManager.businessCards.first {
      WalletCardView(
        card: card,
        onEdit: {
          UIImpactFeedbackGenerator(style: .light).impactOccurred()
          cardToEdit = card
        },
        onAddToWallet: {
          pendingPassCard = card
          pendingPass = nil
          showingAddPass = true
        }
      )
      .frame(height: 220)
      .adaptivePadding(horizontal: 0, vertical: 0)
      .adaptiveMaxWidth(500)
    } else {
      VStack(spacing: 16) {
        Image(systemName: "folder")
          .font(.system(size: 44, weight: .light))
          .foregroundColor(Color.Theme.textTertiary)

        VStack(spacing: 6) {
          Text("建立你的數位身份")
            .font(.system(size: 16, weight: .medium))
            .foregroundColor(Color.Theme.textPrimary)

          Text("掃描護照或匯入憑證來建立")
            .font(.system(size: 14))
            .foregroundColor(Color.Theme.textSecondary)
        }

        VStack(spacing: 14) {
          Button(action: { showingCreateCard = true }) {
            Text("掃描護照")
              .font(.system(size: 15, weight: .medium))
              .foregroundColor(.white)
              .frame(maxWidth: 260)
              .padding(.vertical, 14)
              .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                  .fill(Color.Theme.accentRose)
              )
          }

          Button(action: { showingCreateCard = true }) {
            Text("匯入憑證")
              .font(.system(size: 15, weight: .medium))
              .foregroundColor(Color.Theme.accentRose)
              .frame(maxWidth: 260)
              .padding(.vertical, 14)
              .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                  .stroke(Color.Theme.accentRose, lineWidth: 1)
              )
          }
        }
        .padding(.top, 4)
      }
      .frame(maxWidth: .infinity)
      .padding(.vertical, 32)
      .background(
        RoundedRectangle(cornerRadius: 8, style: .continuous)
          .fill(Color.Theme.cardBg)
          .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
              .stroke(Color.Theme.divider, lineWidth: 0.5)
          )
      )
    }
  }

  // MARK: - Consolidated Identity Section

  private var identitySection: some View {
    VStack(spacing: 14) {
      // DID Switcher
      HStack(spacing: 0) {
        didCapsule(
          title: "Anonymous",
          subtitle: "did:key",
          isActive: isDidKeyActive,
          action: { coordinator.switchDID(method: .key) }
        )

        Divider()
          .frame(height: 24)

        didCapsule(
          title: "Public",
          subtitle: "did:ethr",
          isActive: !isDidKeyActive,
          action: { coordinator.switchDID(method: .ethr) }
        )
      }
      .background(Color.Theme.searchBg)
      .clipShape(Capsule())

      // Active DID display
      if let did = profile.activeDID?.did {
        Button(action: {
          #if canImport(UIKit)
          UIPasteboard.general.string = did
          ToastManager.shared.show(title: "Copied", message: "DID copied to clipboard", type: .success)
          #endif
        }) {
          HStack(spacing: 6) {
            Text(shortDid(did))
              .font(.caption.monospaced())
              .foregroundColor(Color.Theme.textTertiary)

            Image(systemName: "doc.on.doc")
              .font(.caption2)
              .foregroundColor(Color.Theme.textPlaceholder)
          }
        }
        .buttonStyle(.plain)
      }

      Rectangle()
        .fill(Color.Theme.divider)
        .frame(height: 0.5)

      // ZK Identity status + action
      HStack {
        VStack(alignment: .leading, spacing: 3) {
          Text("ZK Identity")
            .font(.subheadline.weight(.medium))
            .foregroundColor(Color.Theme.textPrimary)

          if hasIdentity, let commitment = profile.zkIdentity?.commitment {
            HStack(spacing: 4) {
              Circle()
                .fill(Color.green)
                .frame(width: 6, height: 6)
              Text(shortCommitment(commitment))
                .font(.caption.monospaced())
                .foregroundColor(Color.Theme.textTertiary)
            }
          } else {
            Text("Not created")
              .font(.caption)
              .foregroundColor(Color.Theme.textTertiary)
          }
        }

        Spacer()

        if hasIdentity {
          Button(action: { coordinator.refreshIdentity() }) {
            HStack(spacing: 4) {
              if coordinator.state.isLoading || isWorking {
                ProgressView()
                  .scaleEffect(0.7)
              } else {
                Image(systemName: "checkmark.shield.fill")
                  .font(.caption)
              }
              Text("Active")
                .font(.caption.weight(.medium))
            }
            .foregroundColor(.green)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(
              Capsule()
                .fill(Color.green.opacity(0.1))
            )
          }
          .buttonStyle(.plain)
        } else {
          Button(action: { createIdentity() }) {
            HStack(spacing: 4) {
              if isWorking {
                ProgressView()
                  .scaleEffect(0.7)
              } else {
                Image(systemName: "plus")
                  .font(.caption)
              }
              Text("Create")
                .font(.caption.weight(.medium))
            }
            .foregroundColor(Color.Theme.darkUI)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(
              Capsule()
                .fill(Color.Theme.searchBg)
            )
          }
          .buttonStyle(.plain)
          .disabled(isWorking)
        }
      }
    }
    .padding(16)
    .background(
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .fill(Color.Theme.cardBg)
        .overlay(
          RoundedRectangle(cornerRadius: 8, style: .continuous)
            .stroke(Color.Theme.divider, lineWidth: 0.5)
        )
    )
  }

  private func didCapsule(title: String, subtitle: String, isActive: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      VStack(spacing: 2) {
        Text(title)
          .font(.subheadline.weight(.medium))
          .foregroundColor(isActive ? Color.Theme.textPrimary : Color.Theme.textTertiary)

        Text(subtitle)
          .font(.caption2)
          .foregroundColor(isActive ? Color.Theme.textSecondary : Color.Theme.textPlaceholder)
      }
      .frame(width: 120, height: 46)
      .background(
        isActive ? Color.Theme.cardBg : Color.clear
      )
      .clipShape(Capsule())
      .shadow(color: isActive ? Color.black.opacity(0.06) : Color.clear, radius: 2, x: 0, y: 1)
    }
    .buttonStyle(.plain)
    .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isActive)
  }

  // MARK: - Badge Section (Groups, developer mode only)

  private var badgeSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text("Groups")
          .font(.subheadline.weight(.semibold))
          .foregroundColor(Color.Theme.textTertiary)

        Spacer()

        Button(action: { showingGroupManager = true }) {
          Image(systemName: "plus.circle.fill")
            .font(.title3)
            .foregroundColor(Color.Theme.darkUI)
        }
      }

      if groupManager.groups.isEmpty {
        Text("No group memberships")
          .font(.subheadline)
          .foregroundColor(Color.Theme.textTertiary)
          .frame(maxWidth: .infinity, alignment: .center)
          .padding(.vertical, 16)
      } else {
        LazyVStack(spacing: 10) {
          ForEach(groupManager.groups) { group in
            groupRow(group: group)
          }
        }
      }
    }
    .padding(16)
    .background(
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .fill(Color.Theme.cardBg)
        .overlay(
          RoundedRectangle(cornerRadius: 8, style: .continuous)
            .stroke(Color.Theme.divider, lineWidth: 0.5)
        )
    )
  }

  private func groupRow(group: GroupModel) -> some View {
    Button(action: {
      selectedGroup = group
      showingOIDCRequest = true
    }) {
      HStack(spacing: 14) {
        ZStack {
          Circle()
            .fill(Color.Theme.searchBg)
            .frame(width: 40, height: 40)

          Image(systemName: "person.3.fill")
            .font(.caption)
            .foregroundColor(Color.Theme.darkUI)
        }

        VStack(alignment: .leading, spacing: 3) {
          HStack(spacing: 6) {
            Text(group.name)
              .font(.subheadline.weight(.medium))
              .foregroundColor(Color.Theme.textPrimary)

            Text("CloudKit")
              .font(.system(size: 9, weight: .bold))
              .foregroundColor(.white)
              .padding(.horizontal, 5)
              .padding(.vertical, 2)
              .background(Color.blue.opacity(0.8))
              .clipShape(Capsule())
          }

          Text("\(group.memberCount) members")
            .font(.caption)
            .foregroundColor(Color.Theme.textTertiary)
        }

        Spacer()

        Image(systemName: "chevron.right")
          .font(.caption2)
          .foregroundColor(Color.Theme.textPlaceholder)
      }
      .padding(12)
      .background(
        RoundedRectangle(cornerRadius: 6, style: .continuous)
          .fill(Color.Theme.searchBg)
      )
    }
    .buttonStyle(.plain)
  }

  // MARK: - Helpers

  private func createIdentity() {
    isWorking = true
    Task { @MainActor in
      do {
        _ = try idm.loadOrCreateIdentity()
        coordinator.refreshIdentity()
        isWorking = false

        #if canImport(UIKit)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        #endif
      } catch {
        errorMessage = "Failed to create identity: \(error.localizedDescription)"
        showErrorAlert = true
        isWorking = false
      }
    }
  }

  private func shortDid(_ did: String) -> String {
    guard did.count > 20 else { return did }
    let start = did.prefix(12)
    let end = did.suffix(6)
    return String(start) + "..." + String(end)
  }

  private func shortCommitment(_ commitment: String) -> String {
    guard commitment.count > 16 else { return commitment }
    let start = commitment.prefix(8)
    let end = commitment.suffix(6)
    return String(start) + "..." + String(end)
  }

  private func generatePassFor(_ card: BusinessCard) {
    let result = PassKitManager.shared.generatePass(for: card, sharingLevel: .professional)
    switch result {
    case .success(let passData):
      do {
        let pass = try PKPass(data: passData)
        pendingPass = pass
      } catch {
        alertMessage = "Failed to prepare Wallet pass: \(error.localizedDescription)"
        showingAddPass = false
      }
    case .failure(let err):
      alertMessage = err.localizedDescription
      showingAddPass = false
    }
  }
}
