//
//  BusinessCardListView.swift
//  airmeishi
//
//  Main view for displaying and managing business cards
//

import SwiftUI
import UIKit
import PassKit

struct BusinessCardListView: View {
    @EnvironmentObject private var proximityManager: ProximityManager
    @EnvironmentObject private var theme: ThemeManager
    @StateObject private var cardManager = CardManager.shared
    @State private var featuredCard: BusinessCard?
    @State private var cardToEdit: BusinessCard?
    @State private var isFeatured = false
    @State private var showingAddPass = false
    @State private var pendingPass: PKPass?
    @State private var pendingPassCard: BusinessCard?
    @State private var alertMessage: String?
    @State private var showingPrivacySettings = false
    @State private var showingCreateCard = false
    @State private var showingAppearanceSettings = false
    @State private var showingBackupSettings = false
    @State private var showingGroupManagement = false
    
    var body: some View {
        NavigationView {
            ZStack {
                Color.black.ignoresSafeArea()
                if cardManager.isLoading {
                    ProgressView("Loading cards...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if cardManager.businessCards.isEmpty {
                    makeEmptyStateView()
                } else {
                    makeSingleCardView()
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: {
                        if let card = cardManager.businessCards.first {
                            beginEdit(card)
                        } else {
                            showingCreateCard = true
                        }
                    }) {
                        Image(systemName: "person.crop.rectangle")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundColor(.white)
                    }
                }
            }
            .sheet(item: $cardToEdit) { card in
                BusinessCardFormView(businessCard: card, forceCreate: false) { saved in
                    featuredCard = saved
                    cardToEdit = nil
                }
            }
            .sheet(isPresented: $showingAppearanceSettings) {
                NavigationView { AppearanceSettingsView() }
                    .environmentObject(theme)
            }
            .sheet(isPresented: $showingBackupSettings) {
                NavigationView { BackupSettingsView() }
            }
            .sheet(isPresented: $showingGroupManagement) {
                GroupManagementView()
            }
            .sheet(isPresented: $showingPrivacySettings) {
                if let card = cardManager.businessCards.first {
                    let cardId = card.id
                    NavigationView {
                        PrivacySettingsView(sharingPreferences: Binding(
                            get: {
                                if let currentCard = cardManager.businessCards.first(where: { $0.id == cardId }) {
                                    return currentCard.sharingPreferences
                                }
                                return card.sharingPreferences
                            },
                            set: { newPreferences in
                                if var updatedCard = cardManager.businessCards.first(where: { $0.id == cardId }) {
                                    updatedCard.sharingPreferences = newPreferences
                                    _ = cardManager.updateCard(updatedCard)
                                }
                            }
                        ))
                    }
                }
            }
            .sheet(isPresented: $showingCreateCard) {
                BusinessCardFormView(forceCreate: true) { saved in
                    showingCreateCard = false
                }
            }
            .sheet(isPresented: $showingAddPass) {
                ZStack {
                    Color.black.ignoresSafeArea()

                    if let pass = pendingPass {
                        AddPassesControllerView(pass: pass)
                    } else {
                        VStack(spacing: 20) {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                .scaleEffect(1.5)

                            Text("Preparing Wallet Pass...")
                                .font(.subheadline)
                                .foregroundColor(.white.opacity(0.8))
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .onAppear {
                    // Auto-generate pass when sheet appears if not already generated
                    if pendingPass == nil, let card = pendingPassCard {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                            generatePassFor(card)
                        }
                    }
                }
                .onDisappear {
                    // Clear pass when sheet is dismissed
                    pendingPass = nil
                    pendingPassCard = nil
                }
            }
            .alert("Error", isPresented: .init(get: { alertMessage != nil }, set: { _ in alertMessage = nil })) {
                Button("OK", role: .cancel) { alertMessage = nil }
            } message: { Text(alertMessage ?? "") }
        }
        .overlay(alignment: .top) { sharingBannerTop }
        .overlay { focusedOverlay }
    }
}

// MARK: - Sharing Helpers

private extension BusinessCardListView {
    @ViewBuilder
    func makeSingleCardView() -> some View {
        ScrollView {
            VStack(spacing: 0) {
                if let card = cardManager.businessCards.first {
                    // Navigation buttons container at top
                    VStack(spacing: 0) {
                        NavigationButtonsView(
                            onPrivacy: {
                                showingPrivacySettings = true
                            },
                            onAppearance: {
                                showingAppearanceSettings = true
                            },
                            onBackup: {
                                showingBackupSettings = true
                            },
                            onGroup: {
                                showingGroupManagement = true
                            },
                            isPrivacyEnabled: true
                        )
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                        .padding(.bottom, 12)
                    }
                    .background(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .fill(Color.gray.opacity(0.12))
                            .overlay(
                                RoundedRectangle(cornerRadius: 20, style: .continuous)
                                    .stroke(Color.white.opacity(0.08), lineWidth: 1)
                            )
                    )
                    .padding(.horizontal, 16)
                    .padding(.top, 20)
                    
                    // Card section
                    WalletCardView(
                        card: card,
                        onEdit: { beginEdit(card) },
                        onAddToWallet: { addToWallet(card) }
                    )
                    .frame(height: 220)
                    .padding(.horizontal, 16)
                    .padding(.top, 20)
                    .onTapGesture {
                        handleFocus(card)
                    }
                }
            }
            .padding(.bottom, 40)
        }
    }
    
    func handleFocus(_ card: BusinessCard) {
        // Add haptic feedback for better UX
        let impact = UIImpactFeedbackGenerator(style: .medium)
        impact.impactOccurred()

        withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) {
            featuredCard = card
            isFeatured = true
        }
    }


    func beginEdit(_ card: BusinessCard) {
        // Add haptic feedback
        let impact = UIImpactFeedbackGenerator(style: .light)
        impact.impactOccurred()

        // Close focused view if open
        isFeatured = false

        // Set cardToEdit - this will automatically trigger the sheet(item:)
        cardToEdit = card
    }
    
    func addToWallet(_ card: BusinessCard) {
        // Store the card and show sheet (will auto-generate on appear)
        pendingPassCard = card
        pendingPass = nil
        showingAddPass = true
    }

    func generatePassFor(_ card: BusinessCard) {
        let result = PassKitManager.shared.generatePass(for: card, sharingLevel: .professional)
        switch result {
        case .success(let passData):
            // Create PKPass and update UI
            do {
                let pass = try PKPass(data: passData)
                pendingPass = pass
            } catch {
                alertMessage = "Failed to prepare Wallet pass: \(error.localizedDescription)"
                showingAddPass = false
            }
        case .failure(let err):
            alertMessage = err.localizedDescription
            showingAddPass = false
        }
    }
    
    @ViewBuilder
    var sharingBannerTop: some View {
        if proximityManager.isAdvertising {
            HStack(spacing: 8) {
                Image(systemName: "dot.radiowaves.left.and.right")
                    .foregroundColor(theme.cardAccent)
                Text("Sharing Nearby")
                    .font(.footnote.weight(.semibold))
                    .foregroundColor(.white)
                Spacer()
                Button("Stop") { proximityManager.stopAdvertising() }
                    .font(.footnote.weight(.semibold))
            }
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.white.opacity(0.08))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(theme.cardAccent.opacity(0.25), lineWidth: 1)
                    )
                    .cardGlow(theme.cardAccent, enabled: theme.enableGlow)
            )
            .padding(.horizontal, 16)
            .padding(.top, 10)
        }
    }
    
    func cardDisplayName() -> String {
        proximityManager.getSharingStatus().currentCard?.name ?? "Card"
    }

    @ViewBuilder
    var focusedOverlay: some View {
        if isFeatured, let card = featuredCard {
            Color.black.opacity(0.75).ignoresSafeArea()
                .transition(.opacity)
                .onTapGesture {
                    withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) {
                        isFeatured = false
                    }
                }
            FocusedCardView(card: card,
                             onEdit: { beginEdit(card) },
                             onDelete: { deleteCard(card) },
                             onClose: { withAnimation { isFeatured = false } })
                .padding(.horizontal, 20)
                .transition(.scale.combined(with: .opacity))
        }
    }
    
    func deleteCard(_ card: BusinessCard) {
        _ = cardManager.deleteCard(id: card.id)
        if featuredCard?.id == card.id { isFeatured = false }
    }
    
    @ViewBuilder
    func makeEmptyStateView() -> some View {
        ScrollView {
            VStack(spacing: 0) {
                // Navigation buttons container at top
                VStack(spacing: 0) {
                    NavigationButtonsView(
                        onPrivacy: {
                            // Privacy settings only available when card exists
                            if !cardManager.businessCards.isEmpty {
                                showingPrivacySettings = true
                            }
                        },
                        onAppearance: {
                            showingAppearanceSettings = true
                        },
                        onBackup: {
                            showingBackupSettings = true
                        },
                        onGroup: {
                            showingGroupManagement = true
                        },
                        isPrivacyEnabled: false
                    )
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                    .padding(.bottom, 16)
                }
                .background(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(Color.gray.opacity(0.12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 20, style: .continuous)
                                .stroke(Color.white.opacity(0.08), lineWidth: 1)
                        )
                )
                .padding(.horizontal, 16)
                .padding(.top, 20)
                
                EmptyWalletView()
            }
            .padding(.bottom, 40)
        }
    }
}


