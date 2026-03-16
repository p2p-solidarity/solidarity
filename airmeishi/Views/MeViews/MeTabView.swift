import SwiftUI

struct MeTabView: View {
  @EnvironmentObject private var identityCoordinator: IdentityCoordinator
  @StateObject private var cardManager = CardManager.shared
  @EnvironmentObject private var identityDataStore: IdentityDataStore

  @ObservedObject private var devMode = DeveloperModeManager.shared
  @StateObject private var groupManager = CloudKitGroupSyncManager.shared
  @StateObject private var idm = SemaphoreIdentityManager.shared

  @State private var showingSettings = false
  @State private var showingEditProfile = false
  @State private var showingVCSettings = false
  @State private var showingProofSheet = false
  @State private var showingPassportFlow = false
  @State private var showingGroupManager = false
  @State private var showingOIDCRequest = false
  @State private var showingZKSettings = false
  @State private var selectedClaim: ProvableClaimEntity?
  @State private var revealDid = false

  private var verifiedCards: [IdentityCardEntity] {
    identityDataStore.identityCards.filter { $0.type != "business_card" }
  }

  private var displayClaims: [ProvableClaimEntity] {
    var hasIncludedProfileCard = false
    return identityDataStore.provableClaims.filter { claim in
      guard claim.isPresentable else { return false }
      guard claim.claimType == "profile_card" else { return true }
      guard !hasIncludedProfileCard else { return false }
      hasIncludedProfileCard = true
      return true
    }
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 24) {
          identityHeader

          Rectangle()
            .fill(Color.Theme.divider)
            .frame(height: 1)

          identityCardSection

          provableClaimsSection

          addMoreSection

          if devMode.isDeveloperMode {
            devModeSection
          }
        }
        .padding(.vertical, 24)
        .padding(.bottom, 90)
      }
      .background(Color.Theme.pageBg.ignoresSafeArea())
      .navigationTitle("Me")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button {
            showingSettings = true
          } label: {
            Image(systemName: "gearshape.fill")
              .font(.system(size: 14))
              .foregroundColor(Color.Theme.textPrimary)
              .padding(8)
              .background(Color.Theme.searchBg)
              .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
          }
        }
      }
      .sheet(isPresented: $showingSettings) {
        NavigationStack {
          SettingsView()
        }
      }
      .sheet(isPresented: $showingEditProfile) {
        if let card = cardManager.businessCards.first {
          BusinessCardFormView(businessCard: card) { _ in
            showingEditProfile = false
          }
        } else {
          BusinessCardFormView(forceCreate: true) { _ in
            showingEditProfile = false
          }
        }
      }
      .sheet(isPresented: $showingVCSettings) {
        NavigationStack {
          VCSettingsView()
        }
      }
      .sheet(isPresented: $showingPassportFlow) {
        PassportOnboardingFlowView { _ in
          showingPassportFlow = false
        }
      }
      .sheet(isPresented: $showingProofSheet) {
        if let selectedClaim {
          SelfInitiatedProofSheet(claim: selectedClaim)
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
      .onAppear {
        if identityCoordinator.state.currentProfile.activeDID == nil,
           !identityCoordinator.state.isLoading {
          identityCoordinator.refreshIdentity()
        }
      }
    }
  }

  private var displayName: String {
    cardManager.businessCards.first?.name ?? String(localized: "User Node")
  }

  private var displayDid: String {
    if let did = identityCoordinator.state.currentProfile.activeDID?.did {
      return did
    }
    if identityCoordinator.state.isLoading {
      return "Loading..."
    }
    if let error = identityCoordinator.state.lastError {
      return "Error: \(error.localizedDescription)"
    }
    return "Initializing..."
  }

  // MARK: - Subcomponents

  private var identityHeader: some View {
    VStack(spacing: 16) {
      HStack(alignment: .top, spacing: 16) {
        ZStack {
          Rectangle()
            .fill(Color.Theme.searchBg)
            .frame(width: 80, height: 80)
            .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))

          Text(String(displayName.prefix(1)).uppercased())
            .font(.system(size: 32, weight: .bold, design: .monospaced))
            .foregroundColor(.white)
        }

        VStack(alignment: .leading, spacing: 8) {
          Text(displayName)
            .font(.system(size: 24, weight: .bold))
            .foregroundColor(Color.Theme.textPrimary)

          Button {
            revealDid.toggle()
          } label: {
            HStack(spacing: 4) {
              Image(systemName: "key.viewfinder")
                .font(.system(size: 10))
              Text(revealDid ? displayDid : shortDid(displayDid))
                .font(.system(size: 10, weight: .bold, design: .monospaced))
            }
            .foregroundColor(Color.Theme.textTertiary)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.Theme.searchBg)
            .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
          }
          .buttonStyle(.plain)
        }
        Spacer()
      }

      Button {
        showingEditProfile = true
      } label: {
        HStack(spacing: 6) {
          Image(systemName: "pencil")
            .font(.system(size: 12, weight: .bold))
          Text("Edit Profile")
            .font(.system(size: 12, weight: .bold, design: .monospaced))
        }
        .foregroundColor(Color.Theme.textPrimary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(Color.Theme.searchBg)
        .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
      }
      .buttonStyle(.plain)
    }
    .padding(.horizontal, 24)
  }

  private var identityCardSection: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("[ VERIFIED CREDENTIALS ]")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textSecondary)
        .padding(.horizontal, 24)

      if verifiedCards.isEmpty {
        EmptyMeStateCard(
          title: "No Verified Credentials",
          subtitle: "Scan a government-issued ID to generate cryptographic proofs.",
          primaryTitle: "Scan Identity",
          secondaryTitle: "Import JSON",
          onPrimaryTap: { showingPassportFlow = true },
          onSecondaryTap: { showingVCSettings = true }
        )
        .padding(.horizontal, 16)
      } else {
        VStack(spacing: 12) {
          ForEach(verifiedCards) { card in
            NavigationLink {
              CredentialDetailView(card: card)
                .environmentObject(identityDataStore)
            } label: {
              IdentityStatusCard(
                emoji: "🛂",
                title: card.title,
                trustText: trustText(for: card),
                subtitle: card.issuerType,
                ctaTitle: "Details",
                onCTA: nil
              )
            }
            .buttonStyle(.plain)
          }
        }
      }
    }
  }

  private func trustText(for card: IdentityCardEntity) -> String {
    switch card.trustLevel {
    case "green": return "🟢 LEVEL 3 — ZK VERIFIED"
    case "blue": return "🔵 LEVEL 2 — FALLBACK"
    default: return "⚪️ LEVEL 1 — SELF-ATTESTED"
    }
  }

  private var provableClaimsSection: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("[ SELECTIVE DISCLOSURES ]")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textSecondary)
        .padding(.horizontal, 24)

      if displayClaims.isEmpty {
        Text("No derivations available.")
          .font(.system(size: 12, design: .monospaced))
          .foregroundColor(Color.Theme.textTertiary)
          .padding(.horizontal, 24)
      } else {
        VStack(spacing: 12) {
          ForEach(displayClaims) { claim in
            ClaimRowView(
              title: claim.title,
              source: "SRC: \(claim.source)",
              actionTitle: claim.lastPresentedAt == nil ? "Generate" : "Show",
              onPresent: {
                selectedClaim = claim
                showingProofSheet = true
              }
            )
          }
        }
      }
    }
  }

  private var addMoreSection: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("[ ACTIONS ]")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textSecondary)
        .padding(.horizontal, 24)

      VStack(spacing: 8) {
        Button {
          showingPassportFlow = true
        } label: {
          sectionActionLabel(icon: "plus.viewfinder", title: "Acquire New Proof")
        }
        .buttonStyle(.plain)

        Button {
          showingVCSettings = true
        } label: {
          sectionActionLabel(icon: "arrow.down.doc.fill", title: "Import Raw Credential")
        }
        .buttonStyle(.plain)
      }
      .padding(.horizontal, 16)
    }
  }

  private func sectionActionLabel(icon: String, title: String) -> some View {
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

  // MARK: - Developer Mode Section

  private var devModeSection: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("[ DEVELOPER ]")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textSecondary)
        .padding(.horizontal, 24)

      VStack(spacing: 8) {
        // ZK Identity Status
        Button {
          showingZKSettings = true
        } label: {
          HStack {
            Image(systemName: "shield.checkered")
              .font(.system(size: 16, weight: .bold))
              .foregroundColor(Color.Theme.terminalGreen)
              .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
              Text("ZK Identity")
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(Color.Theme.textPrimary)
              Text(idm.getIdentity() != nil ? "Commitment active" : "Not initialized")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(Color.Theme.textTertiary)
            }

            Spacer()

            Image(systemName: "chevron.right")
              .font(.system(size: 10, weight: .bold))
              .foregroundColor(Color.Theme.textPlaceholder)
          }
          .padding(16)
          .background(Color.Theme.searchBg)
          .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
        }
        .buttonStyle(.plain)

        // OIDC / OpenID Connect
        Button {
          showingOIDCRequest = true
        } label: {
          sectionActionLabel(icon: "qrcode", title: "OIDC Request Scanner")
        }
        .buttonStyle(.plain)

        // Group Management
        Button {
          showingGroupManager = true
        } label: {
          HStack {
            Image(systemName: "person.3")
              .font(.system(size: 16, weight: .bold))
              .foregroundColor(Color.Theme.terminalGreen)
              .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
              Text("Group Management")
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(Color.Theme.textPrimary)
              Text("\(groupManager.groups.count) groups")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(Color.Theme.textTertiary)
            }

            Spacer()

            Image(systemName: "chevron.right")
              .font(.system(size: 10, weight: .bold))
              .foregroundColor(Color.Theme.textPlaceholder)
          }
          .padding(16)
          .background(Color.Theme.searchBg)
          .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
        }
        .buttonStyle(.plain)
      }
      .padding(.horizontal, 16)
    }
  }

  private func shortDid(_ did: String) -> String {
    guard did.count > 22 else { return did }
    return "\(did.prefix(12))...\(did.suffix(8))"
  }

}

