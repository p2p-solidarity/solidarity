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

    if let imageData = card?.profileImage, let uiImage = UIImage(data: imageData) {
      Image(uiImage: uiImage)
        .resizable()
        .scaledToFill()
    } else if let card {
      let animal = card.animal
        ?? savedAnimalRaw.flatMap(AnimalCharacter.init(rawValue:))
        ?? AnimalCharacter.default(forId: card.id.uuidString)
      ImageProvider.animalImage(for: animal)
        .resizable()
        .scaledToFill()
    } else if let animal = savedAnimalRaw.flatMap(AnimalCharacter.init(rawValue:)) {
      ImageProvider.animalImage(for: animal)
        .resizable()
        .scaledToFill()
    } else {
      Text(String(displayName.prefix(1)).uppercased())
        .font(.system(size: 22, weight: .bold))
        .foregroundColor(Color.Theme.primaryBlue)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.Theme.primaryBlue.opacity(0.18))
    }
  }

  // MARK: - Verified Credentials (Figma 737:2558 empty / 743:2981 filled)

  var identityCardSection: some View {
    VStack(alignment: .leading, spacing: 8) {
      MeSectionHeader(title: "Verified Credentials")

      if verifiedCards.isEmpty {
        VStack(spacing: 8) {
          HStack(spacing: 8) {
            MeActionTile(icon: "viewfinder", title: "Scan Identity") {
              passportFlowStartManual = false
              showingPassportFlow = true
            }
            MeActionTile(icon: "keyboard", title: "Manual Input") {
              passportFlowStartManual = true
              showingPassportFlow = true
            }
          }
          MeActionTile(icon: "square.and.arrow.up", title: "Import JSON") {
            showingVCSettings = true
          }
        }
        .padding(.horizontal, 16)
      } else {
        VStack(spacing: 8) {
          ForEach(verifiedCards) { card in
            NavigationLink {
              CredentialDetailView(card: card)
                .environmentObject(identityDataStore)
            } label: {
              VerifiedCredentialRow(
                icon: credentialIcon(for: card),
                title: card.title,
                trustLevel: card.trustLevel,
                issuerType: card.issuerType
              )
            }
            .buttonStyle(.plain)
          }
        }
      }
    }
  }

  func credentialIcon(for card: IdentityCardEntity) -> String {
    switch card.type {
    case "passport": return "doc.text.fill"
    case "student": return "graduationcap.fill"
    case "social_graph", "socialGraph": return "person.2.fill"
    default: return "checkmark.shield.fill"
    }
  }

  // MARK: - Action (Figma 737:2703)

  var addMoreSection: some View {
    VStack(alignment: .leading, spacing: 8) {
      MeSectionHeader(title: "Action")

      HStack(spacing: 8) {
        MeActionTile(icon: "plus", title: "Acquire New Proof") {
          passportFlowStartManual = false
          showingPassportFlow = true
        }
        MeActionTile(icon: "square.and.arrow.up", title: "Import Raw Credential") {
          showingVCSettings = true
        }
      }
      .padding(.horizontal, 16)
    }
  }

  // MARK: - Selective Disclosures

  var provableClaimsSection: some View {
    VStack(alignment: .leading, spacing: 8) {
      MeSectionHeader(title: "Selective Disclosures")

      if displayClaims.isEmpty {
        Text("No derivations available.")
          .font(.system(size: 13))
          .foregroundColor(Color.Theme.textTertiary)
          .padding(.horizontal, 16)
      } else {
        VStack(spacing: 8) {
          ForEach(displayClaims) { claim in
            DisclosureRowView(
              icon: claimIcon(for: claim),
              title: claim.title,
              source: String(localized: "Src:\(claim.source.capitalized)"),
              actionTitle: "Show",
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

  func claimIcon(for claim: ProvableClaimEntity) -> String {
    switch claim.claimType {
    case "is_human": return "faceid"
    case "age_over_18": return "face.smiling"
    case "profile_card": return "person.crop.rectangle.fill"
    case "field_name": return "person.fill"
    default: return "checkmark.shield.fill"
    }
  }

  // MARK: - Developer Mode Section (Figma 737:2748)

  var devModeSection: some View {
    VStack(alignment: .leading, spacing: 8) {
      MeSectionHeader(title: "Developer")

      VStack(spacing: 8) {
        MeDeveloperRow(
          icon: "shield",
          title: "ZK Identity",
          trailingText: idm.getIdentity() != nil ? String(localized: "Commitment Active") : String(localized: "Not initialized"),
          action: { showingZKSettings = true }
        )

        MeDeveloperRow(
          icon: "qrcode",
          title: "OIDC Request Scanner",
          trailingText: nil,
          action: { showingOIDCRequest = true }
        )

        MeDeveloperRow(
          icon: "person.2",
          title: "Group Management",
          trailingText: String(localized: "\(groupManager.groups.count) Groups"),
          action: { showingGroupManager = true }
        )
      }
      .padding(.horizontal, 16)
    }
  }

}
