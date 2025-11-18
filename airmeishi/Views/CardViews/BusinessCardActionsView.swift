import SwiftUI

struct WalletCardView: View {
    let card: BusinessCard
    var onEdit: () -> Void
    var onAddToWallet: () -> Void

    @State private var isFlipped = false
    @State private var editAttempted = false
    @EnvironmentObject private var theme: ThemeManager

    var body: some View {
        ZStack(alignment: .topTrailing) {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(perCardGradient(card: card))
                .shadow(color: Color.black.opacity(0.45), radius: 24, x: 0, y: 14)
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(theme.cardAccent.opacity(0.35), lineWidth: 1)
                )
                .overlay(alignment: .topLeading) {
                    LinearGradient(
                        colors: [Color.white.opacity(0.45), Color.white.opacity(0.12), Color.clear],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .opacity(0.65)
                }
                .overlay { cardContent }
                .rotation3DEffect(.degrees(isFlipped ? 180 : 0), axis: (x: 0, y: 1, z: 0))
                .animation(.spring(response: 0.5, dampingFraction: 0.85), value: isFlipped)
                .cardGlow(theme.cardAccent, enabled: theme.enableGlow)

            actionButtons
        }
    }

    private var cardContent: some View {
        HStack(alignment: .center, spacing: 14) {
            if let animal = card.animal {
                ImageProvider.animalImage(for: animal)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 84, height: 84)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(Color.black.opacity(0.06), lineWidth: 1)
                    )
                    .padding(.leading, 18)
            } else {
                Spacer().frame(width: 18)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(card.name)
                    .font(.headline.weight(.semibold))
                    .foregroundColor(.black)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)

                if let company = card.company {
                    Text(company)
                        .font(.subheadline)
                        .foregroundColor(.black.opacity(0.75))
                }

                if let title = card.title {
                    Text(title)
                        .font(.footnote)
                        .foregroundColor(.black.opacity(0.65))
                }

                HStack(spacing: 6) {
                    ForEach(card.skills.prefix(3)) { skill in
                        Text(skill.name)
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.white.opacity(0.18))
                            .clipShape(Capsule())
                    }
                }
            }

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var actionButtons: some View {
        HStack(spacing: 10) {
            CategoryTag(text: category(for: card))

            Button(action: editTapped) {
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(.black)
                    .frame(width: 44, height: 44)
                    .background(theme.cardAccent.opacity(0.12))
                    .clipShape(Circle())
            }
            .buttonStyle(PlainButtonStyle())
            .padding(.horizontal, 8)
            .padding(.top, 12)
            .padding(.bottom, 8)
            .contentShape(Rectangle())

            Button(action: addPassTapped) {
                Image(systemName: "wallet.pass")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(.black)
                    .frame(width: 44, height: 44)
                    .background(theme.cardAccent.opacity(0.12))
                    .clipShape(Circle())
            }
            .buttonStyle(PlainButtonStyle())
            .padding(.horizontal, 8)
            .padding(.top, 12)
            .padding(.bottom, 8)
            .contentShape(Rectangle())
        }
        .allowsHitTesting(true)
    }

    private func editTapped() {
        guard !editAttempted else { return }
        editAttempted = true
        triggerImpact(.medium)
        onEdit()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            editAttempted = false
        }
    }

    private func addPassTapped() {
        triggerImpact(.light)
        onAddToWallet()
    }

    private func perCardGradient(card: BusinessCard) -> LinearGradient {
        if let animal = card.animal {
            let colors: [Color]
            switch animal {
            case .dog:
                colors = [Color(hex: 0xFFF8E1), Color(hex: 0xFFD54F)]
            case .horse:
                colors = [Color(hex: 0xE8EAF6), Color(hex: 0x5C6BC0)]
            case .pig:
                colors = [Color(hex: 0xFCE4EC), Color(hex: 0xF06292)]
            case .sheep:
                colors = [Color(hex: 0xE8F5E9), Color(hex: 0x66BB6A)]
            case .dove:
                colors = [Color(hex: 0xE0F7FA), Color(hex: 0x26C6DA)]
            }
            return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
        }

        let hash = card.id.uuidString.hashValue
        let hue = Double(abs(hash % 360)) / 360.0
        let base = Color(hue: hue, saturation: 0.55, brightness: 0.95)
        let light = Color.white
        return LinearGradient(colors: [light, base], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    private func category(for card: BusinessCard) -> String {
        if let company = card.company, !company.isEmpty { return company }
        if let title = card.title, !title.isEmpty { return title }
        return "Card"
    }

    private func triggerImpact(_ style: UIImpactFeedbackGenerator.FeedbackStyle) {
        #if canImport(UIKit)
        UIImpactFeedbackGenerator(style: style).impactOccurred()
        #endif
    }
}

struct CategoryTag: View {
    let text: String
    @EnvironmentObject private var theme: ThemeManager

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .foregroundColor(.white)
            .background(theme.cardAccent.opacity(0.25))
            .clipShape(Capsule())
            .padding(8)
    }
}

struct BusinessCardEmptyStateView: View {
    var onCreateCard: () -> Void
    @EnvironmentObject private var theme: ThemeManager
    
    var body: some View {
        VStack {
            Spacer()
            
            VStack(spacing: 32) {
                ZStack {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [Color.blue.opacity(0.3), Color.purple.opacity(0.2)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 120, height: 120)
                        .blur(radius: 20)

                    Image(systemName: "person.crop.rectangle.stack")
                        .font(.system(size: 64, weight: .light))
                        .foregroundColor(.white.opacity(0.9))
                }
                
                VStack(spacing: 20) {
                    VStack(spacing: 12) {
                        Text("No Business Card")
                            .font(.title.bold())
                            .foregroundColor(.white)

                        Text("Create your first business card to start sharing")
                            .font(.body)
                            .foregroundColor(.white.opacity(0.7))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 40)
                    }
                    
                    Button(action: {
                        let impact = UIImpactFeedbackGenerator(style: .medium)
                        impact.impactOccurred()
                        onCreateCard()
                    }) {
                        HStack(spacing: 12) {
                            Image(systemName: "plus.circle.fill")
                                .font(.system(size: 20, weight: .semibold))
                            Text("Create Card")
                                .font(.headline.weight(.semibold))
                        }
                        .foregroundColor(.white)
                        .frame(maxWidth: 280)
                        .padding(.vertical, 16)
                        .background(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .fill(
                                    LinearGradient(
                                        colors: [theme.cardAccent, theme.cardAccent.opacity(0.8)],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    )
                                )
                                .shadow(color: theme.cardAccent.opacity(0.4), radius: 12, x: 0, y: 6)
                        )
                    }
                    .buttonStyle(PlainButtonStyle())
                }
            }
            
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#Preview {
    WalletCardView(card: .sample, onEdit: {}, onAddToWallet: {})
        .environmentObject(ThemeManager.shared)
        .padding()
        .background(Color.black)
}
