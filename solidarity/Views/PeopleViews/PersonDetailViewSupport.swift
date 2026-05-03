//
//  PersonDetailViewSupport.swift
//  solidarity
//
//  Supporting types for PersonDetailView: the contact info row model and
//  the asymmetric chat-bubble shape used by the sakura ephemerals section.
//

import SwiftUI

struct PersonDetailContactRow: Identifiable {
  let id: String
  let icon: String
  let value: String
  let url: URL?
}

/// Chat-bubble shape where one corner (pointing at the owner side) is
/// squared off. Outgoing bubbles square the bottom-right corner;
/// incoming bubbles square the bottom-left corner.
struct PersonDetailBubbleShape: Shape {
  enum Corners {
    case outgoing, incoming
  }

  let corners: Corners
  let radius: CGFloat = 4
  let squaredRadius: CGFloat = 0

  func path(in rect: CGRect) -> Path {
    let topLeft = radius
    let topRight = radius
    let bottomRight: CGFloat
    let bottomLeft: CGFloat
    switch corners {
    case .outgoing:
      bottomRight = squaredRadius
      bottomLeft = radius
    case .incoming:
      bottomRight = radius
      bottomLeft = squaredRadius
    }

    var path = Path()
    path.move(to: CGPoint(x: rect.minX + topLeft, y: rect.minY))
    path.addLine(to: CGPoint(x: rect.maxX - topRight, y: rect.minY))
    path.addArc(
      center: CGPoint(x: rect.maxX - topRight, y: rect.minY + topRight),
      radius: topRight,
      startAngle: .degrees(-90),
      endAngle: .degrees(0),
      clockwise: false
    )
    path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - bottomRight))
    path.addArc(
      center: CGPoint(x: rect.maxX - bottomRight, y: rect.maxY - bottomRight),
      radius: bottomRight,
      startAngle: .degrees(0),
      endAngle: .degrees(90),
      clockwise: false
    )
    path.addLine(to: CGPoint(x: rect.minX + bottomLeft, y: rect.maxY))
    path.addArc(
      center: CGPoint(x: rect.minX + bottomLeft, y: rect.maxY - bottomLeft),
      radius: bottomLeft,
      startAngle: .degrees(90),
      endAngle: .degrees(180),
      clockwise: false
    )
    path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + topLeft))
    path.addArc(
      center: CGPoint(x: rect.minX + topLeft, y: rect.minY + topLeft),
      radius: topLeft,
      startAngle: .degrees(180),
      endAngle: .degrees(270),
      clockwise: false
    )
    path.closeSubpath()
    return path
  }
}

// MARK: - Declared proof claims

extension PersonDetailView {
  /// Proof claims declared in the peer's VC `verified_proofs` block. We
  /// did NOT re-verify the underlying passport ZK / SD-JWT — show as
  /// "claims: …" to keep that distinction explicit. Intentionally placed
  /// in its own row, separate from `verifiedTag`, so users don't read the
  /// declaration as a verification by us.
  @ViewBuilder
  var declaredClaimsRow: some View {
    if !contact.declaredProofClaims.isEmpty {
      HStack(spacing: 8) {
        ForEach(contact.declaredProofClaims, id: \.self) { claim in
          declaredClaimChip(claim)
        }
      }
    }
  }

  fileprivate func declaredClaimChip(_ claimType: String) -> some View {
    HStack(spacing: 4) {
      Image(systemName: Self.claimIcon(claimType))
        .font(.system(size: 10))
        .foregroundStyle(Color.Theme.textSecondary)
        .frame(width: 12, height: 12)
      Text(Self.claimDisplayName(claimType))
        .font(.system(size: 10, design: .monospaced))
        .foregroundStyle(Color.Theme.textSecondary)
    }
    .padding(.horizontal, 4)
    .padding(.vertical, 2)
    .overlay(
      RoundedRectangle(cornerRadius: 2)
        .stroke(Color.Theme.divider, lineWidth: 1)
    )
  }

  fileprivate static func claimIcon(_ claimType: String) -> String {
    switch claimType {
    case "is_human": return "person.fill.checkmark"
    case "age_over_18": return "calendar.badge.checkmark"
    default: return "sparkles"
    }
  }

  fileprivate static func claimDisplayName(_ claimType: String) -> String {
    switch claimType {
    case "is_human": return String(localized: "claims: real human")
    case "age_over_18": return String(localized: "claims: 18+")
    default: return String(localized: "claims: \(claimType)")
    }
  }
}