private struct ClaimRowView: View {
  let title: String
  let source: String
  let actionTitle: String
  let onPresent: () -> Void

  var body: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 6) {
        Text(title)
          .font(.system(size: 16, weight: .bold))
          .foregroundColor(Color.Theme.textPrimary)
        Text(source)
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textSecondary)
      }
      Spacer()
      Button(action: onPresent) {
        Text(actionTitle)
          .font(.system(size: 12, weight: .bold, design: .monospaced))
          .foregroundColor(.black)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          .background(Color.white)
          .overlay(Rectangle().stroke(Color.white, lineWidth: 1))
      }
    }
    .padding(16)
    .background(Color.Theme.cardBg)
    .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    .padding(.horizontal, 16)
  }
}

private struct IdentityStatusCard: View {
  let emoji: String
  let title: String
  let trustText: String
  let subtitle: String
  let ctaTitle: String
  var onCTA: (() -> Void)?

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text("\(emoji) \(title)")
          .font(.system(size: 16, weight: .bold))
          .foregroundColor(Color.Theme.textPrimary)
        Spacer()
        if let onCTA {
          Button(action: onCTA) {
            Text(ctaTitle)
              .font(.system(size: 10, weight: .bold, design: .monospaced))
              .foregroundColor(.black)
              .padding(.horizontal, 10)
              .padding(.vertical, 6)
              .background(Color.Theme.terminalGreen)
          }
          .buttonStyle(.plain)
        } else {
          Image(systemName: "chevron.right")
            .font(.system(size: 10, weight: .bold))
            .foregroundColor(Color.Theme.textTertiary)
        }
      }

      Rectangle()
        .fill(Color.Theme.divider)
        .frame(height: 1)

      HStack {
        Text(trustText)
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.terminalGreen)
        Spacer()
        Text(subtitle.uppercased())
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textTertiary)
      }
    }
    .padding(16)
    .background(Color.Theme.cardBg)
    .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    .padding(.horizontal, 16)
  }
}

