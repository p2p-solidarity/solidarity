import SwiftUI

/// A single contact row in the People list. Matches the Pencil design:
/// round avatar | name + subtitle + tag bubble | date column with status dot.
struct TrustGraphContactRow: View {
  let contact: ContactEntity

  private static let dateFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    return f
  }()

  private var hasVerifiedExchange: Bool {
    contact.exchangeSignature != nil && contact.myExchangeSignature != nil
  }

  private var subtitle: String? {
    let parts = [contact.company, contact.title]
      .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
    guard !parts.isEmpty else { return nil }
    return parts.joined(separator: " • ")
  }

  private var tagText: String? {
    if let first = contact.tags.first(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) {
      return first
    }
    let normalized = contact.source.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if normalized == "imported" || normalized == "manual" {
      return "#手機通訊錄"
    }
    return nil
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top, spacing: 16) {
        avatar

        VStack(alignment: .leading, spacing: 8) {
          HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
              Text(contact.name)
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(Color.Theme.textPrimary)
                .lineLimit(1)

              if let subtitle {
                Text(subtitle)
                  .font(.system(size: 14))
                  .foregroundColor(Color.Theme.textSecondary)
                  .lineLimit(1)
              }
            }

            Spacer(minLength: 8)

            dateColumn
          }

          if let tag = tagText {
            Text(tag)
              .font(.system(size: 10))
              .foregroundColor(Color.Theme.textSecondary)
              .padding(.horizontal, 4)
              .padding(.vertical, 2)
              .background(Color.Theme.searchBg)
              .clipShape(RoundedRectangle(cornerRadius: 2, style: .continuous))
          }
        }
      }
      .padding(12)

      Rectangle()
        .fill(Color.Theme.searchBg)
        .frame(height: 1)
    }
    .contentShape(Rectangle())
  }

  // MARK: - Subviews

  private var avatar: some View {
    ZStack {
      Circle()
        .fill(Color.Theme.searchBg)
      Image(systemName: "person.crop.circle.fill")
        .font(.system(size: 38))
        .foregroundColor(Color.Theme.textTertiary)
    }
    .frame(width: 38, height: 38)
    .overlay(
      Circle()
        .stroke(Color.Theme.searchBg, lineWidth: 0.5)
    )
  }

  private var dateColumn: some View {
    VStack(alignment: .trailing, spacing: 4) {
      HStack(spacing: 4) {
        Circle()
          .fill(Color.Theme.divider)
          .frame(width: 10, height: 10)
        Text(Self.dateFormatter.string(from: contact.receivedAt))
          .font(.system(size: 10))
          .foregroundColor(Color.Theme.textSecondary)
      }
    }
  }
}

// MARK: - Legacy badge (still referenced by PersonDetailView)

/// A badge that reflects the real verification level based on cryptographic proof data.
/// Level 0: No proof — no badge shown.
/// Level 1: Partial proof (one-way signature).
/// Level 2: Mutual exchange signatures.
/// Level 3: Full DID-authenticated exchange.
struct EvolvingTrustBadge: View {
  let verificationLevel: Int

  var body: some View {
    VStack(alignment: .trailing, spacing: 4) {
      if verificationLevel >= 3 {
        Text("(★)")
          .font(.system(size: 16, weight: .black, design: .monospaced))
          .foregroundColor(Color.Theme.terminalGreen)
          .shadow(color: Color.Theme.terminalGreen.opacity(0.5), radius: 4)
        Text("DID VERIFIED")
          .font(.system(size: 9, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.terminalGreen)
      } else if verificationLevel == 2 {
        Text("VERIFIED")
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .padding(.horizontal, 6)
          .padding(.vertical, 2)
          .background(Color.Theme.primaryBlue.opacity(0.2))
          .foregroundColor(Color.Theme.primaryBlue)
          .overlay(Rectangle().stroke(Color.Theme.primaryBlue, lineWidth: 1))
      } else if verificationLevel == 1 {
        Text("PARTIAL")
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .padding(.horizontal, 6)
          .padding(.vertical, 2)
          .foregroundColor(Color.Theme.textSecondary)
          .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
      }
      // Level 0: no badge shown
    }
  }
}
