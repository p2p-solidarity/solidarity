import SwiftUI

struct MeTabView: View {
  @ObservedObject private var identityCoordinator = IdentityCoordinator.shared
  @StateObject private var cardManager = CardManager.shared
  @EnvironmentObject private var identityDataStore: IdentityDataStore

  @State private var showingSettings = false
  @State private var showingCreateCard = false
  @State private var showingVCSettings = false
  @State private var showingProofSheet = false
  @State private var showingPassportFlow = false
  @State private var selectedClaim: MeClaimType = .ageOver18
  @State private var revealDid = false

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 16) {
          identityHeader
          identityCardSection
          provableClaimsSection
          addMoreSection
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
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
            Image(systemName: "gearshape")
              .foregroundColor(Color.Theme.darkUI)
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
        SelfInitiatedProofSheet(claimType: selectedClaim)
      }
    }
  }

  private var displayName: String {
    cardManager.businessCards.first?.name ?? "Your Identity"
  }

  private var displayDid: String {
    identityCoordinator.state.currentProfile.activeDID?.did ?? "did:key:not_initialized"
  }

  private var identityHeader: some View {
    VStack(spacing: 10) {
      Circle()
        .fill(Color.Theme.searchBg)
        .frame(width: 72, height: 72)
        .overlay(
          Text(String(displayName.prefix(1)).uppercased())
            .font(.title2.weight(.bold))
            .foregroundColor(Color.Theme.textPrimary)
        )

      Text(displayName)
        .font(.title3.weight(.semibold))
        .foregroundColor(Color.Theme.textPrimary)

      Button {
        revealDid.toggle()
      } label: {
        Text(revealDid ? displayDid : shortDid(displayDid))
          .font(.caption.monospaced())
          .foregroundColor(Color.Theme.textTertiary)
      }
      .buttonStyle(.plain)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 12)
  }

  private var identityCardSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("My Identity Cards")
        .font(.subheadline.weight(.semibold))
        .foregroundColor(Color.Theme.textSecondary)

      if identityDataStore.identityCards.isEmpty {
        EmptyMeStateCard(
          title: "建立你的數位身份",
          subtitle: "掃描護照即可證明年齡與真人身份",
          primaryTitle: "掃描護照",
          secondaryTitle: "匯入憑證",
          onPrimaryTap: { showingPassportFlow = true },
          onSecondaryTap: { showingVCSettings = true }
        )
      } else {
        VStack(spacing: 10) {
          ForEach(identityDataStore.identityCards) { card in
            IdentityStatusCard(
              emoji: card.type == "passport" ? "🛂" : "🪪",
              title: card.title,
              trustText: card.trustLevel == "green" ? "🟢 High Trust" : "⚪️ Standard",
              subtitle: card.issuerType,
              ctaTitle: "View Details"
            )
          }
        }
      }
    }
  }

  private var provableClaimsSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Things I Can Prove")
        .font(.subheadline.weight(.semibold))
        .foregroundColor(Color.Theme.textSecondary)

      if identityDataStore.provableClaims.isEmpty {
        Text("No provable claims yet.")
          .font(.caption)
          .foregroundColor(Color.Theme.textSecondary)
          .padding(.vertical, 8)
      } else {
        VStack(spacing: 10) {
          ForEach(identityDataStore.provableClaims) { claim in
            ClaimRowView(
              title: claim.title,
              source: "Source: \(claim.source)",
              onPresent: {
                if claim.claimType == "age_over_18" {
                  openClaim(.ageOver18)
                } else {
                  openClaim(.isHuman)
                }
              }
            )
          }
        }
      }
    }
  }

  private var addMoreSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Add More")
        .font(.subheadline.weight(.semibold))
        .foregroundColor(Color.Theme.textSecondary)

      VStack(spacing: 10) {
        Button {
          showingPassportFlow = true
        } label: {
          sectionActionLabel(icon: "plus.circle", title: "Scan Passport")
        }
        .buttonStyle(.plain)

        Button {
          showingVCSettings = true
        } label: {
          sectionActionLabel(icon: "square.and.arrow.down", title: "Import Credential")
        }
        .buttonStyle(.plain)
      }
    }
  }

  private func sectionActionLabel(icon: String, title: String) -> some View {
    HStack {
      Label(title, systemImage: icon)
        .font(.subheadline.weight(.medium))
        .foregroundColor(Color.Theme.textPrimary)
      Spacer()
      Image(systemName: "chevron.right")
        .font(.caption)
        .foregroundColor(Color.Theme.textPlaceholder)
    }
    .padding(12)
    .background(
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .fill(Color.Theme.cardBg)
        .overlay(
          RoundedRectangle(cornerRadius: 8, style: .continuous)
            .stroke(Color.Theme.divider, lineWidth: 0.5)
        )
    )
  }

  private func shortDid(_ did: String) -> String {
    guard did.count > 22 else { return did }
    return "\(did.prefix(12))...\(did.suffix(8))"
  }

  private func openClaim(_ claimType: MeClaimType) {
    selectedClaim = claimType
    showingProofSheet = true
  }
}

