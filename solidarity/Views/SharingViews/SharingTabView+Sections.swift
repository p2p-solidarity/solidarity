//
//  SharingTabView+Sections.swift
//  solidarity
//

import SwiftUI

extension SharingTabView {

  // MARK: - QR Section

  var qrSection: some View {
    let card = cardManager.businessCards.first

    return VStack(spacing: 0) {
      // Collapsible QR code with white background
      if isQRExpanded {
        ZStack {
          if let generatedQRImage {
            Image(uiImage: generatedQRImage)
              .resizable()
              .interpolation(.none)
              .scaledToFit()
              .padding(24)
          } else {
            VStack(spacing: 10) {
              Image(systemName: "qrcode")
                .font(.system(size: 44))
                .foregroundColor(Color(white: 0.78))
              Text("Create a card to generate QR")
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(Color(white: 0.6))
            }
            .frame(maxWidth: .infinity)
            .frame(height: 200)
          }
        }
        .frame(maxWidth: .infinity)
        .aspectRatio(1, contentMode: .fit)
        .background(Color.white)
        .transition(.opacity.combined(with: .move(edge: .top)))
      }

      // Card info footer (always visible, tappable to toggle QR)
      VStack(spacing: 10) {
        // Name + avatar row
        HStack(spacing: 10) {
          profileAvatar(for: card)

          VStack(alignment: .leading, spacing: 2) {
            Text(card?.name ?? "No Card")
              .font(.system(size: 15, weight: .semibold))
              .foregroundColor(Color.Theme.textPrimary)
              .lineLimit(1)

            Text(sharedFieldsSummary)
              .font(.system(size: 11, design: .monospaced))
              .foregroundColor(Color.Theme.textTertiary)
              .lineLimit(1)
          }

          Spacer()

          // Collapse/expand chevron
          Button {
            withAnimation(.easeInOut(duration: 0.25)) {
              isQRExpanded.toggle()
            }
          } label: {
            Image(systemName: "chevron.up")
              .font(.system(size: 12, weight: .semibold))
              .foregroundColor(Color.Theme.textTertiary)
              .rotationEffect(.degrees(isQRExpanded ? 0 : 180))
              .padding(8)
              .background(Color.Theme.searchBg)
              .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
          }

          NavigationLink {
            ShareSettingsView()
          } label: {
            Image(systemName: "slider.horizontal.3")
              .font(.system(size: 14))
              .foregroundColor(Color.Theme.textSecondary)
              .padding(8)
              .background(Color.Theme.searchBg)
              .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
          }
        }

        // Proof badges
        proofBadges
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
      .background(Color.Theme.cardSurface(for: colorScheme))
    }
    .clipShape(RoundedRectangle(cornerRadius: 12))
    .overlay(
      RoundedRectangle(cornerRadius: 12)
        .stroke(Color.Theme.cardBorder(for: colorScheme), lineWidth: 1)
    )
    .shadow(color: .black.opacity(0.08), radius: 12, x: 0, y: 4)
  }

  var sharedFieldsSummary: String {
    let fields = ShareSettingsReader.enabledFields
    let labels = fields.sorted(by: { $0.rawValue < $1.rawValue }).compactMap { field -> String? in
      switch field {
      case .name: return nil // always on, skip
      case .title: return "title"
      case .company: return "company"
      case .email: return "email"
      case .phone: return "phone"
      case .profileImage: return "photo"
      case .socialNetworks: return "socials"
      case .skills: return "skills"
      }
    }
    if labels.isEmpty { return "name only" }
    return "name + " + labels.joined(separator: ", ")
  }

  var proofBadges: some View {
    let claims = IdentityDataStore.shared.provableClaims.filter { $0.issuerType == "government" }
    return Group {
      if !claims.isEmpty {
        HStack(spacing: 8) {
          if ShareSettingsReader.shareIsHuman,
             claims.contains(where: { $0.claimType == "is_human" }) {
            proofPill(label: "Real Human", color: Color.Theme.terminalGreen)
          }
          if ShareSettingsReader.shareAgeOver18,
             claims.contains(where: { $0.claimType == "age_over_18" }) {
            proofPill(label: "Age 18+", color: Color.Theme.terminalGreen)
          }
          Spacer()
        }
      }
    }
  }

  func proofPill(label: String, color: Color) -> some View {
    HStack(spacing: 4) {
      Circle()
        .fill(color)
        .frame(width: 6, height: 6)
      Text(label)
        .font(.system(size: 11, weight: .semibold, design: .monospaced))
        .foregroundColor(color)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 4)
    .background(
      Capsule()
        .fill(color.opacity(0.12))
    )
  }

  // MARK: - Quick Actions

  var quickActions: some View {
    HStack(spacing: 12) {
      Button {
        showingScanSheet = true
      } label: {
        HStack(spacing: 8) {
          Image(systemName: "qrcode.viewfinder")
            .font(.system(size: 16, weight: .semibold))
          Text("Scan QR")
            .font(.system(size: 14, weight: .semibold))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .foregroundColor(Color.Theme.textPrimary)
        .background(Color.Theme.searchBg)
        .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
      }
      .buttonStyle(.plain)

      Button {
        showingShareActivity = true
      } label: {
        HStack(spacing: 8) {
          Image(systemName: "square.and.arrow.up")
            .font(.system(size: 16, weight: .semibold))
          Text("Share")
            .font(.system(size: 14, weight: .semibold))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .foregroundColor(Color.Theme.textPrimary)
        .background(Color.Theme.searchBg)
        .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
      }
      .buttonStyle(.plain)
    }
  }
}
