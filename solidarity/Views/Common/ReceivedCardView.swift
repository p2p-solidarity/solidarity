import SwiftUI

struct ReceivedCardView: View {
  let card: BusinessCard
  @Environment(\.dismiss) private var dismiss
  @Environment(\.colorScheme) private var colorScheme
  @State private var isSakuraAnimating = false
  @State private var showingShoutoutGallery = false
  @State private var isSaved = false
  @State private var showingSaveConfirmation = false
  @StateObject private var contactRepository = ContactRepository.shared
  @ObservedObject private var identityCoordinator = IdentityCoordinator.shared

  private var verificationStatus: VerificationStatus {
    identityCoordinator.verificationStatus(for: card.id) ?? .unverified
  }

  var body: some View {
    NavigationStack {
      ZStack {
        Color.Theme.pageBg.ignoresSafeArea()

        // Decorative background
        DecorativeBlobs()
          .offset(x: 120, y: -60)

        ScrollView {
          VStack(spacing: 24) {
            // Sakura success indicator
            VStack(spacing: 16) {
              ZStack {
                // Sakura ring
                Circle()
                  .stroke(
                    LinearGradient(
                      colors: [Color.Theme.accentRose.opacity(0.8), Color.Theme.dustyMauve.opacity(0.6), Color.Theme.accentRose.opacity(0.8)],
                      startPoint: .topLeading,
                      endPoint: .bottomTrailing
                    ),
                    lineWidth: 4
                  )
                  .frame(width: 100, height: 100)
                  .scaleEffect(isSakuraAnimating ? 1.1 : 1.0)
                  .animation(
                    .easeInOut(duration: 0.8).repeatForever(autoreverses: true),
                    value: isSakuraAnimating
                  )

                SakuraIconView(size: 40, color: Color.Theme.accentRose, isAnimating: isSakuraAnimating)
              }

              VStack(spacing: 8) {
                Text("Sakura Card Received! 🌸")
                  .font(.title)
                  .fontWeight(.bold)
                  .foregroundColor(Color.Theme.textPrimary)

                Text(
                  isSaved
                    ? "Business card has been saved to your contacts" : "Tap save to add this card to your contacts"
                )
                .font(.body)
                .foregroundColor(Color.Theme.textSecondary)
                .multilineTextAlignment(.center)
              }
            }
            .padding()

            // Card preview with sakura theme
            VStack(alignment: .leading, spacing: 16) {
              HStack {
                Text("Card Details")
                  .font(.headline)
                  .foregroundColor(Color.Theme.textPrimary)

                Spacer()

                SakuraIconView(size: 28, color: Color.Theme.accentRose, isAnimating: isSakuraAnimating)
              }

              VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                  receivedAvatar
                    .frame(width: 56, height: 56)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(Color.Theme.accentRose.opacity(0.4), lineWidth: 1))

                  Text(card.name)
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(Color.Theme.textPrimary)
                }

                if let title = card.title {
                  Text(title)
                    .font(.headline)
                    .foregroundColor(Color.Theme.accentRose)
                }

                if let company = card.company {
                  Text(company)
                    .font(.subheadline)
                    .foregroundColor(Color.Theme.textSecondary)
                }

                HStack(spacing: 6) {
                  Image(systemName: verificationStatus.systemImageName)
                    .foregroundColor(color(for: verificationStatus))
                  Text(verificationStatus.displayName)
                    .font(.caption)
                    .foregroundColor(Color.Theme.textSecondary)
                }

                if let email = card.email {
                  HStack {
                    Image(systemName: "envelope.fill")
                      .foregroundColor(Color.Theme.primaryBlue)
                    Text(email)
                      .font(.subheadline)
                      .foregroundColor(Color.Theme.primaryBlue)
                  }
                }

                if let phone = card.phone {
                  HStack {
                    Image(systemName: "phone.fill")
                      .foregroundColor(.green)
                    Text(phone)
                      .font(.subheadline)
                      .foregroundColor(.green)
                  }
                }
              }
            }
            .padding()
            .background(
              RoundedRectangle(cornerRadius: 16)
                .fill(Color.Theme.cardSurface(for: colorScheme))
                .overlay(
                  RoundedRectangle(cornerRadius: 16)
                    .stroke(Color.Theme.accentRose.opacity(0.3), lineWidth: 1)
                )
            )

            // Sakura action buttons
            VStack(spacing: 12) {
              if !isSaved {
                Button(action: saveCard) {
                  HStack(spacing: 12) {
                    Image(systemName: "square.and.arrow.down")
                      .font(.title2)
                      .scaleEffect(isSakuraAnimating ? 1.3 : 1.0)
                      .animation(
                        .easeInOut(duration: 0.3).repeatForever(autoreverses: true),
                        value: isSakuraAnimating
                      )

                    Text("Save to Contacts")
                      .font(.headline)
                      .fontWeight(.bold)
                  }
                }
                .buttonStyle(ThemedPrimaryButtonStyle())
              } else {
                Button(action: { showingShoutoutGallery = true }) {
                  HStack(spacing: 12) {
                    SakuraIconView(size: 24, color: .white, isAnimating: isSakuraAnimating)

                    Text("View in Sakura")
                      .font(.headline)
                      .fontWeight(.bold)
                  }
                }
                .buttonStyle(ThemedPrimaryButtonStyle())
              }

              Button(action: { dismiss() }) {
                HStack(spacing: 8) {
                  Image(systemName: "checkmark.circle")
                    .font(.title3)
                  Text("Continue")
                    .font(.headline)
                    .fontWeight(.medium)
                }
              }
              .buttonStyle(ThemedSecondaryButtonStyle())
            }

            Spacer()
          }
          .padding()
        }
      }
      .navigationTitle("Sakura Received")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button("Done") {
            dismiss()
          }
        }
      }
      .onAppear {
        isSakuraAnimating = true
      }
      .sheet(isPresented: $showingShoutoutGallery) {
        ShoutoutView()
      }
      .alert("Card Saved!", isPresented: $showingSaveConfirmation) {
        Button("OK") {}
      } message: {
        Text("The business card has been successfully saved to your contacts.")
      }
    }
  }

  @ViewBuilder
  private var receivedAvatar: some View {
    if let imageData = card.profileImage, let uiImage = UIImage(data: imageData) {
      Image(uiImage: uiImage)
        .resizable()
        .scaledToFill()
    } else if let animal = card.animal {
      ImageProvider.animalImage(for: animal)
        .resizable()
        .scaledToFit()
        .padding(4)
        .background(Color.Theme.searchBg)
    } else {
      ZStack {
        Rectangle().fill(Color.Theme.searchBg)
        Text(String(card.name.prefix(1)).uppercased())
          .font(.system(size: 22, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textPrimary)
      }
    }
  }

  private func saveCard() {
    let contact = Contact(
      businessCard: card,
      source: .proximity,
      verificationStatus: .unverified
    )

    let result = contactRepository.addContact(contact)

    switch result {
    case .success:
      isSaved = true
      showingSaveConfirmation = true
    case .failure(let error):
      print("Failed to save contact: \(error.localizedDescription)")
    // You could show an error alert here if needed
    }
  }

  private func color(for status: VerificationStatus) -> Color {
    switch status {
    case .verified: return .green
    case .pending: return .orange
    case .unverified: return .gray
    case .failed: return .red
    }
  }
}