private struct ClaimRowView: View {
  let title: String
  let source: String
  let onPresent: () -> Void

  var body: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        Text("🟢 \(title)")
          .font(.subheadline.weight(.semibold))
          .foregroundColor(Color.Theme.textPrimary)
        Text(source)
          .font(.caption)
          .foregroundColor(Color.Theme.textSecondary)
      }
      Spacer()
      Button("Present") {
        onPresent()
      }
      .font(.caption.weight(.semibold))
      .foregroundColor(Color.Theme.darkUI)
      .padding(.horizontal, 12)
      .padding(.vertical, 6)
      .background(Capsule().fill(Color.Theme.searchBg))
    }
    .padding(12)
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

private struct IdentityStatusCard: View {
  let emoji: String
  let title: String
  let trustText: String
  let subtitle: String
  let ctaTitle: String

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("\(emoji) \(title)")
          .font(.subheadline.weight(.semibold))
          .foregroundColor(Color.Theme.textPrimary)
        Spacer()
      }
      Text(trustText)
        .font(.caption.weight(.medium))
        .foregroundColor(Color.Theme.textSecondary)
      Text(subtitle)
        .font(.caption)
        .foregroundColor(Color.Theme.textTertiary)
      Text(ctaTitle)
        .font(.caption.weight(.semibold))
        .foregroundColor(Color.Theme.primaryBlue)
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
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

private struct EmptyMeStateCard: View {
  let title: String
  let subtitle: String
  let primaryTitle: String
  let secondaryTitle: String
  let onPrimaryTap: () -> Void
  let onSecondaryTap: () -> Void

  var body: some View {
    VStack(spacing: 12) {
      Image(systemName: "folder.fill")
        .font(.system(size: 80))
        .foregroundColor(Color.Theme.textTertiary)
      Text(title)
        .font(.system(size: 16, weight: .semibold))
        .foregroundColor(Color.Theme.textPrimary)
      Text(subtitle)
        .font(.system(size: 14))
        .foregroundColor(Color.Theme.textSecondary)
        .multilineTextAlignment(.center)
      VStack(spacing: 8) {
        Button(primaryTitle) { onPrimaryTap() }
          .font(.system(size: 14, weight: .semibold))
          .foregroundColor(.white)
          .padding(.horizontal, 24)
          .padding(.vertical, 14)
          .background(Color.Theme.darkUI)
          .cornerRadius(2)
          .buttonStyle(.plain)

        Button(secondaryTitle) { onSecondaryTap() }
          .font(.system(size: 14, weight: .semibold))
          .foregroundColor(Color.Theme.darkUI)
          .buttonStyle(.plain)
      }
    }
    .padding(14)
    .frame(maxWidth: .infinity)
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

private enum MeClaimType: String {
  case ageOver18 = "age_over_18"
  case isHuman = "is_human"
}

private struct SelfInitiatedProofSheet: View {
  let claimType: MeClaimType
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      VStack(spacing: 16) {
        Text("Self-Initiated Proof")
          .font(.title3.weight(.semibold))
        Text("Claim: \(claimType.rawValue)")
          .font(.caption.monospaced())
          .foregroundColor(.secondary)
        Text("QR presentation flow is available from Scan tab.")
          .font(.subheadline)
          .foregroundColor(.secondary)
          .multilineTextAlignment(.center)
          .padding(.horizontal, 20)
        Spacer()
      }
      .padding(.top, 24)
      .navigationTitle("Present")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button("Close") { dismiss() }
        }
      }
    }
  }
}
