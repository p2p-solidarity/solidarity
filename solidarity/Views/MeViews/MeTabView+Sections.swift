import SwiftUI

extension MeTabView {

  var identityHeader: some View {
    VStack(spacing: 16) {
      HStack(alignment: .top, spacing: 16) {
        identityAvatar
          .frame(width: 80, height: 80)
          .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))

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
        Rectangle().fill(Color.Theme.searchBg)
        ImageProvider.animalImage(for: animal)
          .resizable()
          .scaledToFit()
          .padding(6)
      }
    } else {
      ZStack {
        Rectangle().fill(Color.Theme.searchBg)
        Text(String(displayName.prefix(1)).uppercased())
          .font(.system(size: 32, weight: .bold, design: .monospaced))
          .foregroundColor(.white)
      }
    }
  }

  var identityCardSection: some View {
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

  func trustText(for card: IdentityCardEntity) -> String {
    switch card.trustLevel {
    case "green": return "🟢 LEVEL 3 — ZK VERIFIED"
    case "blue": return "🔵 LEVEL 2 — FALLBACK"
    default: return "⚪️ LEVEL 1 — SELF-ATTESTED"
    }
  }

  var provableClaimsSection: some View {
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
        if preparingClaimID != nil {
          HStack(spacing: 8) {
            ProgressView()
              .progressViewStyle(CircularProgressViewStyle(tint: Color.Theme.terminalGreen))
              .scaleEffect(0.8)
            Text("Generating proof...")
              .font(.system(size: 10, weight: .bold, design: .monospaced))
              .foregroundColor(Color.Theme.textSecondary)
          }
          .padding(.horizontal, 24)
        }

        VStack(spacing: 12) {
          ForEach(displayClaims) { claim in
            ClaimRowView(
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

  var addMoreSection: some View {
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

  func sectionActionLabel(icon: String, title: String) -> some View {
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

  var devModeSection: some View {
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

}
