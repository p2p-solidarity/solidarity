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

  private var isVerified: Bool {
    contact.verificationStatus == VerificationStatus.verified.rawValue
  }

  /// One-line note used as the row's secondary line.
  private var noteText: String? {
    let raw = contact.notes?
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "\n", with: " ") ?? ""
    return raw.isEmpty ? nil : raw
  }

  /// Origin pill shown at the bottom of the row.
  private var sourceLabel: String {
    let normalized = contact.source
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .lowercased()
    if normalized == "imported" { return "import" }
    if normalized == ContactSource.manual.rawValue.lowercased() { return "manual" }
    // qrCode / proximity / appClip / airdrop — all face-to-face style swaps.
    return "exchanged"
  }

  /// True when either party left an ichigo-ichie message during the swap.
  private var hasSakura: Bool {
    let mine = contact.myEphemeralMessage?
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let theirs = contact.theirEphemeralMessage?
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return !mine.isEmpty || !theirs.isEmpty
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top, spacing: 16) {
        avatar

        VStack(alignment: .leading, spacing: 6) {
          HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
              Text(contact.name)
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(Color.Theme.textPrimary)
                .lineLimit(1)

              if let note = noteText {
                Text(note)
                  .font(.system(size: 14))
                  .foregroundColor(Color.Theme.textSecondary)
                  .lineLimit(1)
                  .truncationMode(.tail)
              }
            }

            Spacer(minLength: 8)

            dateColumn
          }

          HStack(spacing: 6) {
            sourcePill
            if hasSakura {
              sakuraPill
            }
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

  // MARK: - Pills

  private var sourcePill: some View {
    Text(sourceLabel)
      .font(.system(size: 10))
      .foregroundColor(Color.Theme.textSecondary)
      .padding(.horizontal, 4)
      .padding(.vertical, 2)
      .background(Color.Theme.searchBg)
      .clipShape(RoundedRectangle(cornerRadius: 2, style: .continuous))
  }

  private var sakuraPill: some View {
    Text("sakura")
      .font(.system(size: 10))
      .foregroundColor(Color.Theme.accentRose)
      .padding(.horizontal, 4)
      .padding(.vertical, 2)
      .background(Color.Theme.accentRose.opacity(0.12))
      .clipShape(RoundedRectangle(cornerRadius: 2, style: .continuous))
  }

  // MARK: - Subviews

  /// Each contact gets a stable solidarity-animal avatar derived from its id.
  /// We never mutate `ContactEntity` for this — it's purely a display fallback
  /// until real avatar support lands. Verified contacts get a small green
  /// `checkmark.seal.fill` badge in the bottom-right corner.
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
    .overlay(alignment: .bottomTrailing) {
      if isVerified {
        verifiedAvatarBadge
      }
    }
  }

  private var verifiedAvatarBadge: some View {
    Image(systemName: "checkmark.seal.fill")
      .font(.system(size: 12))
      .foregroundStyle(Color.Theme.terminalGreen)
      .padding(1.5)
      .background(
        Circle().fill(Color.Theme.pageBg)
      )
      .offset(x: 2, y: 2)
  }

  private var dateColumn: some View {
    VStack(alignment: .trailing, spacing: 4) {
      HStack(spacing: 4) {
        Circle()
          .fill(isVerified ? Color.Theme.terminalGreen : Color.Theme.divider)
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