private struct EmptyMeStateCard: View {
  let title: String
  let subtitle: String
  let primaryTitle: String
  let secondaryTitle: String
  let onPrimaryTap: () -> Void
  let onSecondaryTap: () -> Void

  var body: some View {
    VStack(spacing: 24) {
      Image(systemName: "lock.shield")
        .font(.system(size: 48))
        .foregroundColor(Color.Theme.textTertiary)

      VStack(spacing: 8) {
        Text(title.uppercased())
          .font(.system(size: 16, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textPrimary)
        Text(subtitle)
          .font(.system(size: 14))
          .foregroundColor(Color.Theme.textSecondary)
          .multilineTextAlignment(.center)
      }

      VStack(spacing: 12) {
        Button(action: onPrimaryTap) {
          Text(primaryTitle)
        }
        .buttonStyle(ThemedPrimaryButtonStyle())

        Button(action: onSecondaryTap) {
          Text(secondaryTitle)
        }
        .buttonStyle(ThemedSecondaryButtonStyle())
      }
    }
    .padding(24)
    .frame(maxWidth: .infinity)
    .background(Color.Theme.searchBg)
    .overlay(Rectangle().stroke(Color.Theme.textTertiary, style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
  }
}

private struct SelfInitiatedProofSheet: View {
  let claim: ProvableClaimEntity
  @Environment(\.dismiss) private var dismiss
  @StateObject private var qrCodeManager = QRCodeManager.shared
  @State private var qrImage: UIImage?
  @State private var errorMessage: String?

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 24) {
          Text("Claim: [\(claim.claimType)]")
            .font(.system(size: 14, weight: .bold, design: .monospaced))
            .foregroundColor(Color.Theme.terminalGreen)

          if let qrImage {
            Image(uiImage: qrImage)
              .resizable()
              .interpolation(.none)
              .scaledToFit()
              .frame(maxWidth: 260)
              .padding(16)
              .background(Color.white)
              .cornerRadius(12)
          } else if let errorMessage {
            Text(errorMessage)
              .font(.system(size: 14))
              .foregroundColor(.red)
              .multilineTextAlignment(.center)
              .padding(.horizontal, 32)
          } else {
            ProgressView()
              .frame(height: 260)
          }

          Text("Present this QR to a verifier for proof disclosure.")
            .font(.system(size: 14))
            .foregroundColor(Color.Theme.textSecondary)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 32)
        }
        .padding(.top, 24)
        .padding(.horizontal, 16)
      }
      .background(Color.Theme.pageBg.ignoresSafeArea())
      .navigationTitle("Present Proof")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button {
            dismiss()
          } label: {
            Image(systemName: "xmark")
              .foregroundColor(.white)
          }
        }
      }
      .onAppear { generateQR() }
    }
  }

  private func generateQR() {
    let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "")

    // Build a VP envelope so verifiers can validate directly via standard VP token parsing
    var vp: [String: Any] = [
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      "type": ["VerifiablePresentation"],
      "verifiableCredential": [claim.payload],
      "nonce": nonce,
      "claim_type": claim.claimType,
    ]

    let qrString: String
    if let data = try? JSONSerialization.data(withJSONObject: vp, options: [.sortedKeys]),
       let json = String(data: data, encoding: .utf8) {
      qrString = json
    } else {
      qrString = claim.payload
    }

    let result = qrCodeManager.generateQRCode(from: qrString)
    switch result {
    case .success(let image):
      qrImage = image
      IdentityDataStore.shared.markClaimPresented(claim.id)
    case .failure(let error):
      errorMessage = error.localizedDescription
    }
  }
}
