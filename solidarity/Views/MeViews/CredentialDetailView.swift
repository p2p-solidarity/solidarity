import SwiftUI
import UIKit

struct CredentialDetailView: View {
  let card: IdentityCardEntity
  @EnvironmentObject private var identityDataStore: IdentityDataStore
  @State private var selectedClaimIDs: Set<String> = []
  @State private var showingPresentation = false
  @State private var showingRegenConfirm = false

  private var associatedClaims: [ProvableClaimEntity] {
    identityDataStore.provableClaims.filter { $0.identityCardId == card.id }
  }

  private var proofType: String {
    if card.metadataTags.contains("mopro-noir") {
      return "OpenPassport (Noir/Mopro)"
    }
    if card.metadataTags.contains("semaphore-zk") {
      return "Semaphore ZK"
    }
    return "SD-JWT Fallback"
  }

  private var proofTagText: String {
    if card.metadataTags.contains("mopro-noir") {
      return "OpenPassport"
    }
    if card.metadataTags.contains("semaphore-zk") {
      return "Semaphore ZK"
    }
    return "SD-JWT Fallback"
  }

  private var proofIcon: String {
    if card.metadataTags.contains("mopro-noir") {
      return "bolt.shield.fill"
    }
    if card.metadataTags.contains("semaphore-zk") {
      return "shield.checkered"
    }
    return "doc.text.fill"
  }

  private var levelText: String {
    switch card.trustLevel {
    case "green": return "Level 3 - ZK Verified"
    case "blue": return "Level 2 - Fallback"
    default: return "Level 1 - Self-attested"
    }
  }

  private var levelAccent: Color {
    switch card.trustLevel {
    case "green": return Color.Theme.terminalGreen
    case "blue": return Color.Theme.primaryBlue
    default: return Color.Theme.textTertiary
    }
  }

