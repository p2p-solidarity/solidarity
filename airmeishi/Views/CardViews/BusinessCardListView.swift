//
//  BusinessCardListView.swift
//  airmeishi
//
//  Main view for displaying and managing business cards
//

import PassKit
import SwiftUI
import UIKit

struct BusinessCardListView: View {
<<<<<<< Updated upstream
=======
<<<<<<< Updated upstream
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
    @ObservedObject private var identityCoordinator = IdentityCoordinator.shared
    @State private var activeOIDCEvent: IdentityState.OIDCEvent?
    
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
=======
>>>>>>> Stashed changes
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
  @ObservedObject private var identityCoordinator = IdentityCoordinator.shared
  @State private var activeOIDCEvent: IdentityState.OIDCEvent?
<<<<<<< Updated upstream
=======

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
          MatchingBarView()
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
          IdentityDashboardView(
            sharingPreferences: Binding(
              get: {
                if let currentCard = cardManager.businessCards.first(where: { $0.id == cardId }) {
                  return currentCard.sharingPreferences
>>>>>>> Stashed changes
                }
            }
            .navigationBarTitleDisplayMode(.inline)
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
                    IdentityDashboardView(
                        sharingPreferences: Binding(
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
                        )
                    )
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
>>>>>>> Stashed changes

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
          IdentityDashboardView(
            sharingPreferences: Binding(
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
            )
          )
        }
      }
      .sheet(isPresented: $showingCreateCard) {
        BusinessCardFormView(forceCreate: true) { _ in
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
      } message: {
        Text(alertMessage ?? "")
      }
    }
    .overlay(alignment: .top) {
      VStack(spacing: 8) {
        oidcBannerView
        sharingBannerTop
      }
      .padding(.top, 10)
    }
    .overlay { focusedOverlay }
    .onChange(of: identityCoordinator.state.lastOIDCEvent) { _, event in
      guard let event = event else { return }
      activeOIDCEvent = event
      DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
        if activeOIDCEvent?.timestamp == event.timestamp {
          activeOIDCEvent = nil
        }
      }
    }
  }
}

// MARK: - Sharing Helpers

extension BusinessCardListView {
  @ViewBuilder
  fileprivate func makeSingleCardView() -> some View {
    GeometryReader { geometry in
      ScrollView {
        VStack(spacing: 0) {
          Spacer()
            .frame(height: max(0, (geometry.size.height - 220) / 2 - 100))

          if let card = cardManager.businessCards.first {
            // Card section
            WalletCardView(
              card: card,
              onEdit: { beginEdit(card) },
              onAddToWallet: { addToWallet(card) }
            )
            .frame(height: 220)
            .adaptivePadding(horizontal: 16, vertical: 0)
            .adaptiveMaxWidth(500)
            .onTapGesture {
              handleFocus(card)
            }
          }

          Spacer()
            .frame(height: max(0, (geometry.size.height - 220) / 2 - 100))
        }
        .frame(maxWidth: .infinity)
      }
    }
  }

  fileprivate func handleFocus(_ card: BusinessCard) {
    // Add haptic feedback for better UX
    let impact = UIImpactFeedbackGenerator(style: .medium)
    impact.impactOccurred()

    withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) {
      featuredCard = card
      isFeatured = true
    }
  }

  fileprivate func beginEdit(_ card: BusinessCard) {
    // Add haptic feedback
    let impact = UIImpactFeedbackGenerator(style: .light)
    impact.impactOccurred()

    // Close focused view if open
    isFeatured = false

    // Set cardToEdit - this will automatically trigger the sheet(item:)
    cardToEdit = card
  }

  fileprivate func addToWallet(_ card: BusinessCard) {
    // Store the card and show sheet (will auto-generate on appear)
    pendingPassCard = card
    pendingPass = nil
    showingAddPass = true
  }

  fileprivate func generatePassFor(_ card: BusinessCard) {
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

  fileprivate func updateSharingFormat(for cardId: UUID, format: SharingFormat) {
    guard var updatedCard = cardManager.businessCards.first(where: { $0.id == cardId }) else { return }
    updatedCard.sharingPreferences.sharingFormat = format
    // Enforce ZK by default as requested
    updatedCard.sharingPreferences.useZK = true
    _ = cardManager.updateCard(updatedCard)
  }

  @ViewBuilder
  fileprivate var sharingBannerTop: some View {
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
      .adaptivePadding(horizontal: 16, vertical: 0)
      .padding(.top, 10)
    }
  }

  fileprivate func cardDisplayName() -> String {
    proximityManager.getSharingStatus().currentCard?.name ?? "Card"
  }

  @ViewBuilder
  fileprivate var focusedOverlay: some View {
    if isFeatured, let card = featuredCard {
      Color.black.opacity(0.75).ignoresSafeArea()
        .transition(.opacity)
        .onTapGesture {
          withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) {
            isFeatured = false
          }
        }
      FocusedCardView(
        card: card,
        onEdit: { beginEdit(card) },
        onDelete: { deleteCard(card) },
        onClose: { withAnimation { isFeatured = false } }
      )
      .adaptivePadding(horizontal: 20, vertical: 0)
      .transition(.scale.combined(with: .opacity))
    }
  }

  fileprivate func deleteCard(_ card: BusinessCard) {
    _ = cardManager.deleteCard(id: card.id)
    if featuredCard?.id == card.id { isFeatured = false }
  }

  @ViewBuilder
  fileprivate func makeEmptyStateView() -> some View {
    BusinessCardEmptyStateView(onCreateCard: {
      showingCreateCard = true
    })
  }

  @ViewBuilder
  fileprivate var oidcBannerView: some View {
    if let event = activeOIDCEvent {
      HStack(spacing: 8) {
        Image(systemName: symbol(for: event.kind))
          .foregroundColor(.white)
        VStack(alignment: .leading, spacing: 2) {
          Text(event.message)
            .font(.footnote.weight(.semibold))
            .foregroundColor(.white)
          Text(event.state)
            .font(.caption2)
            .foregroundColor(.white.opacity(0.7))
        }
        Spacer()
      }
      .padding(10)
      .background(
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .fill(bannerColor(for: event.kind).opacity(0.85))
          .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
              .stroke(Color.white.opacity(0.2), lineWidth: 1)
          )
      )
      .adaptivePadding(horizontal: 16, vertical: 0)
    }
  }

  private func symbol(for kind: IdentityState.OIDCEvent.Kind) -> String {
    switch kind {
    case .requestCreated: return "paperplane"
    case .credentialImported: return "checkmark.seal"
    case .error: return "exclamationmark.triangle"
    }
  }

  private func bannerColor(for kind: IdentityState.OIDCEvent.Kind) -> Color {
    switch kind {
    case .requestCreated: return .blue
    case .credentialImported: return .green
    case .error: return .red
    }
  }
}
