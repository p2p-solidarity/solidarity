//
//  ShareSettingsView.swift
//  airmeishi
//
//  Per-field sharing toggles + proof badge selection.
//  Replaces SharingLevel (public/professional/personal).
//

import SwiftUI

struct ShareSettingsView: View {
  @AppStorage("share_field_title") private var shareTitle = false
  @AppStorage("share_field_company") private var shareCompany = false
  @AppStorage("share_field_email") private var shareEmail = false
  @AppStorage("share_field_phone") private var sharePhone = false
  @AppStorage("share_field_profileImage") private var shareProfileImage = false
  @AppStorage("share_field_socialNetworks") private var shareSocialNetworks = false
  @AppStorage("share_field_skills") private var shareSkills = false
  @AppStorage("share_proof_is_human") private var shareIsHuman = true
  @AppStorage("share_proof_age_over_18") private var shareAgeOver18 = false

  @ObservedObject private var identityStore = IdentityDataStore.shared
  @StateObject private var cardManager = CardManager.shared
  @StateObject private var qrCodeManager = QRCodeManager.shared
  @Environment(\.colorScheme) private var colorScheme

  @State private var generatedQRImage: UIImage?

  private var hasPassportClaims: Bool {
    !identityStore.provableClaims.filter { $0.issuerType == "government" }.isEmpty
  }

  private var hasHumanClaim: Bool {
    identityStore.provableClaims.contains { $0.claimType == "is_human" }
  }

  private var hasAgeClaim: Bool {
    identityStore.provableClaims.contains { $0.claimType == "age_over_18" }
  }

  var body: some View {
    ScrollView {
      VStack(spacing: 20) {
        qrPreview

        fieldToggles

        if hasHumanClaim || hasAgeClaim {
          proofToggles
        }
      }
      .padding(16)
    }
    .background(Color.Theme.pageBg.ignoresSafeArea())
    .navigationTitle("Share Settings")
    .navigationBarTitleDisplayMode(.inline)
    .onAppear { refreshQR() }
    .onChange(of: shareTitle) { _, _ in refreshQR() }
    .onChange(of: shareCompany) { _, _ in refreshQR() }
    .onChange(of: shareEmail) { _, _ in refreshQR() }
    .onChange(of: sharePhone) { _, _ in refreshQR() }
    .onChange(of: shareProfileImage) { _, _ in refreshQR() }
    .onChange(of: shareSocialNetworks) { _, _ in refreshQR() }
    .onChange(of: shareSkills) { _, _ in refreshQR() }
    .onChange(of: shareIsHuman) { _, _ in refreshQR() }
    .onChange(of: shareAgeOver18) { _, _ in refreshQR() }
  }

  // MARK: - QR Preview

  private var qrPreview: some View {
    VStack(spacing: 12) {
      Text("QR PREVIEW")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textTertiary)

      Group {
        if let generatedQRImage {
          Image(uiImage: generatedQRImage)
            .resizable()
            .interpolation(.none)
            .scaledToFit()
        } else {
          VStack(spacing: 8) {
            Image(systemName: "qrcode")
              .font(.system(size: 40))
              .foregroundColor(Color.Theme.textTertiary)
            Text("Create a card first")
              .font(.system(size: 12))
              .foregroundColor(Color.Theme.textTertiary)
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      }
      .frame(maxWidth: .infinity)
      .aspectRatio(1, contentMode: .fit)
      .padding(12)
      .background(Color.white)
      .cornerRadius(8)
    }
    .padding(16)
    .background(Color.Theme.cardBg)
    .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
  }

  // MARK: - Field Toggles

  private var fieldToggles: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("SHARE FIELDS")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textTertiary)
        .padding(.bottom, 8)

