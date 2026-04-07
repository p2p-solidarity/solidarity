//
//  ShareSettingsView.swift
//  solidarity
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

  /// Fields that are externally verified (backed by source credentials).
  private var externallyVerifiedFields: Set<BusinessCardField> {
    guard let card = cardManager.businessCards.first else { return [] }
    let holderDid = card.id.uuidString
    return VerifiedClaimIndex.verifiedFieldsSync(forHolder: holderDid)
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
    .onAppear {
      enforceMandatoryProofs()
      refreshQR()
    }
    .onChange(of: hasHumanClaim) { _, _ in
      enforceMandatoryProofs()
    }
    .onChange(of: shareTitle) { _, _ in refreshQR() }
    .onChange(of: shareCompany) { _, _ in refreshQR() }
    .onChange(of: shareEmail) { _, _ in refreshQR() }
    .onChange(of: sharePhone) { _, _ in refreshQR() }
    .onChange(of: shareProfileImage) { _, _ in refreshQR() }
    .onChange(of: shareSocialNetworks) { _, _ in refreshQR() }
    .onChange(of: shareSkills) { _, _ in refreshQR() }
    .onChange(of: shareIsHuman) { _, newValue in
      if hasHumanClaim, !newValue {
        shareIsHuman = true
      }
      refreshQR()
    }
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
    let verified = externallyVerifiedFields

    return VStack(alignment: .leading, spacing: 0) {
      HStack {
        Text("SHARE FIELDS")
          .font(.system(size: 12, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textTertiary)
        Spacer()
        Text("VC = enters signed credential")
          .font(.system(size: 10, design: .monospaced))
          .foregroundColor(Color.Theme.textTertiary)
      }
      .padding(.bottom, 8)

      VStack(spacing: 1) {
        fieldRow(icon: "person.text.rectangle", label: "Name", field: .name, isOn: .constant(true), locked: true, verified: verified)
        fieldRow(icon: "briefcase", label: "Title", field: .title, isOn: $shareTitle, verified: verified)
        fieldRow(icon: "building.2", label: "Company", field: .company, isOn: $shareCompany, verified: verified)
        fieldRow(icon: "envelope", label: "Email", field: .email, isOn: $shareEmail, verified: verified)
        fieldRow(icon: "phone", label: "Phone", field: .phone, isOn: $sharePhone, verified: verified)
        fieldRow(icon: "person.crop.circle", label: "Profile Image", field: .profileImage, isOn: $shareProfileImage, verified: verified)
        fieldRow(icon: "link", label: "Social Networks", field: .socialNetworks, isOn: $shareSocialNetworks, verified: verified)
        fieldRow(icon: "star", label: "Skills", field: .skills, isOn: $shareSkills, verified: verified)
      }
      .clipShape(Rectangle())
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))

      // Legend
      HStack(spacing: 16) {
        legendItem(color: Color.Theme.terminalGreen, label: "Verified")
        legendItem(color: .orange, label: "Self-attested")
        legendItem(color: Color.Theme.textTertiary, label: "Not in VC")
      }
      .padding(.top, 8)
    }
  }

  private func legendItem(color: Color, label: String) -> some View {
    HStack(spacing: 4) {
      Circle().fill(color).frame(width: 6, height: 6)
      Text(label)
        .font(.system(size: 10, design: .monospaced))
        .foregroundColor(Color.Theme.textTertiary)
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
            isOn: $shareIsHuman,
            locked: true
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

  private func fieldRow(
    icon: String,
    label: String,
    field: BusinessCardField,
    isOn: Binding<Bool>,
    locked: Bool = false,
    verified: Set<BusinessCardField> = []
  ) -> some View {
    let isVerified = verified.contains(field)
    // Skills and profileImage never enter VC (unverifiable / too large).
    let excludedFromVC = field == .skills || field == .profileImage
    let vcStatus: FieldVerificationStatus = {
      if excludedFromVC { return .unverified }
      if isVerified { return .verifiedBySource }
      return .selfAttested
    }()
    let statusColor: Color = {
      switch vcStatus {
      case .verifiedBySource: return Color.Theme.terminalGreen
      case .selfAttested: return .orange
      case .unverified: return Color.Theme.textTertiary
      }
    }()

    return HStack(spacing: 12) {
      Image(systemName: icon)
        .font(.system(size: 14))
        .foregroundColor(isOn.wrappedValue ? statusColor : Color.Theme.textTertiary)
        .frame(width: 20)

      VStack(alignment: .leading, spacing: 2) {
        Text(label)
          .font(.system(size: 14, weight: .medium))
          .foregroundColor(isOn.wrappedValue ? Color.Theme.textPrimary : Color.Theme.textSecondary)

        if isOn.wrappedValue {
          Text(vcStatusLabel(vcStatus, excludedFromVC: excludedFromVC))
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .foregroundColor(statusColor)
        }
      }

      Spacer()

      if locked {
        Image(systemName: "lock.fill")
          .font(.system(size: 12))
          .foregroundColor(Color.Theme.textTertiary)
      } else {
        Image(systemName: isOn.wrappedValue ? "checkmark.square.fill" : "square")
          .font(.system(size: 18))
          .foregroundColor(isOn.wrappedValue ? statusColor : Color.Theme.textTertiary)
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

  private func vcStatusLabel(_ status: FieldVerificationStatus, excludedFromVC: Bool) -> String {
    if excludedFromVC { return "Shared but not in VC" }
    switch status {
    case .verifiedBySource: return "VC: verified"
    case .selfAttested: return "VC: self-attested"
    case .unverified: return "Not in VC"
    }
  }

  private func proofRow(
    icon: String,
    label: String,
    badge: String,
    badgeColor: Color,
    isOn: Binding<Bool>,
    locked: Bool = false
  ) -> some View {
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

      if locked {
        Image(systemName: "lock.fill")
          .font(.system(size: 12))
          .foregroundColor(Color.Theme.textTertiary)
      } else {
        Image(systemName: isOn.wrappedValue ? "checkmark.square.fill" : "square")
          .font(.system(size: 18))
          .foregroundColor(isOn.wrappedValue ? badgeColor : Color.Theme.textTertiary)
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

  private func enforceMandatoryProofs() {
    guard hasHumanClaim else { return }
    if !shareIsHuman {
      shareIsHuman = true
    }
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