// A single large vertical wallet card with top-right category and edit/share control
private struct WalletCardView: View {
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
                // Gloss highlight for premium look
                .overlay(alignment: .topLeading) {
                    LinearGradient(
                        colors: [Color.white.opacity(0.45), Color.white.opacity(0.12), Color.clear],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .opacity(0.65)
                }
                .overlay {
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
                            if let company = card.company { Text(company).font(.subheadline).foregroundColor(.black.opacity(0.75)) }
                            if let title = card.title { Text(title).font(.footnote).foregroundColor(.black.opacity(0.65)) }
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
                .rotation3DEffect(.degrees(isFlipped ? 180 : 0), axis: (x: 0, y: 1, z: 0))
                .animation(.spring(response: 0.5, dampingFraction: 0.85), value: isFlipped)
                .cardGlow(theme.cardAccent, enabled: theme.enableGlow)

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
    }
    
    private func editTapped() {
        // Prevent multiple rapid taps
        guard !editAttempted else { return }
        editAttempted = true

        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.impactOccurred()

        // Directly open edit without flip animation to avoid gray screen
        onEdit()

        // Reset after delay
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            editAttempted = false
        }
    }
    
    private func addPassTapped() {
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()
        onAddToWallet()
    }
    
    private func category(for card: BusinessCard) -> String {
        if let company = card.company, !company.isEmpty { return company }
        if let title = card.title, !title.isEmpty { return title }
        return "Card"
    }
    
