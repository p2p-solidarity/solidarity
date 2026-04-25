//
//  PersonDetailView.swift
//  solidarity
//
//  Contact detail view — Figma node 723:2337 / 723:2340. Centered hero
//  (avatar + name + note line + verified/unverified pill + optional
//  context tag) with an edit pencil at the top-right. Below the hero
//  sit the "sakura" exchange messages (when present) and the contact
//  info rows. Tap the pencil — or long-press the hero — to surface
//  the Note / Share / Delete sheet.
//

import SwiftUI

struct PersonDetailView: View {
  let contact: ContactEntity
  @EnvironmentObject private var identityDataStore: IdentityDataStore
  @Environment(\.dismiss) private var dismiss

  @State private var showingShareSheet = false
  @State private var showingMoreSheet = false

  // MARK: - Derived data

  private var isVerified: Bool {
    contact.verificationStatus == VerificationStatus.verified.rawValue
  }

  private var trimmedNote: String? {
    let raw = contact.notes?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return raw.isEmpty ? nil : raw
  }

  private var unverifiedLabel: String {
    switch contact.source {
    case "imported":
      return "unverified (import)"
    case ContactSource.manual.rawValue:
      return "unverified (manual)"
    case ContactSource.qrCode.rawValue:
      return "unverified (qr)"
    case ContactSource.airdrop.rawValue:
      return "unverified (airdrop)"
    case ContactSource.appClip.rawValue:
      return "unverified (clip)"
    case ContactSource.proximity.rawValue:
      return "unverified (proximity)"
    default:
      return "unverified"
    }
  }

  private var firstTag: String? {
    contact.tags.first(where: { !$0.isEmpty })
  }

