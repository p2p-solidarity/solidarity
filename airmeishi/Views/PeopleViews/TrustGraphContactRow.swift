import SwiftUI

/// A component representing a single connection in the People Tab's Trust Graph.
/// Features a WinCard (Neo-Brutalist) layout, evolving badges, and a notepad snippet for ephemeral messages.
struct TrustGraphContactRow: View {
  let contact: ContactEntity

  /// Whether both sides have exchange signatures (real cryptographic proof).
  private var hasVerifiedExchange: Bool {
    contact.exchangeSignature != nil && contact.myExchangeSignature != nil
  }

  /// Verification level derived from real contact data.
  private var verificationLevel: Int {
    var level = 0
    if contact.exchangeSignature != nil { level += 1 }
    if contact.myExchangeSignature != nil { level += 1 }
    if contact.didPublicKey != nil { level += 1 }
    return level
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {

      // Top Area: Identity & Badge
      HStack(alignment: .top, spacing: 12) {

        // Avatar Block
        ZStack {
          Rectangle()
            .fill(Color.Theme.searchBg)
            .frame(width: 48, height: 48)
            .overlay(
              Rectangle().stroke(Color.Theme.divider, lineWidth: 1)
            )

          Text(String(contact.name.prefix(1)).uppercased())
            .font(.system(size: 20, weight: .bold, design: .monospaced))
            .foregroundColor(.white)
        }

        // Name & Title
        VStack(alignment: .leading, spacing: 4) {
          Text(contact.name)
            .font(.system(size: 18, weight: .bold))
            .foregroundColor(.white)
            .lineLimit(1)

          if let title = contact.title, !title.isEmpty {
            Text(title)
              .font(.system(size: 14, weight: .regular, design: .monospaced))
              .foregroundColor(Color.Theme.textSecondary)
              .lineLimit(1)
          }
        }

        Spacer()

        // Trust Badge based on real verification data
        EvolvingTrustBadge(verificationLevel: verificationLevel)
      }
      .padding(16)

      Rectangle()
        .fill(Color.Theme.divider)
        .frame(height: 1)

      // Middle Area: Ephemeral Message (Notepad Snippet)
      if let message = contact.theirEphemeralMessage, !message.isEmpty {
        HStack(alignment: .top, spacing: 8) {
          Image(systemName: "quote.opening")
            .font(.system(size: 12, weight: .bold))
            .foregroundColor(Color.Theme.primaryBlue)
            .padding(.top, 2)

          Text(message)
            .font(.system(size: 14, weight: .medium, design: .default))
            .foregroundColor(.black)
            .lineSpacing(4)
            .italic()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        // High contrast yellow/white notepad paper look
        .background(Color.Theme.warmCream)
      } else if let notes = contact.notes, !notes.isEmpty {
        Text(notes)
          .font(.system(size: 14, design: .monospaced))
          .foregroundColor(Color.Theme.textSecondary)
          .padding(16)
      }

      Rectangle()
        .fill(Color.Theme.divider)
        .frame(height: 1)

      // Bottom Area: Terminal Metadata
      HStack {
        Text("[\(formatDate(contact.receivedAt))]")
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textTertiary)

        Spacer()

        Text("[ \(contact.source.uppercased()) ]")
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .foregroundColor(hasVerifiedExchange ? Color.Theme.terminalGreen : Color.Theme.textTertiary)
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
      .background(Color.Theme.searchBg)
    }
    .background(Color.Theme.cardBg)
    .overlay(
      Rectangle().stroke(Color.Theme.divider, lineWidth: 1)
    )
    .padding(.horizontal, 16)
    .padding(.vertical, 8)
  }

  private static let dateFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yy.MM.dd HH:mm"
    return f
  }()

  private func formatDate(_ date: Date) -> String {
    Self.dateFormatter.string(from: date)
  }
}

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