      VStack(spacing: 1) {
        fieldRow(icon: "person.text.rectangle", label: "Name", isOn: .constant(true), locked: true)
        fieldRow(icon: "id.card", label: "Title", isOn: $shareTitle)
        fieldRow(icon: "building.2", label: "Company", isOn: $shareCompany)
        fieldRow(icon: "envelope", label: "Email", isOn: $shareEmail)
        fieldRow(icon: "phone", label: "Phone", isOn: $sharePhone)
        fieldRow(icon: "person.crop.circle", label: "Profile Image", isOn: $shareProfileImage)
        fieldRow(icon: "link", label: "Social Networks", isOn: $shareSocialNetworks)
        fieldRow(icon: "star", label: "Skills", isOn: $shareSkills)
      }
      .clipShape(Rectangle())
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    }
  }

  // MARK: - Proof Toggles

  private var proofToggles: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("PROOFS")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textTertiary)
        .padding(.bottom, 8)

      VStack(spacing: 1) {
        if hasHumanClaim {
          proofRow(
            icon: "person.badge.shield.checkmark.fill",
            label: "Real Human",
            badge: "Government",
            badgeColor: Color.Theme.terminalGreen,
            isOn: $shareIsHuman
          )
        }
        if hasAgeClaim {
          proofRow(
            icon: "calendar.badge.checkmark",
            label: "Age 18+",
            badge: "Government",
            badgeColor: Color.Theme.terminalGreen,
            isOn: $shareAgeOver18
          )
        }
      }
      .clipShape(Rectangle())
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    }
  }

  // MARK: - Row Components

  private func fieldRow(icon: String, label: String, isOn: Binding<Bool>, locked: Bool = false) -> some View {
    HStack(spacing: 12) {
      Image(systemName: icon)
        .font(.system(size: 14))
        .foregroundColor(isOn.wrappedValue ? Color.Theme.terminalGreen : Color.Theme.textTertiary)
        .frame(width: 20)

      Text(label)
        .font(.system(size: 14, weight: .medium))
        .foregroundColor(isOn.wrappedValue ? Color.Theme.textPrimary : Color.Theme.textSecondary)

      Spacer()

      if locked {
        Image(systemName: "lock.fill")
          .font(.system(size: 12))
          .foregroundColor(Color.Theme.textTertiary)
      } else {
        Image(systemName: isOn.wrappedValue ? "checkmark.square.fill" : "square")
          .font(.system(size: 18))
          .foregroundColor(isOn.wrappedValue ? Color.Theme.terminalGreen : Color.Theme.textTertiary)
      }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
    .background(Color.Theme.searchBg)
    .contentShape(Rectangle())
    .onTapGesture {
      guard !locked else { return }
      HapticFeedbackManager.shared.rigidImpact()
      isOn.wrappedValue.toggle()
    }
  }

  private func proofRow(icon: String, label: String, badge: String, badgeColor: Color, isOn: Binding<Bool>) -> some View {
    HStack(spacing: 12) {
      Image(systemName: icon)
        .font(.system(size: 14))
        .foregroundColor(isOn.wrappedValue ? badgeColor : Color.Theme.textTertiary)
        .frame(width: 20)

      VStack(alignment: .leading, spacing: 2) {
        Text(label)
          .font(.system(size: 14, weight: .medium))
          .foregroundColor(isOn.wrappedValue ? Color.Theme.textPrimary : Color.Theme.textSecondary)
        Text(badge)
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .foregroundColor(badgeColor)
      }

      Spacer()

      Image(systemName: isOn.wrappedValue ? "checkmark.square.fill" : "square")
        .font(.system(size: 18))
        .foregroundColor(isOn.wrappedValue ? badgeColor : Color.Theme.textTertiary)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
    .background(Color.Theme.searchBg)
    .contentShape(Rectangle())
    .onTapGesture {
      HapticFeedbackManager.shared.rigidImpact()
      isOn.wrappedValue.toggle()
    }
  }

  // MARK: - QR Generation

  private func refreshQR() {
    guard let card = cardManager.businessCards.first else {
      generatedQRImage = nil
      return
    }
    let fields = enabledFields
    let result = qrCodeManager.generateQRCode(for: card, fields: fields)
    if case .success(let image) = result {
      generatedQRImage = image
    }
  }

  var enabledFields: Set<BusinessCardField> {
    var fields: Set<BusinessCardField> = [.name]
    if shareTitle { fields.insert(.title) }
    if shareCompany { fields.insert(.company) }
    if shareEmail { fields.insert(.email) }
    if sharePhone { fields.insert(.phone) }
    if shareProfileImage { fields.insert(.profileImage) }
    if shareSocialNetworks { fields.insert(.socialNetworks) }
    if shareSkills { fields.insert(.skills) }
    return fields
  }
}

// MARK: - Global helper to read share settings from AppStorage

enum ShareSettingsReader {
  static var enabledFields: Set<BusinessCardField> {
    ShareSettingsStore.enabledFields
  }

  static var shareIsHuman: Bool {
    ShareSettingsStore.shareIsHuman
  }

  static var shareAgeOver18: Bool {
    ShareSettingsStore.shareAgeOver18
  }
}
