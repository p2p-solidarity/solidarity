//
//  PersonDetailView.swift
//  solidarity
//
//  Contact detail view — spec [PL-2] using ContactEntity
//

import SwiftUI

struct PersonDetailView: View {
  let contact: ContactEntity
  @EnvironmentObject private var identityDataStore: IdentityDataStore
  @Environment(\.dismiss) private var dismiss
  @Environment(\.colorScheme) private var colorScheme
  @State private var showingDeleteConfirm = false
  @State private var showingShareSheet = false

  /// Verification level derived from real exchange data.
  private var verificationLevel: Int {
    var level = 0
    if contact.exchangeSignature != nil { level += 1 }
    if contact.myExchangeSignature != nil { level += 1 }
    if displayDidPublicKey != nil { level += 1 }
    return level
  }

  private var displayDidPublicKey: String? {
    guard let did = contact.didPublicKey, !did.isEmpty else { return nil }
    if did == SecureKeyManager.shared.mySignPubKey { return nil }
    return did
  }

  private var isVerified: Bool {
    contact.verificationStatus == VerificationStatus.verified.rawValue
  }

  /// Fields verified through this contact's linked credentials (via the
  /// VerifiedClaimIndex). UI reads this to show per-field verified badges
  /// — not the raw ContactEntity columns.
  private var verifiedFieldsFromIndex: Set<BusinessCardField> {
    guard !contact.credentialIds.isEmpty else { return [] }
    return VerifiedClaimIndex.verifiedFields(fromCredentials: contact.credentialIds)
  }

  private var linkedCredentials: [IdentityCardEntity] {
    guard !contact.credentialIds.isEmpty else { return [] }
    let idSet = Set(contact.credentialIds)
    return identityDataStore.identityCards.filter { idSet.contains($0.id) }
  }

  var body: some View {
    ScrollView {
      VStack(spacing: 20) {
        profileHeader
        verificationBadge
        ephemeralMessageSection
        contactInfoSection
        linkedCredentialsSection
        exchangeMetadataSection
        actionButtons
      }
      .padding(.horizontal, 20)
      .padding(.vertical, 16)
    }
    .background(Color.Theme.pageBg.ignoresSafeArea())
    .navigationTitle("Profile")
    .navigationBarTitleDisplayMode(.inline)
    .sheet(isPresented: $showingShareSheet) {
      ActivityViewController(activityItems: [
        String(format: String(localized: "Check out %@ on AirMeishi!"), contact.name)
      ])
    }
    .confirmationDialog(
      "Delete \(contact.name)?",
      isPresented: $showingDeleteConfirm,
      titleVisibility: .visible
    ) {
      Button("Delete", role: .destructive) {
        identityDataStore.deleteContact(by: contact.id)
        dismiss()
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This contact will be permanently removed.")
    }
  }

  // MARK: - Profile Header

  private var profileHeader: some View {
    VStack(spacing: 16) {
      ZStack {
        Rectangle()
          .fill(Color.Theme.searchBg)
          .frame(width: 96, height: 96)
          .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))

        Text(String(contact.name.prefix(1)).uppercased())
          .font(.system(size: 36, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textPrimary)
      }

      VStack(spacing: 6) {
        Text(contact.name)
          .font(.system(size: 24, weight: .bold))
          .foregroundColor(Color.Theme.textPrimary)

        if let title = contact.title, !title.isEmpty {
          Text(title)
            .font(.system(size: 14, weight: .medium, design: .monospaced))
            .foregroundColor(Color.Theme.textSecondary)
        }

        if let company = contact.company, !company.isEmpty {
          Text(company)
            .font(.system(size: 12, design: .monospaced))
            .foregroundColor(Color.Theme.textTertiary)
        }
      }
    }
    .padding(.vertical, 8)
  }

  // MARK: - Verification Badge

