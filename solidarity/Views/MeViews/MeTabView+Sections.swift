import SwiftUI

extension MeTabView {

  // MARK: - Profile header

  var identityHeader: some View {
    ProfileHeaderCard(
      name: displayName,
      did: shortDid(displayDid),
      avatar: AnyView(identityAvatar),
      onEdit: { showingEditProfile = true }
    )
  }

  @ViewBuilder
  var identityAvatar: some View {
    let card = CardManager.shared.businessCards.first
    let savedAnimalRaw = UserDefaults.standard.string(forKey: "theme_selected_animal")
    let animal = card?.animal ?? savedAnimalRaw.flatMap(AnimalCharacter.init(rawValue:))

    if let imageData = card?.profileImage, let uiImage = UIImage(data: imageData) {
      Image(uiImage: uiImage)
        .resizable()
        .scaledToFill()
    } else if let animal {
      ZStack {
        Circle().fill(Color.Theme.warmCream)
        ImageProvider.animalImage(for: animal)
          .resizable()
          .scaledToFit()
          .padding(6)
      }
    } else {
      ZStack {
        Circle().fill(Color.Theme.primaryBlue.opacity(0.18))
        Text(String(displayName.prefix(1)).uppercased())
          .font(.system(size: 22, weight: .bold))
          .foregroundColor(Color.Theme.primaryBlue)
      }
    }
  }

  // MARK: - Verified Credentials (entry tiles + existing list)

  var identityCardSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      MeSectionHeader(title: "Verified Credentials")

      // Entry-action tiles: 2-column grid (Scan Identity, Manual Input, Import JSON)
      let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]
      LazyVGrid(columns: columns, spacing: 12) {
        ActionTile(
          icon: "viewfinder",
          title: "Scan Identity",
          action: { showingPassportFlow = true }
        )
        ActionTile(
          icon: "rectangle.and.pencil.and.ellipsis",
          title: "Manual Input",
          action: { showingPassportFlow = true }
        )
        ActionTile(
          icon: "square.and.arrow.up",
          title: "Import JSON",
          action: { showingVCSettings = true }
        )
      }
      .padding(.horizontal, 16)

      // Existing verified credentials list (rendered below tiles when present)
      if !verifiedCards.isEmpty {
        VStack(spacing: 10) {
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

  func trustText(for card: IdentityCardEntity) -> String {
    switch card.trustLevel {
    case "green": return "🟢 LEVEL 3 — ZK VERIFIED"
    case "blue": return "🔵 LEVEL 2 — FALLBACK"
    default: return "⚪️ LEVEL 1 — SELF-ATTESTED"
    }
  }

  // MARK: - Selective Disclosures

  var provableClaimsSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      MeSectionHeader(title: "Selective Disclosures")

      if displayClaims.isEmpty {
        Text("No derivations available.")
          .font(.system(size: 13))
          .foregroundColor(Color.Theme.textTertiary)
          .padding(.horizontal, 16)
      } else {
        VStack(spacing: 10) {
          ForEach(displayClaims) { claim in
            DisclosureRowView(
              title: claim.title,
              source: "SRC: \(claim.source)",
              actionTitle: claim.lastPresentedAt == nil ? "Generate" : "Show",
              isLoading: preparingClaimID == claim.id,
              isDisabled: preparingClaimID != nil,
              onPresent: {
                prepareProofPresentation(for: claim)
              }
            )
          }
        }
      }
    }
  }

  // MARK: - Action tiles

  var addMoreSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      MeSectionHeader(title: "Action")

      let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]
      LazyVGrid(columns: columns, spacing: 12) {
        ActionTile(
          icon: "plus",
          title: "Acquire New Proof",
          action: { showingPassportFlow = true }
        )
        ActionTile(
          icon: "square.and.arrow.up",
          title: "Import Raw Credential",
          action: { showingVCSettings = true }
        )
      }
      .padding(.horizontal, 16)
    }
  }

  // MARK: - Developer Mode Section

  var devModeSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      MeSectionHeader(title: "Developer")

      VStack(spacing: 10) {
        DeveloperRowView(
          icon: "shield",
          title: "ZK Identity",
          trailingText: idm.getIdentity() != nil ? "Commitment Active" : "Not initialized",
          action: { showingZKSettings = true }
        )

        DeveloperRowView(
          icon: "qrcode",
          title: "OIDC Request Scanner",
          trailingText: nil,
          action: { showingOIDCRequest = true }
        )

        DeveloperRowView(
          icon: "person.2",
          title: "Group Management",
          trailingText: "\(groupManager.groups.count) Groups",
          action: { showingGroupManager = true }
        )
      }
      .padding(.horizontal, 16)
    }
  }

}
