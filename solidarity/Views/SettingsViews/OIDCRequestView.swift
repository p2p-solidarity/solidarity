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
    VStack(spacing: 20) {
      Text("OpenID Request")
        .font(.system(size: 28, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textPrimary)

      if let qrCode = qrCode {
        Image(uiImage: qrCode)
          .resizable()
          .interpolation(.none)
          .scaledToFit()
          .frame(width: 250, height: 250)
          .padding()
          .background(Color.white)
          .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))

        if let url = requestURL {
          Text(url.absoluteString)
            .font(.system(size: 10, design: .monospaced))
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
          .font(.system(size: 12))
          .foregroundColor(Color.Theme.textSecondary)
          .multilineTextAlignment(.center)
          .padding(.horizontal)
      } else {
        VStack {
          Image(systemName: "qrcode")
            .font(.system(size: 60))
            .foregroundColor(Color.Theme.textSecondary)
          Text("Generate a request to receive a credential")
            .font(.system(size: 12))
            .foregroundColor(Color.Theme.textSecondary)
            .padding(.top, 8)
        }
        .frame(width: 250, height: 250)
        .background(Color.Theme.searchBg)
        .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
      }

      if let errorMessage = errorMessage {
        Text(errorMessage)
          .foregroundColor(Color.Theme.destructive)
          .font(.system(size: 12, design: .monospaced))
      }

      Button(action: generateRequest) {
        Label("Generate OIDC Request", systemImage: "qrcode")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(ThemedPrimaryButtonStyle())
      .padding(.horizontal)

      Spacer()
    }
    .padding()
    .background(Color.Theme.pageBg)
    .navigationTitle("Receive Card")
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
