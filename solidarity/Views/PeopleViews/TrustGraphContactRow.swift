import SwiftUI

/// A single contact row in the People list. Mirrors Figma `Frame 1597880336`
/// (723:2195): round avatar | name + subtitle + meeting-context tag | radar
/// icon + ISO date column.
struct TrustGraphContactRow: View {
  let contact: ContactEntity

  private static let dateFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    return f
  }()

  private var isVerified: Bool {
    contact.verificationStatus == VerificationStatus.verified.rawValue
  }

  /// One-line note used as the row's secondary line when no business-card
  /// metadata is present (typical for VCF/phone-imported contacts).
  private var noteText: String? {
    let raw = contact.notes?
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "\n", with: " ") ?? ""
    return raw.isEmpty ? nil : raw
  }

  /// Secondary line: "Company • Title" (Figma 723:2202) with note fallback
  /// for imported contacts that lack business-card metadata.
  private var subtitleText: String? {
    let parts = [contact.company, contact.title]
      .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
    if !parts.isEmpty {
      return parts.joined(separator: " • ")
    }
    return noteText
  }

  /// Single meeting-context tag (Figma 723:2211). Prefers a user-applied
  /// tag (e.g. "在 DID Workshop 認識的") and falls back to a source-derived
  /// default so every row has consistent bottom-line context.
  private var contextTag: String? {
    if let custom = contact.tags
      .compactMap({ $0.trimmingCharacters(in: .whitespacesAndNewlines) })
      .first(where: { !$0.isEmpty })
    {
      return custom
    }
    let normalized = contact.source
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .lowercased()
    switch normalized {
    case "imported":
      return "#手機通訊錄"
    case ContactSource.manual.rawValue.lowercased():
      return "手動新增"
    case ContactSource.qrCode.rawValue.lowercased(),
      ContactSource.proximity.rawValue.lowercased(),
      ContactSource.appClip.rawValue.lowercased(),
      ContactSource.airdrop.rawValue.lowercased():
      return "面對面交換"
    default:
      return nil
    }
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack(alignment: .top, spacing: 16) {
        avatar

        VStack(alignment: .leading, spacing: 8) {
          HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
              Text(contact.name)
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(Color.Theme.textPrimary)
                .lineLimit(1)

              if let subtitle = subtitleText {
                Text(subtitle)
                  .font(.system(size: 14))
                  .foregroundColor(Color.Theme.textSecondary)
                  .lineLimit(1)
                  .truncationMode(.tail)
              }
            }

            Spacer(minLength: 8)

            dateColumn
          }

          if let contextTag {
            Text(contextTag)
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

  /// Each contact gets a stable solidarity-animal avatar derived from its id.
  /// Verified contacts get a small green `checkmark.seal.fill` badge.
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
    HStack(spacing: 4) {
      RadarTickIcon()
        .frame(width: 16, height: 16)
      Text(Self.dateFormatter.string(from: contact.receivedAt))
        .font(.system(size: 10))
        .foregroundColor(Color.Theme.textSecondary)
    }
  }
}

/// Radar fade-out marker (Figma 723:2204). Five concentric strokes whose
/// opacity drops as they spread outward, evoking the proximity-exchange
/// radar without pulling in an SVG asset.
private struct RadarTickIcon: View {
  var body: some View {
    GeometryReader { geo in
      let size = min(geo.size.width, geo.size.height)
      let stroke: CGFloat = max(0.5, size * 0.0208)
      let stops: [(diameter: CGFloat, opacity: Double)] = [
        (size * 0.131, 1.0),
        (size * 0.313, 1.0),
        (size * 0.524, 0.5),
        (size * 0.767, 0.2),
        (size * 0.979, 0.05),
      ]
      ZStack {
        ForEach(stops.indices, id: \.self) { i in
          Circle()
            .stroke(Color.Theme.textSecondary.opacity(stops[i].opacity), lineWidth: stroke)
            .frame(width: stops[i].diameter, height: stops[i].diameter)
        }
      }
      .frame(width: size, height: size)
    }
    .aspectRatio(1, contentMode: .fit)
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
