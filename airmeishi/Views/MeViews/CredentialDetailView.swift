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
    if card.metadataTags.contains("semaphore-zk") {
      return "Semaphore ZK"
    }
    return "SD-JWT Fallback"
  }

  var body: some View {
    ScrollView {
      VStack(spacing: 20) {
        credentialHeader
        metadataSection
        claimsSection
        presentButton
      }
      .padding(.vertical, 24)
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
    .confirmationDialog("Regenerate this credential?", isPresented: $showingRegenConfirm, titleVisibility: .visible) {
      Button("Regenerate", role: .destructive) {
        identityDataStore.removePassportCredentials()
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This will remove the current credential and all associated claims. You will need to re-scan your document.")
    }
  }

  // MARK: - Header

  private var credentialHeader: some View {
    VStack(spacing: 12) {
      Text("🛂")
        .font(.system(size: 48))

      Text(card.title)
        .font(.system(size: 20, weight: .bold))
        .foregroundColor(Color.Theme.textPrimary)

      Text(trustText)
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.terminalGreen)

      HStack(spacing: 8) {
        statusPill(card.status)
        statusPill(proofType)
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.horizontal, 24)
  }

  private func statusPill(_ text: String) -> some View {
    Text(text.uppercased())
      .font(.system(size: 10, weight: .bold, design: .monospaced))
      .foregroundColor(Color.Theme.textPrimary)
      .padding(.horizontal, 10)
      .padding(.vertical, 5)
      .background(Color.Theme.searchBg)
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
  }

  // MARK: - Metadata

  private var metadataSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      sectionHeader("CREDENTIAL METADATA")

      VStack(spacing: 0) {
        metadataRow(label: "ISSUER", value: card.issuerDid)
        metadataRow(label: "HOLDER", value: shortDid(card.holderDid))
        metadataRow(label: "ISSUED", value: formatDate(card.issuedAt))
        metadataRow(label: "EXPIRES", value: card.expiresAt.map(formatDate) ?? "NONE")
        metadataRow(label: "PROOF", value: proofType)
      }
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    }
  }

  private func metadataRow(label: String, value: String) -> some View {
    HStack {
      Text(label)
        .font(.system(size: 10, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textTertiary)
        .frame(width: 70, alignment: .leading)
      Text(value)
        .font(.system(size: 12, weight: .medium, design: .monospaced))
        .foregroundColor(Color.Theme.textPrimary)
        .lineLimit(1)
      Spacer()
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .background(Color.Theme.cardBg)
  }

  // MARK: - Claims

  private var claimsSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      sectionHeader("SELECTIVE DISCLOSURES")

      if associatedClaims.isEmpty {
        Text("No claims associated with this credential.")
          .font(.system(size: 12, design: .monospaced))
          .foregroundColor(Color.Theme.textTertiary)
          .padding(.horizontal, 24)
      } else {
        VStack(spacing: 0) {
          ForEach(associatedClaims) { claim in
            claimToggleRow(claim)
          }
        }
        .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
        .padding(.horizontal, 16)
      }
    }
  }

  private func claimToggleRow(_ claim: ProvableClaimEntity) -> some View {
    let isSelected = selectedClaimIDs.contains(claim.id)
    return HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        Text(claim.title)
          .font(.system(size: 14, weight: .bold))
          .foregroundColor(Color.Theme.textPrimary)
        Text(claim.claimType)
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textTertiary)
      }
      Spacer()
      Button {
        if isSelected {
          selectedClaimIDs.remove(claim.id)
        } else {
          selectedClaimIDs.insert(claim.id)
        }
      } label: {
        Rectangle()
          .fill(isSelected ? Color.Theme.terminalGreen : Color.clear)
          .frame(width: 22, height: 22)
          .overlay(Rectangle().stroke(isSelected ? Color.Theme.terminalGreen : Color.Theme.divider, lineWidth: 1.5))
          .overlay {
            if isSelected {
              Image(systemName: "checkmark")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(.black)
            }
          }
      }
      .buttonStyle(.plain)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
    .background(Color.Theme.cardBg)
  }

  // MARK: - Present

  private var presentButton: some View {
    VStack(spacing: 10) {
      Button {
        showingPresentation = true
      } label: {
        HStack(spacing: 8) {
          Image(systemName: "qrcode")
            .font(.system(size: 14, weight: .bold))
          Text("Present Proof")
            .font(.system(size: 14, weight: .bold, design: .monospaced))
        }
        .foregroundColor(.black)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(Color.white)
        .overlay(Rectangle().stroke(Color.white, lineWidth: 1))
      }
      .buttonStyle(.plain)
      .disabled(selectedClaimIDs.isEmpty)
      .opacity(selectedClaimIDs.isEmpty ? 0.4 : 1)

      Button {
        showingRegenConfirm = true
      } label: {
        Text("Regenerate Credential")
          .font(.system(size: 12, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textSecondary)
      }
      .buttonStyle(.plain)
    }
    .padding(.horizontal, 16)
  }

  // MARK: - Helpers

  private var trustText: String {
    switch card.trustLevel {
    case "green": return "🟢 LEVEL 3 — ZK VERIFIED"
    case "blue": return "🔵 LEVEL 2 — FALLBACK"
    default: return "⚪️ LEVEL 1 — SELF-ATTESTED"
    }
  }

  private func sectionHeader(_ title: String) -> some View {
    Text("[ \(title) ]")
      .font(.system(size: 12, weight: .bold, design: .monospaced))
      .foregroundColor(Color.Theme.textSecondary)
      .padding(.horizontal, 24)
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

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 24) {
          // Selected claims summary
          VStack(spacing: 6) {
            Text(card.title)
              .font(.system(size: 16, weight: .bold))
              .foregroundColor(Color.Theme.textPrimary)
            Text("\(selectedClaims.count) claim(s) selected")
              .font(.system(size: 12, weight: .bold, design: .monospaced))
              .foregroundColor(Color.Theme.terminalGreen)
          }

          // Claim pills
          LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 8)], spacing: 8) {
            ForEach(selectedClaims) { claim in
              Text(claim.claimType)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(Color.Theme.textPrimary)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Color.Theme.searchBg)
                .overlay(Rectangle().stroke(Color.Theme.terminalGreen, lineWidth: 1))
            }
          }
          .padding(.horizontal, 16)

          // QR Code
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
              .foregroundColor(.red)
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
              .foregroundColor(.white)
          }
        }
      }
      .onAppear { generateVP() }
    }
  }

  private func generateVP() {
    let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "")

    // Build credential array: raw proof + selected claim payloads
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
      "proof_type": card.metadataTags.contains("semaphore-zk") ? "semaphore-zk" : "sd-jwt-fallback",
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

