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
  @State private var copied = false

  private let oidcService = OIDCService.shared

  var body: some View {
    ScrollView {
      VStack(spacing: 24) {
        heroSection

        qrSection

        if let url = requestURL {
          urlSection(url)
        }

        if let errorMessage {
          errorBanner(errorMessage)
        }

        actionSection
      }
      .padding(.vertical, 24)
    }
    .background(Color.Theme.pageBg.ignoresSafeArea())
    .navigationTitle("OIDC Request")
    .navigationBarTitleDisplayMode(.inline)
  }

  // MARK: - Sections

  private var heroSection: some View {
    VStack(spacing: 12) {
      ZStack {
        Circle()
          .fill(Color.Theme.terminalGreen.opacity(0.12))
          .frame(width: 64, height: 64)
        Image(systemName: "qrcode.viewfinder")
          .font(.system(size: 28, weight: .regular))
          .foregroundColor(Color.Theme.terminalGreen)
      }

      VStack(spacing: 6) {
        Text("Receive a Credential")
          .font(.system(size: 17, weight: .semibold))
          .foregroundColor(Color.Theme.textPrimary)

        Text("Generate a one-time request link. The issuer scans your QR to deliver a credential straight to your wallet.")
          .font(.system(size: 13))
          .foregroundColor(Color.Theme.textSecondary)
          .multilineTextAlignment(.center)
          .lineSpacing(2)
          .padding(.horizontal, 24)
      }
    }
    .padding(.top, 8)
  }

  private var qrSection: some View {
    Group {
      if let qrCode {
        Image(uiImage: qrCode)
          .resizable()
          .interpolation(.none)
          .scaledToFit()
          .frame(width: 240, height: 240)
          .padding(16)
          .background(
            RoundedRectangle(cornerRadius: 16)
              .fill(Color.white)
          )
          .overlay(
            RoundedRectangle(cornerRadius: 16)
              .stroke(Color.Theme.divider, lineWidth: 1)
          )
      } else {
        VStack(spacing: 10) {
          Image(systemName: "qrcode")
            .font(.system(size: 56, weight: .light))
            .foregroundColor(Color.Theme.textTertiary)
          Text("No request yet")
            .font(.system(size: 14, weight: .medium))
            .foregroundColor(Color.Theme.textSecondary)
          Text("Tap Generate Request to create a fresh QR.")
            .font(.system(size: 12))
            .foregroundColor(Color.Theme.textTertiary)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16)
        }
        .frame(width: 240, height: 240)
        .background(
          RoundedRectangle(cornerRadius: 16)
            .fill(Color.Theme.mutedSurface)
        )
      }
    }
    .padding(.horizontal, 16)
  }

  private func urlSection(_ url: URL) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      SettingsBlockSectionHeader(title: "Request URL")

      HStack(alignment: .top, spacing: 12) {
        Image(systemName: "link")
          .font(.system(size: 14, weight: .regular))
          .foregroundColor(Color.Theme.textPrimary)
          .frame(width: 20, height: 20)

        Text(url.absoluteString)
          .font(.system(size: 11, design: .monospaced))
          .foregroundColor(Color.Theme.textSecondary)
          .lineLimit(3)
          .truncationMode(.middle)
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)

        Button {
          UIPasteboard.general.string = url.absoluteString
          withAnimation(.spring()) { copied = true }
          DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            withAnimation { copied = false }
          }
        } label: {
          Image(systemName: copied ? "checkmark" : "doc.on.doc")
            .font(.system(size: 14, weight: .semibold))
            .foregroundColor(copied ? Color.Theme.terminalGreen : Color.Theme.textPrimary)
            .frame(width: 28, height: 28)
            .background(
              RoundedRectangle(cornerRadius: 8)
                .fill(Color.Theme.searchBg)
            )
        }
        .buttonStyle(.plain)
      }
      .padding(.horizontal, 14)
      .padding(.vertical, 12)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        RoundedRectangle(cornerRadius: 12)
          .fill(Color.Theme.mutedSurface)
      )
      .padding(.horizontal, 16)
    }
  }

  private func errorBanner(_ message: String) -> some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: "exclamationmark.triangle.fill")
        .font(.system(size: 14))
        .foregroundColor(Color.Theme.destructive)

      Text(message)
        .font(.system(size: 13))
        .foregroundColor(Color.Theme.destructive)
        .multilineTextAlignment(.leading)

      Spacer(minLength: 0)
    }
    .padding(14)
    .background(
      RoundedRectangle(cornerRadius: 12)
        .fill(Color.Theme.destructive.opacity(0.1))
    )
    .padding(.horizontal, 16)
  }

  private var actionSection: some View {
    Button(action: generateRequest) {
      HStack(spacing: 8) {
        Image(systemName: qrCode == nil ? "sparkles" : "arrow.clockwise")
        Text(qrCode == nil ? "Generate Request" : "Regenerate Request")
      }
      .frame(maxWidth: .infinity)
    }
    .buttonStyle(ThemedPrimaryButtonStyle())
    .padding(.horizontal, 16)
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
  NavigationStack { OIDCRequestView() }
}