  private var hasNote: Bool {
    !(contact.notes?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
  }

  private var hasMyMessage: Bool {
    !(contact.myEphemeralMessage?.isEmpty ?? true)
  }

  private var hasTheirMessage: Bool {
    !(contact.theirEphemeralMessage?.isEmpty ?? true)
  }

  private var hasEphemeralMessages: Bool {
    hasMyMessage || hasTheirMessage
  }

  private var messageCount: Int {
    (hasMyMessage ? 1 : 0) + (hasTheirMessage ? 1 : 0)
  }

  private var webURLFromGraphRef: URL? {
    guard let ref = contact.graphCredentialRef,
      let url = URL(string: ref),
      url.scheme == "http" || url.scheme == "https"
    else { return nil }
    return url
  }

  // MARK: - Body

  var body: some View {
    VStack(spacing: 0) {
      topBar

      ScrollView {
        VStack(spacing: 24) {
          heroCard
          ephemeralSection
          contactInfoSection
        }
        .padding(.top, 12)
        .padding(.bottom, 32)
      }
    }
    .background(Color.Theme.pageBg.ignoresSafeArea())
    .navigationBarHidden(true)
    .toolbar(.hidden, for: .navigationBar)
    .sheet(isPresented: $showingShareSheet) {
      ActivityViewController(activityItems: [
        String(format: String(localized: "Check out %@ on AirMeishi!"), contact.name)
      ])
    }
    .sheet(isPresented: $showingMoreSheet) {
      PersonDetailMoreSheet(
        contact: contact,
        onSave: { updated in
          contact.notes = updated
          identityDataStore.refreshAll()
        },
        onDelete: {
          identityDataStore.deleteContact(by: contact.id)
          dismiss()
        }
      )
    }
  }

  // MARK: - Top bar

  private var topBar: some View {
    HStack {
      Button {
        dismiss()
      } label: {
        Image(systemName: "chevron.left")
          .font(.system(size: 24, weight: .regular))
          .foregroundStyle(Color.Theme.textPrimary)
      }
      .buttonStyle(.plain)

      Spacer()

      Button {
        showingShareSheet = true
      } label: {
        Image(systemName: "square.and.arrow.up")
          .font(.system(size: 22, weight: .regular))
          .foregroundStyle(Color.Theme.textPrimary)
          .frame(width: 22, height: 22)
      }
      .buttonStyle(.plain)
    }
    .padding(.horizontal, 16)
    .frame(height: 56)
  }

  // MARK: - Hero card

  private var heroCard: some View {
    ZStack(alignment: .topTrailing) {
      VStack(spacing: 16) {
        avatarCircle

        VStack(spacing: 8) {
          Text(contact.name)
            .font(.system(size: 24, weight: .medium))
            .foregroundStyle(Color.Theme.textPrimary)
            .multilineTextAlignment(.center)

          heroNoteLine

          tagRow
        }
      }
      .frame(maxWidth: .infinity)
      .padding(.horizontal, 12)
      .padding(.top, 16)
      .padding(.bottom, 24)

      heroEditButton
    }
    .background(
      ZStack {
        // Figma 723:2336 — linear-gradient(17.3°, #E9E3ED 36.4%, #F3DFDD 68.4%)
        LinearGradient(
          stops: [
            .init(color: Color.Theme.gradientLavender, location: 0.36),
            .init(color: Color.Theme.gradientPeach, location: 0.68),
          ],
          startPoint: UnitPoint(x: 0.35, y: 0.98),
          endPoint: UnitPoint(x: 0.65, y: 0.02)
        )

        MauvePetalMotif()
          .allowsHitTesting(false)
      }
    )
    .clipShape(RoundedRectangle(cornerRadius: 4))
    .padding(.horizontal, 16)
    .contextMenu {
      Button {
        showingMoreSheet = true
      } label: {
        Label(hasNote ? "Edit Note" : "Add Note", systemImage: "note.text")
      }
      Button {
        showingShareSheet = true
      } label: {
        Label("Share", systemImage: "square.and.arrow.up")
      }
      Button(role: .destructive) {
        showingMoreSheet = true
      } label: {
        Label("Delete Contact", systemImage: "trash")
      }
    }
  }

  private var heroEditButton: some View {
    Button {
      showingMoreSheet = true
    } label: {
      Image(systemName: "square.and.pencil")
        .font(.system(size: 14, weight: .regular))
        .foregroundStyle(Color.Theme.textPrimary.opacity(0.75))
        .frame(width: 32, height: 32)
        .background(
          Circle()
            .fill(Color.white.opacity(0.45))
        )
        .overlay(
          Circle()
            .stroke(Color.white.opacity(0.6), lineWidth: 0.5)
        )
    }
    .buttonStyle(.plain)
    .padding(10)
    .accessibilityLabel(hasNote ? "Edit note" : "Add note")
  }

  @ViewBuilder
  private var heroNoteLine: some View {
    Button {
      showingMoreSheet = true
    } label: {
      Group {
        if let note = trimmedNote {
          Text(note)
            .font(.system(size: 14))
            .foregroundStyle(Color.Theme.textSecondary)
        } else {
          HStack(spacing: 4) {
            Text("//")
              .font(.system(size: 12, weight: .medium, design: .monospaced))
              .foregroundStyle(Color.Theme.primaryBlue)
            Text("tap to add note")
              .font(.system(size: 12, design: .monospaced))
              .foregroundStyle(Color.Theme.textTertiary)
          }
        }
      }
      .lineLimit(1)
      .multilineTextAlignment(.center)
      .frame(maxWidth: .infinity)
    }
    .buttonStyle(.plain)
  }

  private var avatarCircle: some View {
    let animal = AnimalCharacter.default(forId: contact.id)
    return ZStack {
      Circle()
        .fill(Color.Theme.gradientCream)

      ImageProvider.animalImage(for: animal)
        .resizable()
        .scaledToFit()
        .frame(width: 88, height: 88)
        .clipShape(Circle())
    }
    .frame(width: 88, height: 88)
    .overlay(
      Circle().stroke(Color.Theme.gradientCream, lineWidth: 1)
    )
  }

  private var tagRow: some View {
    HStack(spacing: 16) {
      statusTag
      if let firstTag {
        contextTag(firstTag)
      }
    }
  }

  @ViewBuilder
  private var statusTag: some View {
    if isVerified {
      verifiedTag
    } else {
      unverifiedTag
    }
  }

  private var verifiedTag: some View {
    HStack(spacing: 4) {
      Image(systemName: "checkmark.seal.fill")
        .font(.system(size: 10))
        .foregroundStyle(Color.Theme.terminalGreen)
        .frame(width: 12, height: 12)
      Text(verifiedLabel)
        .font(.system(size: 10))
        .foregroundStyle(Color.Theme.textSecondary)
    }
    .padding(.horizontal, 4)
    .padding(.vertical, 2)
    .background(
      RoundedRectangle(cornerRadius: 2)
        .fill(Color(hex: 0xF7F2FA))
    )
  }

  private var unverifiedTag: some View {
    HStack(spacing: 4) {
      Image(systemName: "circle.dashed")
        .font(.system(size: 10))
        .foregroundStyle(Color.Theme.textTertiary)
        .frame(width: 12, height: 12)
      Text(unverifiedLabel)
        .font(.system(size: 10))
        .foregroundStyle(Color.Theme.textSecondary)
    }
    .padding(.horizontal, 4)
    .padding(.vertical, 2)
    .background(
      RoundedRectangle(cornerRadius: 2)
        .fill(Color(hex: 0xF7F2FA))
    )
  }

  private var verifiedLabel: String {
    if let date = contact.exchangeTimestamp {
      return "Verified · \(Self.tagDateFormatter.string(from: date))"
    }
    return "Verified"
  }

  private func contextTag(_ label: String) -> some View {
    HStack(spacing: 4) {
      Image(systemName: "mappin.and.ellipse")
        .font(.system(size: 9))
        .foregroundStyle(Color.Theme.textSecondary)
        .frame(width: 12, height: 12)
      Text(label)
        .font(.system(size: 10))
        .foregroundStyle(Color.Theme.textSecondary)
    }
    .padding(.horizontal, 4)
    .padding(.vertical, 2)
    .background(
      RoundedRectangle(cornerRadius: 2)
        .fill(Color(hex: 0xF7F2FA))
    )
  }

  // MARK: - Sakura messages (exchange ephemerals)

  @ViewBuilder
  private var ephemeralSection: some View {
    if hasEphemeralMessages {
      VStack(alignment: .leading, spacing: 8) {
        Text("sakura")
          .font(.system(size: 14))
          .foregroundStyle(Color.Theme.textPrimary)

        VStack(alignment: .trailing, spacing: 12) {
          if let mine = contact.myEphemeralMessage, !mine.isEmpty {
            outgoingBubble(text: mine)
          }
          if let theirs = contact.theirEphemeralMessage, !theirs.isEmpty {
            incomingBubble(text: theirs)
          }
          if messageCount > 0 {
            seeMorePill
              .frame(maxWidth: .infinity, alignment: .center)
          }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .background(
          RoundedRectangle(cornerRadius: 12)
            .fill(Color(hex: 0xEEEEEE).opacity(0.8))
        )
      }
      .padding(.horizontal, 16)
    }
  }

  private func outgoingBubble(text: String) -> some View {
    VStack(alignment: .trailing, spacing: 2) {
      Text(text)
        .font(.system(size: 14))
        .foregroundStyle(Color.white)
        .multilineTextAlignment(.leading)
        .lineSpacing(4)
        .padding(12)
        .background(
          PersonDetailBubbleShape(corners: .outgoing)
            .fill(Color.Theme.accentRose)
        )

      if let date = contact.exchangeTimestamp {
        Text(Self.bubbleDateFormatter.string(from: date))
          .font(.system(size: 10))
          .foregroundStyle(Color.Theme.textSecondary)
      }
    }
    .frame(maxWidth: .infinity, alignment: .trailing)
  }

  private func incomingBubble(text: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(text)
        .font(.system(size: 14))
        .foregroundStyle(Color.Theme.textPrimary)
        .multilineTextAlignment(.leading)
        .lineSpacing(4)
        .padding(12)
        .background(
          PersonDetailBubbleShape(corners: .incoming)
            .fill(Color.Theme.warmCream)
        )

      if let date = contact.exchangeTimestamp {
        Text(Self.bubbleDateFormatter.string(from: date))
          .font(.system(size: 10))
          .foregroundStyle(Color.Theme.textSecondary)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var seeMorePill: some View {
    HStack(spacing: 2) {
      Text(seeMoreLabel)
        .font(.system(size: 10))
        .foregroundStyle(Color.Theme.textSecondary)
      Image(systemName: "chevron.right")
        .font(.system(size: 12))
        .foregroundStyle(Color.Theme.textSecondary)
    }
    .padding(.leading, 8)
    .padding(.trailing, 4)
    .padding(.vertical, 4)
    .background(
      Capsule().fill(Color(hex: 0xEEEEEE))
    )
  }

  private var seeMoreLabel: String {
    let count = messageCount
    let noun = count == 1 ? "message" : "messages"
    return "see more \(count) \(noun)"
  }

  // MARK: - Contact info

  @ViewBuilder
  private var contactInfoSection: some View {
    let rows = contactRows
    if !rows.isEmpty {
      VStack(alignment: .leading, spacing: 10) {
        Text("contact info")
          .font(.system(size: 14))
          .foregroundStyle(Color.Theme.textPrimary)

        VStack(spacing: 8) {
          ForEach(rows) { row in
            contactRowView(row)
          }
        }
      }
      .padding(.horizontal, 16)
    }
  }

  private var contactRows: [PersonDetailContactRow] {
    var out: [PersonDetailContactRow] = []
    if let phone = contact.phone, !phone.isEmpty {
      out.append(
        PersonDetailContactRow(
          id: "phone",
          icon: "phone",
          value: phone,
          url: URL(string: "tel:\(phone)")
        )
      )
    }
    if let email = contact.email, !email.isEmpty {
      out.append(
        PersonDetailContactRow(
          id: "email",
          icon: "envelope",
          value: email,
          url: URL(string: "mailto:\(email)")
        )
      )
    }
    if let url = webURLFromGraphRef {
      out.append(
        PersonDetailContactRow(
          id: "link",
          icon: "link",
          value: url.absoluteString,
          url: url
        )
      )
    }
    return out
  }

  private func contactRowView(_ row: PersonDetailContactRow) -> some View {
    Button {
      if let url = row.url {
        UIApplication.shared.open(url)
      }
    } label: {
      HStack(spacing: 8) {
        Image(systemName: row.icon)
          .font(.system(size: 15, weight: .regular))
          .foregroundStyle(Color.Theme.textPrimary)
          .frame(width: 18, height: 18)
        Text(row.value)
          .font(.system(size: 15))
          .foregroundStyle(Color.Theme.textPrimary)
          .lineLimit(1)
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 12)
      .frame(height: 48)
      .background(
        RoundedRectangle(cornerRadius: 2)
          .fill(Color(hex: 0xEEEEEE).opacity(0.8))
      )
    }
    .buttonStyle(.plain)
  }

  // MARK: - Formatters

  private static let tagDateFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    return f
  }()

  private static let bubbleDateFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    return f
  }()
}
