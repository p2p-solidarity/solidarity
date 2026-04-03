//
//  WalletPassGenerationComponents.swift
//  solidarity
//
//  Subviews for Apple Wallet pass generation
//

import PassKit
import SwiftUI
import UIKit

// MARK: - Pass Preview

struct PassPreviewView: View {
  let businessCard: BusinessCard
  let sharingLevel: SharingLevel

  var body: some View {
    VStack(spacing: 0) {
      // Pass header
      HStack {
        VStack(alignment: .leading, spacing: 4) {
          Text("Solid(ar)ity")
            .font(.caption)
            .fontWeight(.medium)
            .foregroundStyle(.white)

          Text("Business Card")
            .font(.caption2)
            .foregroundStyle(.white.opacity(0.9))
        }

        Spacer()

        Image(systemName: "person.crop.circle")
          .font(.title2)
          .foregroundStyle(.white)
      }
      .padding()
      .background(
        LinearGradient(
          colors: [Color.blue, Color.blue.opacity(0.8)],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )
      )

      // Pass content
      VStack(alignment: .leading, spacing: 12) {
        // Primary field
        VStack(alignment: .leading, spacing: 4) {
          Text("NAME")
            .font(.caption)
            .fontWeight(.medium)
            .foregroundColor(.secondary)

          Text(businessCard.name)
            .font(.title3)
            .fontWeight(.bold)
        }

        // Secondary fields
        HStack {
          if let title = businessCard.title {
            VStack(alignment: .leading, spacing: 4) {
              Text("TITLE")
                .font(.caption)
                .fontWeight(.medium)
                .foregroundColor(.secondary)

              Text(title)
                .font(.subheadline)
            }
          }

          Spacer()

          if let company = businessCard.company {
            VStack(alignment: .trailing, spacing: 4) {
              Text("COMPANY")
                .font(.caption)
                .fontWeight(.medium)
                .foregroundColor(.secondary)

              Text(company)
                .font(.subheadline)
            }
          }
        }

        // Auxiliary fields
        HStack {
          if let email = businessCard.email {
            VStack(alignment: .leading, spacing: 4) {
              Text("EMAIL")
                .font(.caption)
                .fontWeight(.medium)
                .foregroundColor(.secondary)

              Text(email)
                .font(.subheadline)
                .foregroundColor(.blue)
            }
          }

          Spacer()

          if let phone = businessCard.phone {
            VStack(alignment: .trailing, spacing: 4) {
              Text("PHONE")
                .font(.caption)
                .fontWeight(.medium)
                .foregroundColor(.secondary)

              Text(phone)
                .font(.subheadline)
                .foregroundColor(.blue)
            }
          }
        }

        // QR code placeholder
        HStack {
          Spacer()

          VStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 8)
              .fill(Color.black)
              .frame(width: 80, height: 80)
              .overlay(
                Image(systemName: "qrcode")
                  .font(.title)
                  .foregroundStyle(.white)
              )

            Text("QR Code")
              .font(.caption)
              .foregroundColor(.secondary)
          }

          Spacer()
        }
      }
      .padding()
      .background(Color(.systemBackground))
    }
    .cornerRadius(12)
    .shadow(radius: 8)
    .padding(.horizontal)
  }
}

// MARK: - Pass Information

struct PassInformationView: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("About Apple Wallet Passes")
        .font(.headline)

      VStack(alignment: .leading, spacing: 12) {
        InfoRow(
          icon: "checkmark.circle",
          title: "Always Available",
          description: "Access your business card even when offline"
        )

        InfoRow(
          icon: "lock.shield",
          title: "Secure Sharing",
          description: "QR code contains encrypted information"
        )

        InfoRow(
          icon: "arrow.clockwise",
          title: "Auto Updates",
          description: "Pass updates automatically when you change your information"
        )

        InfoRow(
          icon: "person.2",
          title: "Easy Sharing",
          description: "Recipients can scan your pass to get your contact info"
        )
      }
    }
    .padding()
    .background(Color(.systemGray6))
    .cornerRadius(12)
  }
}

struct InfoRow: View {
  let icon: String
  let title: String
  let description: String

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: icon)
        .font(.title3)
        .foregroundColor(.green)
        .frame(width: 24)

      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.subheadline)
          .fontWeight(.medium)

        Text(description)
          .font(.caption)
          .foregroundColor(.secondary)
      }
    }
  }
}

// MARK: - System Add Passes Controller

struct AddPassesControllerView: UIViewControllerRepresentable {
  let pass: PKPass

  func makeUIViewController(context: Context) -> PKAddPassesViewController {
    // NOTE: Requires a properly signed .pkpass. Current generator returns placeholder data.
    // TODO: Implement signed .pkpass bundle (manifest.json + signature + images) and feed that here.
    return PKAddPassesViewController(pass: pass) ?? PKAddPassesViewController()
  }

  func updateUIViewController(_ uiViewController: PKAddPassesViewController, context: Context) {}
}