  private var verificationBadge: some View {
    HStack(spacing: 8) {
      EvolvingTrustBadge(verificationLevel: verificationLevel)

      if isVerified, let date = contact.exchangeTimestamp {
        Text("[\(formatDate(date))]")
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textTertiary)
      }

      Text("[ \(contact.source.uppercased()) ]")
        .font(.system(size: 10, weight: .bold, design: .monospaced))
        .foregroundColor(isVerified ? Color.Theme.terminalGreen : Color.Theme.textTertiary)
    }
    .padding(12)
    .frame(maxWidth: .infinity)
    .background(Color.Theme.searchBg)
    .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
  }

  // MARK: - Ephemeral Messages (一期一會)

  @ViewBuilder
  private var ephemeralMessageSection: some View {
    let hasMyMsg = !(contact.myEphemeralMessage?.isEmpty ?? true)
    let hasTheirMsg = !(contact.theirEphemeralMessage?.isEmpty ?? true)

    if hasMyMsg || hasTheirMsg {
      VStack(alignment: .leading, spacing: 12) {
        Text("— 一期一會")
          .font(.system(size: 12, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textSecondary)

        if let msg = contact.theirEphemeralMessage, !msg.isEmpty {
          ephemeralBubble(label: "RX (FROM THEM)", message: msg, isIncoming: true)
        }

        if let msg = contact.myEphemeralMessage, !msg.isEmpty {
          ephemeralBubble(label: "TX (FROM ME)", message: msg, isIncoming: false)
        }
      }
      .padding(16)
      .background(Color.Theme.cardBg)
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    }
  }

  private func ephemeralBubble(label: String, message: String, isIncoming: Bool) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(label)
        .font(.system(size: 10, weight: .bold, design: .monospaced))
        .foregroundColor(isIncoming ? Color.Theme.primaryBlue : Color.Theme.terminalGreen)

      HStack(alignment: .top, spacing: 8) {
        Image(systemName: "quote.opening")
          .font(.system(size: 10, weight: .bold))
          .foregroundColor(isIncoming ? Color.Theme.primaryBlue : Color.Theme.terminalGreen)
          .padding(.top, 2)

        Text(message)
          .font(.system(size: 14, weight: .medium))
          .foregroundColor(Color.Theme.textPrimary)
          .italic()
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .padding(10)
      .background(Color.Theme.warmCream)
    }
  }

  // MARK: - Contact Info

  private var contactInfoSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("— CONTACT INFO")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textSecondary)

      VStack(spacing: 8) {
        if contact.name.isEmpty == false {
          HStack(spacing: 4) {
            Spacer(minLength: 0)
            if verifiedFieldsFromIndex.contains(.name) {
              fieldVerifiedBadge(field: .name)
            }
          }
        }

        if let email = contact.email, !email.isEmpty {
          contactInfoRow(
            icon: "envelope",
            label: "EMAIL",
            value: email,
            verified: verifiedFieldsFromIndex.contains(.email)
          ) {
            if let url = URL(string: "mailto:\(email)") {
              UIApplication.shared.open(url)
            }
          }
        }

        if let phone = contact.phone, !phone.isEmpty {
          contactInfoRow(
            icon: "phone",
            label: "PHONE",
            value: phone,
            verified: verifiedFieldsFromIndex.contains(.phone)
          ) {
            if let url = URL(string: "tel:\(phone)") {
              UIApplication.shared.open(url)
            }
          }
        }

        if let notes = contact.notes, !notes.isEmpty {
          HStack(alignment: .top, spacing: 12) {
            Image(systemName: "note.text")
              .font(.system(size: 12, weight: .bold))
              .foregroundColor(Color.Theme.textTertiary)
              .frame(width: 20)

            VStack(alignment: .leading, spacing: 2) {
              Text("NOTES")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(Color.Theme.textTertiary)
              Text(notes)
                .font(.system(size: 14))
                .foregroundColor(Color.Theme.textPrimary)
            }
          }
        }
      }
    }
    .padding(16)
    .background(Color.Theme.cardBg)
    .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
  }

  private func contactInfoRow(
    icon: String,
    label: String,
    value: String,
    verified: Bool = false,
    action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      HStack(spacing: 12) {
        Image(systemName: icon)
          .font(.system(size: 12, weight: .bold))
          .foregroundColor(Color.Theme.primaryBlue)
          .frame(width: 20)

        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 6) {
            Text(label)
              .font(.system(size: 10, weight: .bold, design: .monospaced))
              .foregroundColor(Color.Theme.textTertiary)
            if verified {
              Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(Color.Theme.terminalGreen)
            }
          }
          Text(value)
            .font(.system(size: 14))
            .foregroundColor(Color.Theme.textPrimary)
        }

        Spacer()

        Image(systemName: "arrow.up.right")
          .font(.system(size: 10, weight: .bold))
          .foregroundColor(Color.Theme.textTertiary)
      }
    }
    .buttonStyle(.plain)
  }

  private func fieldVerifiedBadge(field: BusinessCardField) -> some View {
    HStack(spacing: 4) {
      Image(systemName: "checkmark.seal.fill")
        .font(.system(size: 9, weight: .bold))
      Text("\(field.displayName.uppercased()) VERIFIED")
        .font(.system(size: 9, weight: .bold, design: .monospaced))
    }
    .foregroundColor(Color.Theme.terminalGreen)
    .padding(.horizontal, 6)
    .padding(.vertical, 3)
    .background(Color.Theme.terminalGreen.opacity(0.08))
  }

  // MARK: - Linked Credentials

  @ViewBuilder
  private var linkedCredentialsSection: some View {
    if linkedCredentials.isEmpty == false {
      VStack(alignment: .leading, spacing: 12) {
        HStack {
          Text("— LINKED CREDENTIALS")
            .font(.system(size: 12, weight: .bold, design: .monospaced))
            .foregroundColor(Color.Theme.textSecondary)
          Spacer()
          Text("\(linkedCredentials.count)")
            .font(.system(size: 12, weight: .bold, design: .monospaced))
            .foregroundColor(Color.Theme.textTertiary)
        }

        VStack(spacing: 8) {
          ForEach(linkedCredentials, id: \.id) { card in
            linkedCredentialRow(card)
          }
        }
      }
      .padding(16)
      .background(Color.Theme.cardBg)
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    }
  }

  private func linkedCredentialRow(_ card: IdentityCardEntity) -> some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: trustIcon(for: card.trustLevel))
        .font(.system(size: 12, weight: .bold))
        .foregroundColor(trustColor(for: card.trustLevel))
        .frame(width: 20, alignment: .top)
        .padding(.top, 2)

      VStack(alignment: .leading, spacing: 2) {
        Text(card.title)
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(Color.Theme.textPrimary)
        Text("\(card.issuerType.uppercased()) · \(card.status.uppercased())")
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textTertiary)
      }

      Spacer()
    }
    .padding(10)
    .background(Color.Theme.searchBg)
    .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
  }

  private func trustIcon(for level: String) -> String {
    switch level {
    case "green": return "seal.fill"
    case "blue": return "seal"
    default: return "doc.text"
    }
  }

  private func trustColor(for level: String) -> Color {
    switch level {
    case "green": return Color.Theme.terminalGreen
    case "blue": return Color.Theme.primaryBlue
    default: return Color.Theme.textTertiary
    }
  }

  // MARK: - Exchange Metadata

  @ViewBuilder
  private var exchangeMetadataSection: some View {
    if displayDidPublicKey != nil || contact.exchangeSignature != nil {
      VStack(alignment: .leading, spacing: 12) {
        Text("— EXCHANGE DATA")
          .font(.system(size: 12, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textSecondary)

        VStack(spacing: 8) {
          if let did = displayDidPublicKey {
            metadataRow(label: "PEER PUB KEY", value: shortKey(did))
          }

          if contact.exchangeSignature != nil {
            metadataRow(label: "THEIR SIG", value: "✓ Present")
          }

          if contact.myExchangeSignature != nil {
            metadataRow(label: "MY SIG", value: "✓ Present")
          }

          if let ts = contact.exchangeTimestamp {
            metadataRow(label: "TIMESTAMP", value: formatDate(ts))
          }
        }
      }
      .padding(16)
      .background(Color.Theme.cardBg)
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    }
  }

  private func metadataRow(label: String, value: String) -> some View {
    HStack(alignment: .top, spacing: 16) {
      Text(label)
        .font(.system(size: 10, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textTertiary)
        .frame(width: 80, alignment: .leading)
      Text(value)
        .font(.system(size: 12, weight: .regular, design: .monospaced))
        .foregroundColor(Color.Theme.textPrimary)
    }
  }

  // MARK: - Actions

  private var actionButtons: some View {
    VStack(spacing: 12) {
      Button {
        showingShareSheet = true
      } label: {
        HStack(spacing: 6) {
          Image(systemName: "square.and.arrow.up")
            .font(.system(size: 12, weight: .bold))
          Text("Share Contact")
            .font(.system(size: 14, weight: .bold, design: .monospaced))
        }
        .foregroundColor(Color.Theme.textPrimary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(Color.Theme.searchBg)
        .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
      }
      .buttonStyle(.plain)

      Button {
        showingDeleteConfirm = true
      } label: {
        Text("Delete Contact")
          .font(.system(size: 14, weight: .bold, design: .monospaced))
          .foregroundColor(.red.opacity(0.8))
          .frame(maxWidth: .infinity)
          .padding(.vertical, 12)
          .background(Color.red.opacity(0.04))
          .overlay(Rectangle().stroke(Color.red.opacity(0.12), lineWidth: 1))
      }
      .buttonStyle(.plain)
    }
  }

  // MARK: - Helpers

  private static let dateFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yy.MM.dd HH:mm"
    return f
  }()

  private func formatDate(_ date: Date) -> String {
    Self.dateFormatter.string(from: date)
  }

  private func shortKey(_ key: String) -> String {
    guard key.count > 20 else { return key }
    return "\(key.prefix(10))...\(key.suffix(8))"
  }
}
