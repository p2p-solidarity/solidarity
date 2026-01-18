//
//  WalletPassGenerationView.swift
//  airmeishi
//
//  Apple Wallet pass generation interface with PassKit integration
//

import PassKit
import SwiftUI
import UIKit

/// Apple Wallet pass generation and management view
struct WalletPassGenerationView: View {
  let businessCard: BusinessCard
  let sharingLevel: SharingLevel

  @StateObject private var passKitManager = PassKitManager.shared
  @State private var showingAddToWallet = false
  @State private var generatedPassData: Data?
  @State private var generatedPKPass: PKPass?
  @State private var showingError = false
  @State private var errorMessage = ""
  @State private var errorDetail = ""
  @State private var importString: String = ""
  @State private var showCopiedFeedback = false

  @Environment(\.dismiss) private var dismiss
  @Environment(\.horizontalSizeClass) private var horizontalSizeClass

  private var isIPad: Bool {
    horizontalSizeClass == .regular
  }

  var body: some View {
    NavigationView {
      ScrollView {
        VStack(spacing: 24) {
          // Header
          VStack(spacing: 12) {
            Image(systemName: "wallet.pass")
              .font(.system(size: isIPad ? 72 : 60))
              .foregroundColor(.blue)
              .padding(.top, isIPad ? 20 : 0)

            Text("Apple Wallet Pass")
              .font(isIPad ? .title : .title2)
              .fontWeight(.bold)

            Text("Create a pass for Apple Wallet that contains your business card information")
              .font(isIPad ? .body : .subheadline)
              .foregroundColor(.secondary)
              .multilineTextAlignment(.center)
              .padding(.horizontal, isIPad ? 40 : 20)
          }
          .padding()

          // Pass preview
          PassPreviewView(
            businessCard: businessCard.filteredCard(for: sharingLevel),
            sharingLevel: sharingLevel
          )

          // Generation status
          if passKitManager.isGeneratingPass {
            VStack(spacing: 12) {
              ProgressView()
                .progressViewStyle(CircularProgressViewStyle())

              Text("Generating pass...")
                .font(.subheadline)
                .foregroundColor(.secondary)
            }
            .padding()
          }

          // Import string (name + job) for external apps
          if !importString.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
              VStack(alignment: .leading, spacing: 4) {
                Text("Import String")
                  .font(.subheadline)
                  .fontWeight(.semibold)
                Text("Deep link for importing contact data")
                  .font(.caption)
                  .foregroundColor(.secondary)
              }

              Text(importString)
                .font(.caption.monospaced())
                .textSelection(.enabled)
                .lineLimit(3)
                .multilineTextAlignment(.leading)
                .padding(8)
                .background(Color(.systemBackground))
                .cornerRadius(6)

              Button(action: copyImportString) {
                HStack {
                  Image(systemName: "doc.on.doc")
                  Text("Copy Import String")
                }
                .font(.subheadline)
                .foregroundColor(.primary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(Color(.systemGray5))
                .cornerRadius(8)
              }
            }
            .padding()
            .background(Color(.systemGray6))
            .cornerRadius(12)
            .padding(.horizontal)
          }

          // Action buttons
          VStack(spacing: 12) {
            if generatedPassData != nil {
              Button(action: addToWallet) {
                HStack {
                  Image(systemName: "plus.circle.fill")
                  Text("Add to Apple Wallet")
                }
                .font(.headline)
                .foregroundColor(.primary)
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color(.systemGray5))
                .cornerRadius(12)
              }
            } else {
              Button(action: generatePass) {
                HStack {
                  Image(systemName: "doc.badge.plus")
                  Text("Generate Pass")
                }
                .font(.headline)
                .foregroundColor(.primary)
                .frame(maxWidth: .infinity)
                .padding()
                .background(passKitManager.isGeneratingPass ? Color(.systemGray6) : Color(.systemGray5))
                .cornerRadius(12)
              }
              .disabled(passKitManager.isGeneratingPass)
            }

            Button("Cancel") {
              dismiss()
            }
            .font(.subheadline)
            .foregroundColor(.secondary)
          }
          .padding(.horizontal)

          // Information section
          PassInformationView()
        }
        .padding(isIPad ? 32 : 16)
        .frame(maxWidth: isIPad ? 700 : .infinity)
        .frame(maxWidth: .infinity)
      }
      .navigationTitle("Wallet Pass")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button("Done") {
            dismiss()
          }
        }
      }
    }
    .navigationViewStyle(.stack)
    .alert("Unable to Create Pass", isPresented: $showingError) {
      Button("OK") {
        errorMessage = ""
        errorDetail = ""
      }
    } message: {
      VStack(alignment: .leading, spacing: 8) {
        Text(errorMessage)
        if !errorDetail.isEmpty {
          Text(errorDetail)
            .font(.caption)
        }
      }
    }
    .overlay(
      Group {
        if showCopiedFeedback {
          VStack {
            Spacer()
            HStack {
              Image(systemName: "checkmark.circle.fill")
              Text("Copied to clipboard")
            }
            .font(.subheadline)
            .foregroundStyle(.white)
            .padding()
            .background(Color.black.opacity(0.8))
            .cornerRadius(10)
            .padding(.bottom, 50)
          }
          .transition(.move(edge: .bottom).combined(with: .opacity))
          .animation(.easeInOut, value: showCopiedFeedback)
        }
      }
    )
    .sheet(isPresented: $showingAddToWallet) {
      if let pass = generatedPKPass {
        AddPassesControllerView(pass: pass)
      }
    }
    .onAppear {
      // Precompute import string so users can copy even before generating pass
      importString = passKitManager.generateImportString(for: businessCard, sharingLevel: sharingLevel)
    }
  }

  // MARK: - Private Methods

  private func generatePass() {
    // Always compute import string alongside pass generation
    importString = passKitManager.generateImportString(for: businessCard, sharingLevel: sharingLevel)
    let result = passKitManager.generatePass(
      for: businessCard,
      sharingLevel: sharingLevel
    )

    switch result {
    case .success(let passData):
      generatedPassData = passData
    case .failure(let error):
      // Parse error for better UX
      let errorDesc = error.localizedDescription
      if errorDesc.contains("certificate") || errorDesc.contains("trust chain") {
        errorMessage = "Certificate verification failed"
        errorDetail =
          "The pass signature could not be verified. Please check the server-side certificate configuration."
      } else if errorDesc.contains("Server") || errorDesc.contains("network") {
        errorMessage = "Network error"
        errorDetail = "Unable to connect to signing service. Please check your internet connection."
      } else {
        errorMessage = errorDesc
        errorDetail = ""
      }
      showingError = true
    }
  }

  private func addToWallet() {
    guard let passData = generatedPassData else { return }

    let result = passKitManager.addPassToWallet(passData)

    switch result {
    case .success:
      generatedPKPass = passKitManager.lastGeneratedPass
      showingAddToWallet = generatedPKPass != nil
    case .failure(let error):
      // Parse error for better UX
      let errorDesc = error.localizedDescription
      if errorDesc.contains("certificate") || errorDesc.contains("trust chain")
        || errorDesc.contains("passTypeIdentifier") || errorDesc.contains("teamIdentifier")
      {
        errorMessage = "Pass verification failed"
        errorDetail =
          "Apple Wallet could not verify this pass. The certificate may not match the Pass Type ID or Team ID in the pass data."
      } else if errorDesc.contains("already exists") {
        errorMessage = "Pass already in Wallet"
        errorDetail = "This business card pass has already been added to your Apple Wallet."
      } else {
        errorMessage = errorDesc
        errorDetail = ""
      }
      showingError = true
    }
  }

  private func copyImportString() {
    UIPasteboard.general.string = importString

    // Show feedback
    showCopiedFeedback = true

    // Hide after 2 seconds
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
      showCopiedFeedback = false
    }
  }
}

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

/// Presents the native PKAddPassesViewController when a valid PKPass is available
struct AddPassesControllerView: UIViewControllerRepresentable {
  let pass: PKPass

  func makeUIViewController(context: Context) -> PKAddPassesViewController {
    // NOTE: Requires a properly signed .pkpass. Current generator returns placeholder data.
    // TODO: Implement signed .pkpass bundle (manifest.json + signature + images) and feed that here.
    return PKAddPassesViewController(pass: pass) ?? PKAddPassesViewController()
  }

  func updateUIViewController(_ uiViewController: PKAddPassesViewController, context: Context) {}
}

#Preview {
  WalletPassGenerationView(
    businessCard: BusinessCard(
      name: "John Doe",
      title: "Software Engineer",
      company: "Tech Corp",
      email: "john@techcorp.com",
      phone: "+1 (555) 123-4567"
    ),
    sharingLevel: .professional
  )
}
