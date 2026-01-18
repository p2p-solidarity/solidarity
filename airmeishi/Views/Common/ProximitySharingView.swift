//
//  ProximitySharingView.swift
//  airmeishi
//
//  Simplified "Match" screen that combines proximity matching and QR scanning
//

import MultipeerConnectivity
import SwiftUI

/// Minimal, unified matching experience inspired by the provided mockup.
/// - Shows an orbit animation while matching
/// - One primary toggle to start/stop matching (advertise + browse)
/// - Optional QR scan sheet to add contacts via QR
struct ProximitySharingView: View {
  @StateObject private var proximityManager = ProximityManager.shared
  @StateObject private var cardManager = CardManager.shared

  @State private var selectedCard: BusinessCard?
  @State private var selectedSharingLevel: SharingLevel = .professional
  @State private var isMatching: Bool = false
  @State private var showQRScanner: Bool = false
  @State private var showCreateCard: Bool = false
  @State private var showShareSheet: Bool = false
  @State private var errorMessage: String?
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    ZStack {
      Color.black.ignoresSafeArea()

      VStack(spacing: 24) {
        Spacer()

        MatchingOrbitView()
          .frame(width: 280, height: 280)
          .opacity(isMatching ? 1 : 0.85)
          .animation(.easeInOut(duration: 0.3), value: isMatching)

        VStack(spacing: 8) {
          Text(isMatching ? "Match..." : "Ready to Match")
            .font(.system(size: 32, weight: .semibold))
            .foregroundColor(.white)

          Text("You've entered the matching phase, do not close the app. We'll notify you when you got a match!")
            .font(.footnote)
            .foregroundColor(Color.white.opacity(0.8))
            .multilineTextAlignment(.center)
            .adaptivePadding(horizontal: 24, vertical: 0)
        }

        VStack(spacing: 12) {
          Button(action: toggleMatching) {
            Text(isMatching ? "Stop Matching" : "Start Matching")
              .font(.headline)
              .foregroundColor(isMatching ? .white : .black)
              .frame(maxWidth: .infinity)
              .padding(.vertical, 14)
              .background(isMatching ? Color.red.opacity(0.9) : Color.white)
              .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
              .shadow(color: .black.opacity(0.2), radius: 8, x: 0, y: 4)
          }

          HStack(spacing: 20) {
            Button(action: { showQRScanner = true }) {
              HStack(spacing: 6) {
                Image(systemName: "qrcode.viewfinder")
                Text("Scan QR")
              }
              .font(.subheadline)
              .foregroundColor(Color.white.opacity(0.9))
              .padding(.vertical, 8)
              .padding(.horizontal, 12)
              .background(Color.white.opacity(0.1))
              .cornerRadius(20)
            }

            Button(action: { showShareSheet = true }) {
              HStack(spacing: 6) {
                Image(systemName: "square.and.arrow.up")
                  .font(.system(size: 14))
                Text("Share Options")
              }
              .font(.subheadline)
              .foregroundColor(Color.white.opacity(0.9))
              .padding(.vertical, 8)
              .padding(.horizontal, 12)
              .background(Color.white.opacity(0.1))
              .cornerRadius(20)
            }
          }
          .padding(.bottom, 20)
        }
        .adaptivePadding(horizontal: 24, vertical: 0)

        Spacer()
      }
      .adaptiveMaxWidth(500)

      // Close button
      VStack {
        HStack {
          Spacer()
          Button(action: {
            // Just dismiss, keep matching running in background
            dismiss()
          }) {
            Image(systemName: "xmark")
              .font(.system(size: 16, weight: .semibold))
              .foregroundColor(.white)
              .padding(10)
              .background(Color.gray.opacity(0.3))
              .clipShape(Circle())
              .shadow(color: Color.black.opacity(0.5), radius: 6, x: 0, y: 3)
          }
        }
        .padding(.top, 12)
        .padding(.trailing, 16)
        Spacer()
      }
    }
    .overlay(incomingInvitationOverlay)
    .overlay(incomingGroupInviteOverlay)
    .sheet(isPresented: $showQRScanner) {
      QRScannerView()
    }
    .sheet(isPresented: $showCreateCard) {
      BusinessCardFormView { saved in
        selectedCard = saved
        showCreateCard = false
      }
    }
    .sheet(isPresented: $showShareSheet) {
      if let card = selectedCard {
        QRSharingView(businessCard: card)
      } else {
        VStack(spacing: 16) {
          Text("No Business Card Available")
            .font(.headline)
          Text("Please create a business card first.")
            .foregroundColor(.secondary)
          Button("Close") {
            showShareSheet = false
          }
        }
        .padding()
      }
    }
    .alert(
      "Error",
      isPresented: .init(
        get: { errorMessage != nil },
        set: { _ in errorMessage = nil }
      )
    ) {
      Button("OK", role: .cancel) { errorMessage = nil }
    } message: {
      Text(errorMessage ?? "")
    }
    .onReceive(proximityManager.$lastError) { error in
      if let error = error { errorMessage = error.localizedDescription }
    }
    .onChange(of: errorMessage) { _, newValue in
      if newValue != nil {
        proximityManager.debugLogInfoPlist()
      }
    }
    .onReceive(cardManager.$businessCards) { cards in
      if selectedCard == nil {
        selectedCard = cards.first
      }
    }
    .onAppear {
      proximityManager.debugLogInfoPlist()
      if selectedCard == nil { selectedCard = cardManager.businessCards.first }
    }
  }

  // MARK: - Actions

  private func toggleMatching() {
    if isMatching {
      stopMatchingIfNeeded()
      return
    }

    if let card = selectedCard {
      proximityManager.startMatching(with: card, sharingLevel: selectedSharingLevel)
    } else {
      proximityManager.startMatching(with: nil)
    }
    // proximityManager.startBrowsing() // Handled by startMatching
    isMatching = true
  }

  private func stopMatchingIfNeeded() {
    if isMatching {
      proximityManager.stopAdvertising()
      proximityManager.stopBrowsing()
      isMatching = false
    }
  }

  private var incomingInvitationOverlay: some View {
    Group {
      if let invitation = proximityManager.pendingInvitation {
        IncomingInvitationPopupView(
          invitation: invitation,
          onAccept: {
            proximityManager.respondToPendingInvitation(accept: true)
          },
          onDecline: {
            proximityManager.respondToPendingInvitation(accept: false)
          },
          onDismiss: {
            proximityManager.releaseInvitationPresentation()
          }
        )
        .transition(.opacity)
      }
    }
  }

  private var incomingGroupInviteOverlay: some View {
    Group {
      if let tuple = proximityManager.pendingGroupInvite {
        ConnectGroupInvitePopupView(
          invite: tuple.payload,
          fromPeer: tuple.from,
          isPresented: Binding<Bool>(
            get: { true },
            set: { newVal in if newVal == false { proximityManager.pendingGroupInvite = nil } }
          ),
          autoDismissOnSuccess: true,
          onDismiss: {
            proximityManager.pendingGroupInvite = nil
            proximityManager.releaseInvitationPresentation()
          }
        )
        .transition(AnyTransition.opacity)
      }
    }
  }
}
