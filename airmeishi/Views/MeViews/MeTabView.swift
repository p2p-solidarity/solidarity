import SwiftUI

struct MeTabView: View {
  @EnvironmentObject private var identityCoordinator: IdentityCoordinator
  @StateObject private var cardManager = CardManager.shared
  @EnvironmentObject private var identityDataStore: IdentityDataStore

  @State private var showingSettings = false
  @State private var showingCreateCard = false
  @State private var showingVCSettings = false
  @State private var showingProofSheet = false
  @State private var showingPassportFlow = false
  @State private var selectedClaim: ProvableClaimEntity?
  @State private var revealDid = false

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
        }
        .padding(.vertical, 24)
        .padding(.bottom, 90)
      }
      .background(Color.Theme.pageBg.ignoresSafeArea())
      .navigationTitle("Vault")
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
      .sheet(isPresented: $showingCreateCard) {
        BusinessCardFormView(forceCreate: true) { _ in
          showingCreateCard = false
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
    .padding(.horizontal, 24)
  }

  private var identityCardSection: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("[ SECURE CREDENTIALS ]")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textSecondary)
        .padding(.horizontal, 24)

      if identityDataStore.identityCards.isEmpty {
        EmptyMeStateCard(
          title: "Vault Empty",
          subtitle: "No cryptographic proofs stored.",
          primaryTitle: "Scan Identity",
          secondaryTitle: "Import JSON",
          onPrimaryTap: { showingPassportFlow = true },
          onSecondaryTap: { showingVCSettings = true }
        )
        .padding(.horizontal, 16)
      } else {
        VStack(spacing: 12) {
          ForEach(identityDataStore.identityCards) { card in
            IdentityStatusCard(
              emoji: card.type == "passport" ? "🛂" : "🪪",
              title: card.title,
              trustText: card.trustLevel == "green" ? "🟢 LEVEL 3 TRUST" : "⚪️ LEVEL 1",
              subtitle: card.issuerType,
              ctaTitle: "Regenerate",
              onCTA: card.type == "passport" ? {
                identityDataStore.removePassportCredentials()
                showingPassportFlow = true
              } : nil
            )
          }
        }
      }
    }
  }

  private var provableClaimsSection: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("[ SELECTIVE DISCLOSURES ]")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textSecondary)
        .padding(.horizontal, 24)

      if identityDataStore.provableClaims.isEmpty {
        Text("No derivations available.")
          .font(.system(size: 12, design: .monospaced))
          .foregroundColor(Color.Theme.textTertiary)
          .padding(.horizontal, 24)
      } else {
        VStack(spacing: 12) {
          ForEach(identityDataStore.provableClaims) { claim in
            ClaimRowView(
              title: claim.title,
              source: "SRC: \(claim.source)",
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

  private func shortDid(_ did: String) -> String {
    guard did.count > 22 else { return did }
    return "\(did.prefix(12))...\(did.suffix(8))"
  }

}

private struct ClaimRowView: View {
  let title: String
  let source: String
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
        Text("Generate")
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
    let payload = "openid4vp://present?claim=\(claim.claimType)&nonce=\(nonce)&payload=\(claim.payload)"
    let result = qrCodeManager.generateQRCode(from: payload)
    switch result {
    case .success(let image):
      qrImage = image
      IdentityDataStore.shared.markClaimPresented(claim.id)
    case .failure(let error):
      errorMessage = error.localizedDescription
    }
  }
}
