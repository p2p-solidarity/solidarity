//
//  WalletPassGenerationView.swift
//  solidarity
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
    NavigationStack {
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
        errorMessage = String(localized: "Certificate verification failed")
        errorDetail =
          String(localized: "The pass signature could not be verified. Please check the server-side certificate configuration.")
      } else if errorDesc.contains("Server") || errorDesc.contains("network") {
        errorMessage = String(localized: "Network error")
        errorDetail = String(localized: "Unable to connect to signing service. Please check your internet connection.")
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
        errorMessage = String(localized: "Pass verification failed")
        errorDetail =
          String(localized: "Apple Wallet could not verify this pass. The certificate may not match the Pass Type ID or Team ID in the pass data.")
      } else if errorDesc.contains("already exists") {
        errorMessage = String(localized: "Pass already in Wallet")
        errorDetail = String(localized: "This business card pass has already been added to your Apple Wallet.")
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

#Preview {
  WalletPassGenerationView(
    businessCard: .sample,
    sharingLevel: .professional
  )
}
