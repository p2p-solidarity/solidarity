//
//  OIDCRequestView.swift
//  solidarity
//
//  View for generating and displaying OIDC Authentication Requests via QR Code.
//

import SwiftUI

struct OIDCRequestView: View {
  @State private var qrCode: UIImage?
  @State private var requestURL: URL?
  @State private var errorMessage: String?

  private let oidcService = OIDCService.shared

  var body: some View {
    ScrollView {
      VStack(spacing: 20) {
        if let qrCode = qrCode {
          Image(uiImage: qrCode)
            .resizable()
            .interpolation(.none)
            .scaledToFit()
            .frame(width: 250, height: 250)
            .padding(14)
            .background(
              RoundedRectangle(cornerRadius: 12)
                .fill(Color.white)
            )

          if let url = requestURL {
            Text(url.absoluteString)
              .font(.system(size: 11, design: .monospaced))
              .foregroundColor(Color.Theme.textSecondary)
              .multilineTextAlignment(.center)
              .padding(.horizontal)
              .contextMenu {
                Button(
                  action: {
                    UIPasteboard.general.string = url.absoluteString
                  },
                  label: {
                    Label("Copy URL", systemImage: "doc.on.doc")
                  }
                )
              }
          }

          Text("Scan this QR code to present a credential to Solidarity.")
            .font(.system(size: 13))
            .foregroundColor(Color.Theme.textSecondary)
            .multilineTextAlignment(.center)
            .padding(.horizontal)
        } else {
          VStack(spacing: 8) {
            Image(systemName: "qrcode")
              .font(.system(size: 60, weight: .light))
              .foregroundColor(Color.Theme.textTertiary)
            Text("Generate a request to receive a credential")
              .font(.system(size: 13))
              .foregroundColor(Color.Theme.textSecondary)
              .multilineTextAlignment(.center)
          }
          .frame(width: 250, height: 250)
          .background(
            RoundedRectangle(cornerRadius: 12)
              .fill(Color.Theme.mutedSurface)
          )
        }

        if let errorMessage = errorMessage {
          Text(errorMessage)
            .foregroundColor(Color.Theme.destructive)
            .font(.system(size: 13))
            .multilineTextAlignment(.center)
            .padding(.horizontal)
        }

        Button(action: generateRequest) {
          Label("Generate OIDC Request", systemImage: "qrcode")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(ThemedPrimaryButtonStyle())
        .padding(.horizontal, 16)
      }
      .padding(.vertical, 24)
    }
    .background(Color.Theme.pageBg.ignoresSafeArea())
    .navigationTitle("OIDC Request")
    .navigationBarTitleDisplayMode(.inline)
  }

  private func generateRequest() {
    switch oidcService.generateRequest() {
    case .success(let url):
      self.requestURL = url
      if let image = oidcService.generateQRCode(from: url) {
        self.qrCode = image
        self.errorMessage = nil
      } else {
        self.errorMessage = String(localized: "Failed to generate QR code image.")
      }
    case .failure(let error):
      self.errorMessage = error.localizedDescription
    }
  }
}

#Preview {
  OIDCRequestView()
}
