//
//  ShareLinkOptionsView.swift
//  solidarity
//
//  Share link creation interface with usage limits and expiration controls
//

import SwiftUI

struct ShareLinkOptionsView: View {
  let businessCard: BusinessCard
  let sharingLevel: SharingLevel

  @StateObject private var shareLinkManager = ShareLinkManager.shared

  @State private var maxUses = 1
  @State private var expirationHours = 24
  @State private var createdLink: ShareLink?
  @State private var showingCreatedLink = false
  @State private var showingError = false
  @State private var errorMessage = ""

  @Environment(\.dismiss) private var dismiss

  private let maxUsesOptions = [1, 3, 5, 10, 25, 50]
  private let expirationOptions = [1, 6, 12, 24, 48, 72, 168]  // hours

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 24) {
          // Header
          VStack(spacing: 12) {
            Image(systemName: "link.circle")
              .font(.system(size: 60))
              .foregroundColor(Color.Theme.primaryBlue)

            Text("Create Share Link")
              .font(.title2)
              .fontWeight(.bold)

            Text("Generate a secure link that others can use to access your business card")
              .font(.subheadline)
              .foregroundColor(.secondary)
              .multilineTextAlignment(.center)
          }
          .padding()

          // Business card preview
          BusinessCardSummary(
            businessCard: businessCard.filteredCard(for: sharingLevel),
            sharingLevel: sharingLevel
          )

          // Link options
          VStack(spacing: 20) {
            // Max uses selector
            VStack(alignment: .leading, spacing: 12) {
              Text("Maximum Uses")
                .font(.headline)

              Text("How many times can this link be used?")
                .font(.subheadline)
                .foregroundColor(.secondary)

              LazyVGrid(
                columns: [
                  GridItem(.flexible()),
                  GridItem(.flexible()),
                  GridItem(.flexible()),
                ],
                spacing: 8
              ) {
                ForEach(maxUsesOptions, id: \.self) { uses in
                  UsesOptionButton(
                    uses: uses,
                    isSelected: maxUses == uses
                  ) {
                    maxUses = uses
                  }
                }
              }
            }

            // Expiration selector
            VStack(alignment: .leading, spacing: 12) {
              Text("Expiration Time")
                .font(.headline)

              Text("When should this link expire?")
                .font(.subheadline)
                .foregroundColor(.secondary)

              LazyVGrid(
                columns: [
                  GridItem(.flexible()),
                  GridItem(.flexible()),
                ],
                spacing: 8
              ) {
                ForEach(expirationOptions, id: \.self) { hours in
                  ExpirationOptionButton(
                    hours: hours,
                    isSelected: expirationHours == hours
                  ) {
                    expirationHours = hours
                  }
                }
              }
            }
          }
          .padding()
          .background(Color.Theme.cardBg)
          .cornerRadius(12)

          // Security notice
          SecurityNoticeView()

          // Action buttons
          VStack(spacing: 12) {
            Button(action: createShareLink) {
              HStack {
                Image(systemName: "plus.circle.fill")
                Text("Create Share Link")
              }
              .font(.headline)
              .foregroundColor(.white)
              .frame(maxWidth: .infinity)
              .padding()
              .background(Color.Theme.primaryBlue)
              .cornerRadius(12)
            }

            Button("Cancel") {
              dismiss()
            }
            .font(.subheadline)
            .foregroundColor(.secondary)
          }
          .padding(.horizontal)
        }
        .padding()
      }
      .navigationTitle("Share Link")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button("Done") {
            dismiss()
          }
        }
      }
    }
    .sheet(isPresented: $showingCreatedLink) {
      if let link = createdLink {
        CreatedLinkView(shareLink: link)
      }
    }
    .alert("Error", isPresented: $showingError) {
      Button("OK") {}
    } message: {
      Text(errorMessage)
    }
  }

  // MARK: - Private Methods

  private func createShareLink() {
    let result = shareLinkManager.createShareLink(
      for: businessCard,
      sharingLevel: sharingLevel,
      maxUses: maxUses,
      expirationHours: expirationHours
    )

    switch result {
    case .success(let link):
      createdLink = link
      showingCreatedLink = true
    case .failure(let error):
      errorMessage = error.localizedDescription
      showingError = true
    }
  }
}

#Preview {
  ShareLinkOptionsView(
    businessCard: .sample,
    sharingLevel: .professional
  )
}