  var body: some View {
    VStack(spacing: 0) {
      ScrollView {
        VStack(spacing: 32) {
          credentialHero
          metadataSection
          claimsSection
        }
        .padding(.top, 12)
        .padding(.bottom, 24)
      }

      presentBar
    }
    .background(Color.Theme.pageBg.ignoresSafeArea())
    .navigationTitle("Credential")
    .navigationBarTitleDisplayMode(.inline)
    .onAppear {
      selectedClaimIDs = Set(associatedClaims.map(\.id))
    }
    .sheet(isPresented: $showingPresentation) {
      PresentationSheet(
        card: card,
        selectedClaims: associatedClaims.filter { selectedClaimIDs.contains($0.id) }
      )
    }
    .confirmationDialog(
      "Regenerate this credential?",
      isPresented: $showingRegenConfirm,
      titleVisibility: .visible
    ) {
      Button("Regenerate", role: .destructive) {
        identityDataStore.removePassportCredentials()
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This will remove the current credential and all associated claims. You will need to re-scan your document.")
    }
  }

  // MARK: - Hero (Figma 724:22805)

  private var credentialHero: some View {
    VStack(spacing: 8) {
      ZStack {
        Circle()
          .fill(Color.Theme.heroSkyDisc)
          .frame(width: 56, height: 56)
        Image(systemName: credentialIcon)
          .font(.system(size: 22, weight: .regular))
          .foregroundColor(Color.Theme.textPrimary)
      }

      VStack(spacing: 16) {
        Text(card.title)
          .font(.system(size: 24, weight: .medium))
          .foregroundColor(Color.Theme.textPrimary)

        VStack(spacing: 8) {
          levelTag
          HStack(spacing: 16) {
            verifiedTag
            proofSystemTag
          }
        }
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.horizontal, 12)
    .padding(.top, 16)
    .padding(.bottom, 24)
    .background(
      LinearGradient(
        colors: [Color.Theme.heroSkyTop, Color.Theme.heroSkyBottom],
        startPoint: .top,
        endPoint: .bottom
      )
    )
    .clipShape(RoundedRectangle(cornerRadius: 4))
    .padding(.horizontal, 16)
  }

  private var credentialIcon: String {
    switch card.type {
    case "passport": return "doc.text.fill"
    case "student": return "graduationcap.fill"
    case "social_graph", "socialGraph": return "person.2.fill"
    default: return "checkmark.shield.fill"
    }
  }

  private var levelTag: some View {
    Text(levelText.uppercased())
      .font(.system(size: 10, weight: .medium))
      .foregroundColor(levelAccent)
      .padding(.horizontal, 4)
      .padding(.vertical, 2)
      .frame(maxWidth: .infinity)
      .overlay(
        RoundedRectangle(cornerRadius: 2)
          .stroke(levelAccent, lineWidth: 0.5)
      )
  }

  private var verifiedTag: some View {
    HStack(spacing: 4) {
      Image(systemName: "checkmark.seal")
        .font(.system(size: 9))
        .foregroundColor(Color.Theme.textSecondary)
        .frame(width: 12, height: 12)
      Text(card.status.capitalized)
        .font(.system(size: 10))
        .foregroundColor(Color.Theme.textSecondary)
    }
    .padding(.horizontal, 4)
    .padding(.vertical, 2)
    .background(
      RoundedRectangle(cornerRadius: 2)
        .fill(Color.Theme.chipSurface)
    )
  }

  private var proofSystemTag: some View {
    HStack(spacing: 4) {
      Image(systemName: proofIcon)
        .font(.system(size: 9))
        .foregroundColor(Color.Theme.textSecondary)
        .frame(width: 12, height: 12)
      Text(proofTagText)
        .font(.system(size: 10))
        .foregroundColor(Color.Theme.textSecondary)
    }
    .padding(.horizontal, 4)
    .padding(.vertical, 2)
    .background(
      RoundedRectangle(cornerRadius: 2)
        .fill(Color.Theme.chipSurface)
    )
  }

  // MARK: - Metadata (Figma 724:22828)

  private var metadataSection: some View {
    VStack(alignment: .leading, spacing: 8) {
      sectionHeader("Credential metadata")

      VStack(spacing: 0) {
        metadataRow(label: "Issuer", value: card.issuerDid, position: .first)
        metadataRow(label: "Holder", value: shortDid(card.holderDid), position: .middle)
        metadataRow(label: "Issued", value: formatDate(card.issuedAt), position: .middle)
        metadataRow(label: "Expires", value: card.expiresAt.map(formatDate) ?? String(localized: "None"), position: .middle)
        metadataRow(label: "Proof", value: proofType, position: .last)
      }
      .padding(.horizontal, 16)
    }
  }

  private enum RowPosition { case first, middle, last }

  private func metadataRow(label: LocalizedStringKey, value: String, position: RowPosition) -> some View {
    HStack {
      Text(label)
        .font(.system(size: 15))
        .foregroundColor(Color.Theme.textSecondary)
      Spacer()
      Text(value)
        .font(.system(size: 15))
        .foregroundColor(Color.Theme.textPrimary)
        .lineLimit(1)
        .truncationMode(.middle)
    }
    .padding(.horizontal, 12)
    .frame(height: 48)
    .background(
      UnevenRoundedRectangle(cornerRadii: cornerRadii(position))
        .fill(Color.Theme.mutedSurface)
    )
  }

  private func cornerRadii(_ position: RowPosition) -> RectangleCornerRadii {
    switch position {
    case .first:
      return RectangleCornerRadii(topLeading: 8, bottomLeading: 0, bottomTrailing: 0, topTrailing: 8)
    case .middle:
      return RectangleCornerRadii()
    case .last:
      return RectangleCornerRadii(topLeading: 0, bottomLeading: 8, bottomTrailing: 8, topTrailing: 0)
    }
  }

  // MARK: - Claims (Figma 724:22844)

  private var claimsSection: some View {
    VStack(alignment: .leading, spacing: 8) {
      sectionHeader("Selective Disclosures")

      if associatedClaims.isEmpty {
        Text("No claims associated with this credential.")
          .font(.system(size: 13))
          .foregroundColor(Color.Theme.textTertiary)
          .padding(.horizontal, 16)
      } else {
        VStack(spacing: 8) {
          ForEach(associatedClaims) { claim in
            claimRow(claim)
          }
        }
        .padding(.horizontal, 16)
      }
    }
  }

  private func claimRow(_ claim: ProvableClaimEntity) -> some View {
    let isSelected = selectedClaimIDs.contains(claim.id)
    return Button {
      if isSelected {
        selectedClaimIDs.remove(claim.id)
      } else {
        selectedClaimIDs.insert(claim.id)
      }
    } label: {
      HStack(spacing: 8) {
        Image(systemName: claimIcon(claim.claimType))
          .font(.system(size: 14, weight: .regular))
          .foregroundColor(Color.Theme.terminalGreen)
          .frame(width: 18, height: 18)

        Text(claim.title)
          .font(.system(size: 15))
          .foregroundColor(Color.Theme.textPrimary)
          .lineLimit(1)

        Spacer(minLength: 0)

        claimCheckbox(isSelected: isSelected)
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 16)
      .background(
        RoundedRectangle(cornerRadius: 12)
          .fill(Color.Theme.mutedSurface)
      )
    }
    .buttonStyle(.plain)
  }

  private func claimCheckbox(isSelected: Bool) -> some View {
    ZStack {
      RoundedRectangle(cornerRadius: 2)
        .fill(isSelected ? Color.Theme.terminalGreen : Color.clear)
        .frame(width: 18, height: 18)
        .overlay(
          RoundedRectangle(cornerRadius: 2)
            .stroke(isSelected ? Color.Theme.terminalGreen : Color.Theme.textTertiary, lineWidth: 1)
        )
      if isSelected {
        Image(systemName: "checkmark")
          .font(.system(size: 10, weight: .bold))
          .foregroundColor(.white)
      }
    }
  }

  private func claimIcon(_ claimType: String) -> String {
    switch claimType {
    case "is_human": return "faceid"
    case "age_over_18": return "face.smiling"
    case "profile_card": return "person.crop.rectangle.fill"
    case "field_name": return "person.fill"
    default: return "checkmark.shield.fill"
    }
  }

  // MARK: - Present bar

  private var presentBar: some View {
    VStack(spacing: 8) {
      Button {
        showingPresentation = true
      } label: {
        Text("Present proof")
      }
      .buttonStyle(ThemedPrimaryButtonStyle())
      .disabled(selectedClaimIDs.isEmpty)
      .opacity(selectedClaimIDs.isEmpty ? 0.4 : 1)

      Button {
        showingRegenConfirm = true
      } label: {
        Text("Regenerate Credential")
          .font(.system(size: 12, weight: .medium))
          .foregroundColor(Color.Theme.textSecondary)
      }
      .buttonStyle(.plain)
    }
    .padding(.horizontal, 16)
    .padding(.top, 12)
    .padding(.bottom, 12)
    .background(Color.Theme.pageBg)
  }

  // MARK: - Helpers

  private func sectionHeader(_ title: LocalizedStringKey) -> some View {
    Text(title)
      .font(.system(size: 14))
      .foregroundColor(Color.Theme.textPrimary)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 16)
  }

  private func shortDid(_ did: String) -> String {
    guard did.count > 22 else { return did }
    return "\(did.prefix(12))...\(did.suffix(8))"
  }

  private func formatDate(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd HH:mm"
    return formatter.string(from: date)
  }
}

// MARK: - Presentation Sheet

private struct PresentationSheet: View {
  let card: IdentityCardEntity
  let selectedClaims: [ProvableClaimEntity]
  @Environment(\.dismiss) private var dismiss
  @StateObject private var qrCodeManager = QRCodeManager.shared
  @State private var qrImage: UIImage?
  @State private var errorMessage: String?

