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

  /// Combines the first non-empty tag with the contact's note so a single
  /// inline chip summarises both context ("在 DID Workshop 認識的") and the
  /// user's written memo ("聊了 zk 的事"). Falls back to source-based default
  /// for imported/manual contacts when neither exists.
  private var tagText: String? {
    let tag = contact.tags
      .first(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty })?
      .trimmingCharacters(in: .whitespaces)
    let note = contact.notes?
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "\n", with: " ")
    let noteValue = (note?.isEmpty == false) ? note : nil

    switch (tag, noteValue) {
    case let (tag?, note?):
      return "\(tag) · \(note)"
    case let (tag?, nil):
      return tag
    case let (nil, note?):
      return note
    case (nil, nil):
      let normalized = contact.source.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
      if normalized == "imported" || normalized == "manual" {
        return "#手機通訊錄"
      }
      return nil
    }
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
              .lineLimit(1)
              .truncationMode(.tail)
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

  /// Each contact gets a stable solidarity-animal avatar derived from its id.
  /// We never mutate `ContactEntity` for this — it's purely a display fallback
  /// until real avatar support lands.
  private var avatar: some View {
    let animal = AnimalCharacter.default(forId: contact.id)
    return ZStack {
      Circle()
        .fill(Color.Theme.searchBg)
      ImageProvider.animalImage(for: animal)
        .resizable()
        .scaledToFit()
        .frame(width: 38, height: 38)
        .clipShape(Circle())
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
