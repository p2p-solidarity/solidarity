//
//  PersonDetailView.swift
//  solidarity
//
//  Contact detail view — Pencil design 0YvBA. Hero gradient card
//  with mauve petal watermark + "一期一會" messages + contact info
//  rows. Share action via ActivityViewController; ellipsis opens
//  PersonDetailMoreSheet (Note editor + Delete Contact).
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

  private var subtitle: String? {
    let parts = [contact.company, contact.title]
      .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
      .filter { !$0.isEmpty }
    guard !parts.isEmpty else { return nil }
    return parts.joined(separator: " • ")
  }

  private var firstTag: String? {
    contact.tags.first(where: { !$0.isEmpty })
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

      HStack(spacing: 16) {
        Button {
          showingShareSheet = true
        } label: {
          Image(systemName: "square.and.arrow.up")
            .font(.system(size: 22, weight: .regular))
            .foregroundStyle(Color.Theme.textPrimary)
            .frame(width: 22, height: 22)
        }
        .buttonStyle(.plain)

        Button {
          showingMoreSheet = true
        } label: {
          Image(systemName: "ellipsis")
            .font(.system(size: 22, weight: .regular))
            .foregroundStyle(Color.Theme.textPrimary)
            .frame(width: 22, height: 22)
        }
        .buttonStyle(.plain)
      }
    }
    .padding(.horizontal, 16)
    .frame(height: 56)
  }

  // MARK: - Hero card

  private var heroCard: some View {
    VStack(spacing: 8) {
      avatarCircle

      Text(contact.name)
        .font(.system(size: 24, weight: .medium))
        .foregroundStyle(Color.Theme.textPrimary)
        .multilineTextAlignment(.center)

      if let subtitle {
        Text(subtitle)
          .font(.system(size: 14))
          .foregroundStyle(Color.Theme.textSecondary)
          .multilineTextAlignment(.center)
      }

      if isVerified || firstTag != nil {
        tagRow
          .padding(.top, 4)
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.leading, 12)
    .padding(.trailing, 12)
    .padding(.top, 16)
    .padding(.bottom, 24)
    .background(
      ZStack {
        LinearGradient(
          colors: [
            Color.Theme.gradientLavender,
            Color.Theme.gradientPeach,
          ],
          startPoint: .top,
          endPoint: .bottom
        )

        MauvePetalMotif()
          .allowsHitTesting(false)
      }
    )
    .clipShape(RoundedRectangle(cornerRadius: 4))
    .padding(.horizontal, 16)
  }

  private var avatarCircle: some View {
    ZStack {
      Circle()
        .fill(Color.Theme.gradientCream)

      Text(initials)
        .font(.system(size: 32, weight: .medium))
        .foregroundStyle(Color.Theme.textSecondary)
    }
    .frame(width: 88, height: 88)
    .overlay(
      Circle().stroke(Color.Theme.gradientCream, lineWidth: 1)
    )
  }

  private var initials: String {
    let trimmed = contact.name.trimmingCharacters(in: .whitespaces)
    guard !trimmed.isEmpty else { return "?" }
    let parts = trimmed.split(separator: " ").prefix(2)
    let letters = parts.compactMap { $0.first }.map { String($0) }
    return letters.joined().uppercased()
  }

  private var tagRow: some View {
    HStack(spacing: 16) {
      if isVerified {
        verifiedTag
      }
      if let firstTag {
        contextTag(firstTag)
      }
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

  // MARK: - Ephemeral messages (一期一會)

  @ViewBuilder
  private var ephemeralSection: some View {
    if hasEphemeralMessages {
      VStack(alignment: .leading, spacing: 8) {
        Text("一期一會")
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
        .background(Color(hex: 0xEEEEEE).opacity(0.8))
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
          BubbleShape(corners: .outgoing)
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
          BubbleShape(corners: .incoming)
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
    if count <= 1 {
      return "see more"
    }
    return "see \(count) messages"
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

// MARK: - Supporting types

private struct PersonDetailContactRow: Identifiable {
  let id: String
  let icon: String
  let value: String
  let url: URL?
}

/// Chat-bubble shape where one corner (pointing at the owner side) is
/// squared off. Outgoing bubbles square the bottom-right corner;
/// incoming bubbles square the bottom-left corner.
private struct BubbleShape: Shape {
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