  var resolvedProofTypeTag: String {
    if card.metadataTags.contains("mopro-noir") { return "mopro-noir" }
    if card.metadataTags.contains("semaphore-zk") { return "semaphore-zk" }
    return "sd-jwt-fallback"
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 24) {
          VStack(spacing: 6) {
            Text(card.title)
              .font(.system(size: 16, weight: .bold))
              .foregroundColor(Color.Theme.textPrimary)
            Text("\(selectedClaims.count) claim(s) selected")
              .font(.system(size: 12, weight: .medium))
              .foregroundColor(Color.Theme.terminalGreen)
          }

          LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 8)], spacing: 8) {
            ForEach(selectedClaims) { claim in
              Text(claim.claimType)
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(Color.Theme.textPrimary)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(
                  RoundedRectangle(cornerRadius: 4)
                    .fill(Color.Theme.chipSurface)
                )
                .overlay(
                  RoundedRectangle(cornerRadius: 4)
                    .stroke(Color.Theme.terminalGreen, lineWidth: 1)
                )
            }
          }
          .padding(.horizontal, 16)

          if let qrImage {
            Image(uiImage: qrImage)
              .resizable()
              .interpolation(.none)
              .scaledToFit()
              .frame(maxWidth: 260)
              .padding(16)
              .background(Color.white)
              .cornerRadius(12)
          } else if let errorMessage {
            Text(errorMessage)
              .font(.system(size: 14))
              .foregroundColor(Color.Theme.destructive)
              .multilineTextAlignment(.center)
              .padding(.horizontal, 32)
          } else {
            ProgressView()
              .frame(height: 260)
          }

          Text("Present this QR to a verifier.\nOnly selected disclosures are included.")
            .font(.system(size: 13))
            .foregroundColor(Color.Theme.textSecondary)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 32)
        }
        .padding(.top, 24)
        .padding(.horizontal, 16)
      }
      .background(Color.Theme.pageBg.ignoresSafeArea())
      .navigationTitle("Present Proof")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button { dismiss() } label: {
            Image(systemName: "xmark")
              .foregroundColor(Color.Theme.textPrimary)
          }
        }
      }
      .onAppear { generateVP() }
    }
  }

  private func generateVP() {
    let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "")

    var credentials: [Any] = []
    if let rawJWT = card.rawCredentialJWT,
       let rawData = rawJWT.data(using: .utf8),
       let rawObj = try? JSONSerialization.jsonObject(with: rawData) {
      credentials.append(rawObj)
    }

    let vp: [String: Any] = [
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      "type": ["VerifiablePresentation"],
      "holder": card.holderDid,
      "verifiableCredential": credentials,
      "nonce": nonce,
      "proof_type": resolvedProofTypeTag,
      "selected_claims": selectedClaims.map { $0.claimType },
    ]

    guard let vpData = try? JSONSerialization.data(withJSONObject: vp, options: [.sortedKeys]),
          let vpString = String(data: vpData, encoding: .utf8) else {
      errorMessage = "Failed to build VP envelope."
      return
    }

    let result = qrCodeManager.generateQRCode(from: vpString)
    switch result {
    case .success(let image):
      qrImage = image
      selectedClaims.forEach { IdentityDataStore.shared.markClaimPresented($0.id) }
    case .failure(let error):
      errorMessage = error.localizedDescription
    }
  }
}
