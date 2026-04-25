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

      // Card info footer
      VStack(alignment: .leading, spacing: 12) {
        // Name + Real Human badge + chevron to share settings
        HStack(spacing: 10) {
          profileAvatar(for: card)

          Text(card?.name ?? "No Card")
            .font(.system(size: 17, weight: .semibold))
            .foregroundColor(Color.Theme.textPrimary)
            .lineLimit(1)

          if hasRealHumanProof {
            realHumanBadge
          }

          Spacer(minLength: 4)

          NavigationLink {
            ShareSettingsView()
          } label: {
            Image(systemName: "chevron.right")
              .font(.system(size: 14, weight: .semibold))
              .foregroundColor(Color.Theme.textTertiary)
          }
          .buttonStyle(.plain)
        }

        // Field tag pills
        fieldPills

        // Show code + share row
        HStack(spacing: 10) {
          Button {
            withAnimation(.easeInOut(duration: 0.25)) {
              isQRExpanded.toggle()
            }
          } label: {
            Text(isQRExpanded ? "Hide code" : "Show code")
              .font(.system(size: 15, weight: .semibold))
              .foregroundColor(.white)
              .frame(maxWidth: .infinity)
              .padding(.vertical, 14)
              .background(Color.Theme.textPrimary)
              .clipShape(RoundedRectangle(cornerRadius: 8))
          }
          .buttonStyle(.plain)

          Button {
            showingShareActivity = true
          } label: {
            Image(systemName: "arrow.up.forward.app")
              .font(.system(size: 18, weight: .regular))
              .foregroundColor(Color.Theme.textPrimary)
              .frame(width: 50, height: 46)
              .background(
                RoundedRectangle(cornerRadius: 8)
                  .fill(Color.Theme.warmCream)
              )
              .overlay(
                RoundedRectangle(cornerRadius: 8)
                  .stroke(Color.Theme.divider, lineWidth: 1)
              )
          }
          .buttonStyle(.plain)
        }
      }
      .padding(16)
      .background(Color.Theme.warmCream)
    }
    .clipShape(RoundedRectangle(cornerRadius: 12))
    .overlay(
      RoundedRectangle(cornerRadius: 12)
        .stroke(Color.Theme.divider.opacity(0.5), lineWidth: 1)
    )
    .shadow(color: .black.opacity(0.06), radius: 10, x: 0, y: 3)
  }

  // Sorted field pill labels for the enabled-fields row.
  private var fieldPillLabels: [String] {
    ShareSettingsReader.enabledFields
      .sorted(by: { $0.sortOrder < $1.sortOrder })
      .map(\.shortLabel)
  }

  var fieldPills: some View {
    FlowLayout(spacing: 6, lineSpacing: 6) {
      ForEach(fieldPillLabels, id: \.self) { label in
        Text(label)
          .font(.system(size: 12, weight: .medium))
          .foregroundColor(Color.Theme.textSecondary)
          .padding(.horizontal, 10)
          .padding(.vertical, 4)
          .background(
            RoundedRectangle(cornerRadius: 4)
              .fill(Color.Theme.searchBg)
          )
          .overlay(
            RoundedRectangle(cornerRadius: 4)
              .stroke(Color.Theme.divider, lineWidth: 1)
          )
      }
    }
  }

  var hasRealHumanProof: Bool {
    guard ShareSettingsReader.shareIsHuman else { return false }
    return IdentityDataStore.shared.provableClaims.contains {
      $0.issuerType == "government" && $0.claimType == "is_human"
    }
  }

  var realHumanBadge: some View {
    HStack(spacing: 4) {
      Image(systemName: "checkmark.seal.fill")
        .font(.system(size: 12))
        .foregroundColor(Color.Theme.terminalGreen)
      Text("Real human")
        .font(.system(size: 12, weight: .medium))
        .foregroundColor(Color.Theme.textSecondary)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 3)
    .overlay(
      RoundedRectangle(cornerRadius: 4)
        .stroke(Color.Theme.divider, lineWidth: 1)
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

// MARK: - Field pill helpers

extension BusinessCardField {
  fileprivate var sortOrder: Int {
    switch self {
    case .name: return 0
    case .title: return 1
    case .company: return 2
    case .email: return 3
    case .phone: return 4
    case .profileImage: return 5
    case .socialNetworks: return 6
    case .skills: return 7
    }
  }

  fileprivate var shortLabel: String {
    switch self {
    case .name: return "Name"
    case .title: return "Title"
    case .company: return "Company"
    case .email: return "Email"
    case .phone: return "Phone"
    case .profileImage: return "Profile"
    case .socialNetworks: return "Social"
    case .skills: return "Skills"
    }
  }
}

// MARK: - Simple flow layout

struct FlowLayout: Layout {
  var spacing: CGFloat = 8
  var lineSpacing: CGFloat = 8

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
    let maxWidth = proposal.width ?? .infinity
    var rowWidth: CGFloat = 0
    var totalHeight: CGFloat = 0
    var rowHeight: CGFloat = 0
    var maxRowWidth: CGFloat = 0

    for subview in subviews {
      let size = subview.sizeThatFits(.unspecified)
      if rowWidth + size.width > maxWidth, rowWidth > 0 {
        totalHeight += rowHeight + lineSpacing
        maxRowWidth = max(maxRowWidth, rowWidth - spacing)
        rowWidth = 0
        rowHeight = 0
      }
      rowWidth += size.width + spacing
      rowHeight = max(rowHeight, size.height)
    }
    totalHeight += rowHeight
    maxRowWidth = max(maxRowWidth, rowWidth - spacing)
    return CGSize(width: maxRowWidth, height: totalHeight)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
    let maxWidth = proposal.width ?? bounds.width
    var x = bounds.minX
    var y = bounds.minY
    var rowHeight: CGFloat = 0

    for subview in subviews {
      let size = subview.sizeThatFits(.unspecified)
      if x + size.width > bounds.minX + maxWidth, x > bounds.minX {
        x = bounds.minX
        y += rowHeight + lineSpacing
        rowHeight = 0
      }
      subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
      x += size.width + spacing
      rowHeight = max(rowHeight, size.height)
    }
  }
}
