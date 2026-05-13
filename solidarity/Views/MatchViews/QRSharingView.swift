import SwiftUI
import UIKit

struct QRSharingView: View {
  let businessCard: BusinessCard

  @Environment(\.dismiss) private var dismiss
  @StateObject private var qrCodeManager = QRCodeManager.shared

  @State private var generatedQRImage: UIImage?
  @State private var countdownSeconds = 45
  @State private var showingShareSheet = false
  @State private var showingAlert = false
  @State private var alertMessage = ""

  private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

  var body: some View {
    NavigationStack {
      VStack(spacing: 18) {
        qrCard
        countdownBadge
        controls
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 16)
      .padding(.top, 16)
      .background(Color.Theme.pageBg.ignoresSafeArea())
      .navigationTitle("My QR")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button("Done") { dismiss() }
        }
      }
      .onAppear {
        refreshQRCode()
      }
      .onReceive(timer) { _ in
        guard generatedQRImage != nil else { return }
        if countdownSeconds > 0 {
          countdownSeconds -= 1
          return
        }
        countdownSeconds = 45
        refreshQRCode()
      }
      .sheet(isPresented: $showingShareSheet) {
        if let generatedQRImage {
          ShareSheet(activityItems: [generatedQRImage])
        }
      }
      .alert("QR Generation", isPresented: $showingAlert) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(alertMessage)
      }
    }
  }

  private var qrCard: some View {
    VStack(spacing: 12) {
      Text("Universal Verification QR")
        .font(.subheadline.weight(.semibold))
        .foregroundColor(Color.Theme.textPrimary)

      Group {
        if let generatedQRImage {
          Image(uiImage: generatedQRImage)
            .resizable()
            .interpolation(.none)
            .scaledToFit()
        } else {
          ProgressView()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      }
      .frame(maxWidth: .infinity)
      .aspectRatio(1, contentMode: .fit)
      .padding(12)
      .background(Color.white)
      .cornerRadius(12)

      Text("Verifier-compatible OID4VP style request.")
        .font(.caption)
        .foregroundColor(Color.Theme.textSecondary)
        .multilineTextAlignment(.center)
        .padding(.horizontal, 8)
    }
    .padding(12)
    .background(
      RoundedRectangle(cornerRadius: 12, style: .continuous)
        .fill(Color.Theme.cardBg)
        .overlay(
          RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(Color.Theme.divider, lineWidth: 0.5)
        )
    )
  }

  private var countdownBadge: some View {
    HStack(spacing: 8) {
      Image(systemName: "clock")
      Text("Refresh in \(countdownSeconds)s")
    }
    .font(.caption.weight(.semibold))
    .foregroundColor(Color.Theme.textSecondary)
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
    .background(Capsule().fill(Color.Theme.searchBg))
  }

  private var controls: some View {
    VStack(spacing: 10) {
      Button {
        refreshQRCode()
      } label: {
        Label("Refresh QR", systemImage: "arrow.clockwise")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(ThemedSecondaryButtonStyle())

      Button {
        guard generatedQRImage != nil else { return }
        showingShareSheet = true
      } label: {
        Label("Share QR", systemImage: "square.and.arrow.up")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(ThemedPrimaryButtonStyle())
      .disabled(generatedQRImage == nil)
    }
  }

  private func refreshQRCode() {
    // Build a spec-compliant OID4VP authorization request via OIDCService.
    // Earlier versions hand-rolled `openid4vp://present?claim=…&nonce=…`,
    // which omitted `client_id` / `state` / `response_uri` — the holder's
    // parser (OIDCService.parseRequest) rejected it as
    // "Missing or empty client_id" and the present-proof button locked into
    // "Request invalid". The shared generator emits all required params
    // (client_id = our DID, response_type=vp_token, response_mode,
    // response_uri, nonce, state, presentation_definition).
    switch OIDCService.shared.generateRequest() {
    case .failure(let error):
      generatedQRImage = nil
      alertMessage = error.localizedDescription
      showingAlert = true
      return
    case .success(let url):
      switch qrCodeManager.generateQRCode(from: url.absoluteString) {
      case .success(let image):
        generatedQRImage = image
      case .failure(let error):
        alertMessage = error.localizedDescription
        showingAlert = true
      }
    }
  }
}

struct ShareSheet: UIViewControllerRepresentable {
  let activityItems: [Any]

  func makeUIViewController(context: Context) -> UIActivityViewController {
    UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
  }

  func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
