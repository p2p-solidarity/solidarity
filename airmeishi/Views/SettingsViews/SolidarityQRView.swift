import SwiftUI
import UIKit

struct SolidarityQRView: View {
  let businessCard: BusinessCard

  @Environment(\.dismiss) private var dismiss
  @StateObject private var qrCodeManager = QRCodeManager.shared
  @State private var generatedQRImage: UIImage?
  @State private var showingAlert = false
  @State private var alertMessage = ""

  var body: some View {
    NavigationStack {
      VStack(spacing: 18) {
        qrCard
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 16)
      .padding(.top, 16)
      .background(Color.Theme.pageBg.ignoresSafeArea())
      .navigationTitle("Solidarity QR")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button("Done") { dismiss() }
        }
      }
      .onAppear { refreshQRCode() }
      .alert("QR Generation", isPresented: $showingAlert) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(alertMessage)
      }
    }
  }

  private var qrCard: some View {
    VStack(spacing: 12) {
      Text("Solidarity QR")
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

      Text("Use this mode when both users are in Solidarity for direct exchange.")
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

  private func refreshQRCode() {
    let result = qrCodeManager.generateQRCode(for: businessCard, sharingLevel: .professional)
    switch result {
    case .success(let image):
      generatedQRImage = image
    case .failure(let error):
      alertMessage = error.localizedDescription
      showingAlert = true
    }
  }
}