    private func perCardGradient(card: BusinessCard) -> LinearGradient {
        // Theme by animal when present
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
        // Fallback deterministic hue by UUID
        let hash = card.id.uuidString.hashValue
        let hue = Double(abs(hash % 360)) / 360.0
        let base = Color(hue: hue, saturation: 0.55, brightness: 0.95)
        let light = Color.white
        return LinearGradient(colors: [light, base], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

// MARK: - Components

// Simple right-top tag
private struct CategoryTag: View {
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


private struct EmptyWalletView: View {
    var body: some View {
        VStack(spacing: 32) {
            // Animated icon
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

            VStack(spacing: 12) {
                Text("No Business Card")
                    .font(.title.bold())
                    .foregroundColor(.white)

                Text("You need to create a card first")
                    .font(.body)
                    .foregroundColor(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Navigation Buttons View

private struct NavigationButtonsView: View {
    let onPrivacy: () -> Void
    let onAppearance: () -> Void
    let onBackup: () -> Void
    let onGroup: () -> Void
    var isPrivacyEnabled: Bool = true
    
    var body: some View {
        HStack(spacing: 12) {
            NavigationButton(
                icon: "lock.shield",
                title: "Privacy",
                action: onPrivacy,
                isEnabled: isPrivacyEnabled
            )
            
            NavigationButton(
                icon: "paintbrush.fill",
                title: "Appearance",
                action: onAppearance
            )
            
            NavigationButton(
                icon: "square.and.arrow.up",
                title: "Backup",
                action: onBackup
            )
            
            NavigationButton(
                icon: "person.3.fill",
                title: "Group Management",
                action: onGroup
            )
        }
    }
}

private struct NavigationButton: View {
    let icon: String
    let title: String
    let action: () -> Void
    var isEnabled: Bool = true
    
    var body: some View {
        Button(action: {
            guard isEnabled else { return }
            let impact = UIImpactFeedbackGenerator(style: .medium)
            impact.impactOccurred()
            action()
        }) {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundColor(isEnabled ? .white : .white.opacity(0.5))
                    .frame(width: 44, height: 44)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(isEnabled ? Color.white.opacity(0.18) : Color.white.opacity(0.08))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .stroke(Color.white.opacity(isEnabled ? 0.25 : 0.1), lineWidth: 1.5)
                            )
                    )
                
                Text(title)
                    .font(.caption2.weight(.semibold))
                    .foregroundColor(isEnabled ? .white : .white.opacity(0.5))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.75)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
        }
        .buttonStyle(PlainButtonStyle())
        .disabled(!isEnabled)
    }
}

#Preview { BusinessCardListView() }

