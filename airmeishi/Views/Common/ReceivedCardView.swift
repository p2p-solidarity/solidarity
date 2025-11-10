import SwiftUI

struct ReceivedCardView: View {
    let card: BusinessCard
    @Environment(\.dismiss) private var dismiss
    @State private var isLighteningAnimating = false
    @State private var showingShoutoutGallery = false
    @State private var isSaved = false
    @State private var showingSaveConfirmation = false
    @StateObject private var contactRepository = ContactRepository.shared
    @ObservedObject private var identityCoordinator = IdentityCoordinator.shared
    
    private var verificationStatus: VerificationStatus {
        identityCoordinator.verificationStatus(for: card.id) ?? .unverified
    }
    
    var body: some View {
        NavigationView {
            ZStack {
                // Dark gradient background with lightning effect
                LinearGradient(
                    colors: [
                        Color.black,
                        Color.green.opacity(0.1),
                        Color.blue.opacity(0.05),
                        Color.black
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()
                
                ScrollView {
                    VStack(spacing: 24) {
                        // Lightening success indicator
                        VStack(spacing: 16) {
                            ZStack {
                                // Lightening ring
                                Circle()
                                    .stroke(
                                        LinearGradient(
                                            colors: [.green, .yellow, .green],
                                            startPoint: .topLeading,
                                            endPoint: .bottomTrailing
                                        ),
                                        lineWidth: 4
                                    )
                                    .frame(width: 100, height: 100)
                                    .scaleEffect(isLighteningAnimating ? 1.1 : 1.0)
                                    .animation(
                                        .easeInOut(duration: 0.8).repeatForever(autoreverses: true),
                                        value: isLighteningAnimating
                                    )
                                
                                Image(systemName: "bolt.fill")
                                    .font(.system(size: 40))
                                    .foregroundColor(.yellow)
                                    .scaleEffect(isLighteningAnimating ? 1.2 : 1.0)
                                    .animation(
                                        .easeInOut(duration: 0.5).repeatForever(autoreverses: true),
                                        value: isLighteningAnimating
                                    )
                            }
                            
                            VStack(spacing: 8) {
                                Text("Lightening Card Received! ⚡")
                                    .font(.title)
                                    .fontWeight(.bold)
                                    .foregroundColor(.white)
                                
                                Text(isSaved ? "Business card has been saved to your contacts" : "Tap save to add this card to your contacts")
                                    .font(.body)
                                    .foregroundColor(.gray)
                                    .multilineTextAlignment(.center)
                            }
                        }
                        .padding()
                        
                        // Card preview with lightning theme
                        VStack(alignment: .leading, spacing: 16) {
                            HStack {
                                Text("Card Details")
                                    .font(.headline)
                                    .foregroundColor(.white)
                                
                                Spacer()
                                
                                Image(systemName: "bolt.circle.fill")
                                    .foregroundColor(.yellow)
                                    .font(.title2)
                                    .scaleEffect(isLighteningAnimating ? 1.2 : 1.0)
                                    .animation(
                                        .easeInOut(duration: 0.5).repeatForever(autoreverses: true),
                                        value: isLighteningAnimating
                                    )
                            }
                            
                            VStack(alignment: .leading, spacing: 12) {
                                Text(card.name)
                                    .font(.title2)
                                    .fontWeight(.bold)
                                    .foregroundColor(.white)
                                
                                if let title = card.title {
                                    Text(title)
                                        .font(.headline)
                                        .foregroundColor(.yellow)
                                }
                                
                                if let company = card.company {
                                    Text(company)
                                        .font(.subheadline)
                                        .foregroundColor(.gray)
                                }

                                HStack(spacing: 6) {
                                    Image(systemName: verificationStatus.systemImageName)
                                        .foregroundColor(color(for: verificationStatus))
                                    Text(verificationStatus.displayName)
                                        .font(.caption)
                                        .foregroundColor(.gray)
                                }
                                
                                if let email = card.email {
                                    HStack {
                                        Image(systemName: "envelope.fill")
                                            .foregroundColor(.blue)
                                        Text(email)
                                            .font(.subheadline)
                                            .foregroundColor(.blue)
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
                                .fill(Color.white.opacity(0.05))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 16)
                                        .stroke(Color.yellow.opacity(0.3), lineWidth: 1)
                                )
                        )
                        
                        // Lightening action buttons
                        VStack(spacing: 12) {
                            if !isSaved {
                                Button(action: saveCard) {
                                    HStack(spacing: 12) {
                                        Image(systemName: "square.and.arrow.down")
                                            .font(.title2)
                                            .scaleEffect(isLighteningAnimating ? 1.3 : 1.0)
                                            .animation(
                                                .easeInOut(duration: 0.3).repeatForever(autoreverses: true),
                                                value: isLighteningAnimating
                                            )
                                        
                                        Text("Save to Contacts")
                                            .font(.headline)
                                            .fontWeight(.bold)
                                    }
                                    .foregroundColor(.white)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 16)
                                    .background(
                                        RoundedRectangle(cornerRadius: 16)
                                            .fill(
                                                LinearGradient(
                                                    colors: [.blue, .purple, .blue],
                                                    startPoint: .leading,
                                                    endPoint: .trailing
                                                )
                                            )
                                            .shadow(color: .blue.opacity(0.5), radius: 10, x: 0, y: 0)
                                    )
                                }
                            } else {
                                Button(action: { showingShoutoutGallery = true }) {
                                    HStack(spacing: 12) {
                                        Image(systemName: "bolt.fill")
                                            .font(.title2)
                                            .scaleEffect(isLighteningAnimating ? 1.3 : 1.0)
                                            .animation(
                                                .easeInOut(duration: 0.3).repeatForever(autoreverses: true),
                                                value: isLighteningAnimating
                                            )
                                        
                                        Text("View in Lightening Gallery")
                                            .font(.headline)
                                            .fontWeight(.bold)
                                    }
                                    .foregroundColor(.white)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 16)
                                    .background(
                                        RoundedRectangle(cornerRadius: 16)
                                            .fill(
                                                LinearGradient(
                                                    colors: [.yellow, .orange, .red],
                                                    startPoint: .leading,
                                                    endPoint: .trailing
                                                )
                                            )
                                            .shadow(color: .yellow.opacity(0.5), radius: 10, x: 0, y: 0)
                                    )
                                }
                            }
                            
                            Button(action: { dismiss() }) {
                                HStack(spacing: 8) {
                                    Image(systemName: "checkmark.circle")
                                        .font(.title3)
                                    Text("Continue")
                                        .font(.headline)
                                        .fontWeight(.medium)
                                }
                                .foregroundColor(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(
                                    RoundedRectangle(cornerRadius: 12)
                                        .fill(Color.white.opacity(0.1))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 12)
                                                .stroke(Color.white.opacity(0.2), lineWidth: 1)
                                        )
                                )
                            }
                        }
                        
                        Spacer()
                    }
                    .padding()
                }
            }
            .navigationTitle("Lightening Received")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .onAppear {
                isLighteningAnimating = true
            }
            .sheet(isPresented: $showingShoutoutGallery) {
                ShoutoutView()
            }
            .alert("Card Saved!", isPresented: $showingSaveConfirmation) {
                Button("OK") { }
            } message: {
                Text("The business card has been successfully saved to your contacts.")
            }
        }
        .preferredColorScheme(.dark)
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
