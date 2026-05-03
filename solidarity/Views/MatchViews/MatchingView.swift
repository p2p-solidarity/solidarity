//
//  MatchingView.swift
//  solidarity
//
//  Matching interface with orbit animation and peer management
//

import SwiftUI

// Thin wrapper to keep the original name used elsewhere
struct MatchingView: View {
  var body: some View {
    MatchingRootView()
  }
}

// Subviews moved to `Views/Common/Matching/*`

// MARK: - Peer Detail Sheet
struct PeerDetailSheet: View {
  let peer: ProximityPeer
  @Environment(\.dismiss) private var dismiss
  @Environment(\.colorScheme) private var colorScheme
  @State private var isLighteningAnimating = false
  @State private var showingConnectPopup = false
  @StateObject private var proximityManager = ProximityManager.shared
  @StateObject private var cardManager = CardManager.shared

  /// Resolves the live peer record so this sheet reflects status changes that
  /// happened after it was opened (e.g. the connect popup completed). Falls
  /// back to the captured `peer` if MultipeerConnectivity has dropped it.
  private var livePeer: ProximityPeer {
    proximityManager.nearbyPeers.first(where: { $0.peerID == peer.peerID }) ?? peer
  }

  var body: some View {
    NavigationStack {
      ZStack {
        Color.Theme.pageBg.ignoresSafeArea()

        ScrollView {
          VStack(spacing: 24) {
            // Lightening header
            HStack {
              Image(systemName: "bolt.fill")
                .foregroundColor(Color.Theme.featureAccent)
                .font(.title)
                .scaleEffect(isLighteningAnimating ? 1.3 : 1.0)
                .animation(
                  .easeInOut(duration: 0.5).repeatForever(autoreverses: true),
                  value: isLighteningAnimating
                )

              Text("Peer Details")
                .font(.title2)
                .fontWeight(.bold)
                .foregroundColor(Color.Theme.textPrimary)

              Spacer()
            }
            .padding(.horizontal)

            // Peer info card
            VStack(spacing: 16) {
              // Avatar and basic info
              VStack(spacing: 12) {
                ZStack {
                  Circle()
                    .fill(
                      LinearGradient(
                        colors: [Color.Theme.primaryBlue, Color.Theme.dustyMauve],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                      )
                    )
                    .frame(width: 80, height: 80)

                  Text(peerAvatarInitials)
                    .font(.title)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                }

                VStack(spacing: 4) {
                  Text(peer.cardName ?? peer.name)
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(Color.Theme.textPrimary)

                  if let title = peer.cardTitle {
                    Text(title)
                      .font(.headline)
                      .foregroundColor(Color.Theme.featureAccent)
                  }

                  if let company = peer.cardCompany {
                    Text(company)
                      .font(.subheadline)
                      .foregroundColor(Color.Theme.textSecondary)
                  }
                }
              }

              // Status and verification
              VStack(spacing: 12) {
                HStack {
                  Text("Connection Status")
                    .font(.headline)
                    .foregroundColor(Color.Theme.textPrimary)
                  Spacer()
                  HStack(spacing: 6) {
                    Circle()
                      .fill(statusColor)
                      .frame(width: 8, height: 8)
                    Text(livePeer.status.rawValue)
                      .font(.subheadline)
                      .foregroundColor(Color.Theme.textPrimary)
                  }
                }

                if let verification = livePeer.verification {
                  HStack {
                    Text("Verification")
                      .font(.headline)
                      .foregroundColor(Color.Theme.textPrimary)
                    Spacer()
                    HStack(spacing: 6) {
                      Image(systemName: verification.systemImageName)
                        .foregroundColor(verificationColor)
                      Text(verification.displayName)
                        .font(.subheadline)
                        .foregroundColor(Color.Theme.textPrimary)
                    }
                  }
                }

                if peer.discoveryInfo["zk"] == "1" {
                  HStack {
                    Text("ZK Capability")
                      .font(.headline)
                      .foregroundColor(Color.Theme.textPrimary)
                    Spacer()
                    HStack(spacing: 6) {
                      Image(systemName: "shield.checkerboard")
                        .foregroundColor(Color.Theme.primaryBlue)
                      Text("Enabled")
                        .font(.subheadline)
                        .foregroundColor(Color.Theme.textPrimary)
                    }
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
                    .stroke(Color.Theme.featureAccent.opacity(0.3), lineWidth: 1)
                )
            )

            actionButtons
              .padding(.top, 4)

            Spacer()
          }
          .padding()
        }

        if showingConnectPopup {
          ConnectPeerPopupView(peer: livePeer, isPresented: $showingConnectPopup, autoDismissOnSuccess: true)
            .transition(.opacity)
        }
      }
      .navigationTitle("Peer Details")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button("Done") { dismiss() }
        }
      }
      .onAppear {
        isLighteningAnimating = true
      }
    }
  }

