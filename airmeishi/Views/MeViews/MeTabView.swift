import SwiftUI

struct MeTabView: View {
  @ObservedObject private var identityCoordinator = IdentityCoordinator.shared
  @StateObject private var cardManager = CardManager.shared

  @State private var showingSettings = false
  @State private var showingCreateCard = false
  @State private var showingVCSettings = false
  @State private var showingProofSheet = false
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

      if cardManager.businessCards.isEmpty {
        EmptyMeStateCard(
          title: "No identity card yet",
          subtitle: "Scan passport to create your first credential.",
          primaryTitle: "Scan Passport",
          secondaryTitle: "Import Credential",
          onPrimaryTap: { showingCreateCard = true },
          onSecondaryTap: { showingVCSettings = true }
        )
      } else {
        VStack(spacing: 10) {
          IdentityStatusCard(
            emoji: "🛂",
            title: "Passport",
            trustText: "🟢 Government Level",
            subtitle: "ZKP Verification",
            ctaTitle: "View Details"
          )
        }
      }
    }
  }

  private var provableClaimsSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Things I Can Prove")
        .font(.subheadline.weight(.semibold))
        .foregroundColor(Color.Theme.textSecondary)

      VStack(spacing: 10) {
        ClaimRowView(
          title: "I am over 18",
          source: "Source: Passport · ZKP",
          onPresent: { openClaim(.ageOver18) }
        )
        ClaimRowView(
          title: "I am a real person",
          source: "Source: Passport · ZKP",
          onPresent: { openClaim(.isHuman) }
        )
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
          showingCreateCard = true
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
    VStack(spacing: 10) {
      Image(systemName: "person.text.rectangle")
        .font(.title2)
        .foregroundColor(Color.Theme.textTertiary)
      Text(title)
        .font(.subheadline.weight(.semibold))
        .foregroundColor(Color.Theme.textPrimary)
      Text(subtitle)
        .font(.caption)
        .foregroundColor(Color.Theme.textSecondary)
        .multilineTextAlignment(.center)
      HStack(spacing: 10) {
        Button(primaryTitle) { onPrimaryTap() }
          .font(.caption.weight(.semibold))
          .foregroundColor(.white)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          .background(Capsule().fill(Color.Theme.darkUI))

        Button(secondaryTitle) { onSecondaryTap() }
          .font(.caption.weight(.semibold))
          .foregroundColor(Color.Theme.darkUI)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
          .background(Capsule().fill(Color.Theme.searchBg))
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