  @ViewBuilder
  private var actionButtons: some View {
    switch livePeer.status {
    case .disconnected:
      Button {
        showingConnectPopup = true
      } label: {
        HStack(spacing: 8) {
          Image(systemName: "link.badge.plus")
          Text("Connect & Send Card")
        }
        .frame(maxWidth: .infinity)
      }
      .buttonStyle(ThemedPrimaryButtonStyle())
    case .connecting:
      Button(action: { proximityManager.cancelConnectionAttempt(for: livePeer) }) {
        HStack(spacing: 8) {
          ProgressView()
            .progressViewStyle(CircularProgressViewStyle(tint: .white))
            .scaleEffect(0.7)
          Text("Cancel Connecting")
        }
        .frame(maxWidth: .infinity)
      }
      .buttonStyle(ThemedSecondaryButtonStyle())
    case .connected:
      VStack(spacing: 10) {
        Button(action: sendCardNow) {
          HStack(spacing: 8) {
            Image(systemName: "paperplane.fill")
            Text("Send My Card")
          }
          .frame(maxWidth: .infinity)
        }
        .buttonStyle(ThemedPrimaryButtonStyle())
        Button(action: { proximityManager.cancelConnectionAttempt(for: livePeer) }) {
          HStack(spacing: 8) {
            Image(systemName: "xmark.circle")
            Text("Disconnect")
          }
          .frame(maxWidth: .infinity)
        }
        .buttonStyle(ThemedSecondaryButtonStyle())
      }
    }
  }

  private func sendCardNow() {
    guard let card = cardManager.businessCards.first else {
      ToastManager.shared.show(
        title: String(localized: "No Card"),
        message: String(localized: "Create an identity card in the Me tab first."),
        type: .error
      )
      return
    }
    proximityManager.sendCard(card, to: livePeer.peerID, sharingLevel: proximityManager.currentSharingLevel)
    ToastManager.shared.show(
      title: String(localized: "Card Sent"),
      message: String(format: String(localized: "Sent your card to %@."), livePeer.cardName ?? livePeer.name),
      type: .success
    )
  }

  private var peerAvatarInitials: String {
    let name = peer.cardName ?? peer.name
    let components = name.components(separatedBy: " ")
    let initials = components.compactMap { $0.first }.map { String($0) }
    return initials.prefix(2).joined().uppercased()
  }

  private var statusColor: Color {
    switch livePeer.status {
    case .connected: return .green
    case .connecting: return .orange
    case .disconnected: return .gray
    }
  }

  private var verificationColor: Color {
    if let verification = livePeer.verification {
      switch verification {
      case .verified: return .green
      case .pending: return .orange
      case .unverified: return Color.Theme.primaryBlue
      case .failed: return .red
      }
    }
    return Color.Theme.primaryBlue
  }
}

#Preview {
  ZStack {
    Color.Theme.pageBg.ignoresSafeArea()
    MatchingView().frame(width: 300, height: 300)
  }
}
