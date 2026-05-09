//
//  NearbyPeersSheet.swift
//  solidarity
//
//  Sheet listing nearby peers with search and a CTA to view latest card.
//

import SwiftUI

struct NearbyPeersSheet: View {
  let peers: [ProximityPeer]
  let connectedCount: Int
  let onViewLatestCard: () -> Void
  let onSendInvitation: (ProximityPeer) -> Void
  let onHandleViewLatestCard: () -> Void

  @Environment(\.dismiss) private var dismiss
  @Environment(\.colorScheme) private var colorScheme
  @State private var isLighteningAnimating = false
  @State private var searchText = ""
  @State private var selectedPeer: ProximityPeer?
  @State private var showingPeerDetail = false
  @State private var showingConnectPopup = false
  @State private var connectTarget: ProximityPeer?
  @State private var sendingInProgress: UUID?
  @StateObject private var proximityManager = ProximityManager.shared
  @StateObject private var cardManager = CardManager.shared

  var filteredPeers: [ProximityPeer] {
    if searchText.isEmpty { return peers }
    return peers.filter { peer in
      peer.cardName?.localizedCaseInsensitiveContains(searchText) == true
        || peer.cardTitle?.localizedCaseInsensitiveContains(searchText) == true
        || peer.cardCompany?.localizedCaseInsensitiveContains(searchText) == true
        || peer.name.localizedCaseInsensitiveContains(searchText) == true
    }
  }

  /// Only worth surfacing the "View Latest Card" CTA once we've actually
  /// received a card. The original sheet showed the button whenever any peer
  /// was connected, which led to a confusing waiting-state sheet on tap.
  private var hasReceivedCard: Bool {
    proximityManager.receivedCards.last != nil
  }

  var body: some View {
    NavigationStack {
      ZStack {
        Color.Theme.pageBg.ignoresSafeArea()

        VStack(spacing: 0) {
          lightningHeader
          searchBar
          if filteredPeers.isEmpty && !searchText.isEmpty {
            emptySearchState
          } else if filteredPeers.isEmpty {
            emptyState
          } else {
            peersGrid
          }
          if hasReceivedCard { lightningActionButton }

          if let message = proximityManager.matchingInfoMessage {
            Text(message)
              .font(.system(size: 12))
              .foregroundColor(Color.Theme.textSecondary)
              .multilineTextAlignment(.center)
              .padding(.horizontal)
              .padding(.bottom, 8)
              .transition(.opacity)
          }
        }

        if let target = connectTarget, showingConnectPopup {
          ConnectPeerPopupView(peer: target, isPresented: $showingConnectPopup, autoDismissOnSuccess: true) {
            connectTarget = nil
          }
          .transition(.opacity)
        }
      }
      .navigationTitle("Lightening Peers")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { SettingsBackToolbar { dismiss() } }
      .onAppear { isLighteningAnimating = true }
      .sheet(isPresented: $showingPeerDetail) {
        if let peer = selectedPeer { PeerDetailSheet(peer: peer) }
      }
    }
    .incomingInvitationOverlay()
  }

  private var lightningHeader: some View {
    HStack(spacing: 10) {
      Image(systemName: "bolt.fill")
        .font(.system(size: 16, weight: .regular))
        .foregroundColor(Color.Theme.terminalGreen)

      Text("Nearby")
        .font(.system(size: 14))
        .foregroundColor(Color.Theme.textPrimary)

      Spacer()

      HStack(spacing: 6) {
        Circle()
          .fill(connectedCount > 0 ? Color.Theme.terminalGreen : Color.Theme.textTertiary)
          .frame(width: 6, height: 6)
        Text("\(connectedCount)/\(peers.count)")
          .font(.system(size: 12))
          .foregroundColor(Color.Theme.textSecondary)
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 4)
      .background(
        Capsule().fill(Color.Theme.mutedSurface)
      )
    }
    .padding(.horizontal, 16)
    .padding(.top, 8)
    .padding(.bottom, 12)
  }

  private var searchBar: some View {
    HStack {
      Image(systemName: "magnifyingglass")
        .font(.system(size: 14))
        .foregroundColor(Color.Theme.textSecondary)
      TextField("Search peers...", text: $searchText)
        .textFieldStyle(PlainTextFieldStyle())
        .font(.system(size: 14))
        .foregroundColor(Color.Theme.textPrimary)
      if !searchText.isEmpty {
        Button("Clear") { searchText = "" }
          .font(.system(size: 12))
          .foregroundColor(Color.Theme.textSecondary)
      }
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 12)
    .background(
      RoundedRectangle(cornerRadius: 12)
        .fill(Color.Theme.mutedSurface)
    )
    .padding(.horizontal, 16)
    .padding(.bottom, 12)
  }

  private var peersGrid: some View {
    ScrollView {
      LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
        ForEach(filteredPeers) { peer in
          LighteningPeerCard(
            peer: peer,
            isLighteningAnimating: isLighteningAnimating,
            onTap: {
              selectedPeer = peer
              showingPeerDetail = true
            },
            onConnect: {
              connectTarget = peer
              showingConnectPopup = true
            },
            onSendCard: {
              sendCard(to: peer)
            },
            onDisconnect: {
              proximityManager.disconnectFromPeer(peer)
            }
          )
        }
      }
      .padding(.horizontal, 16)
      .padding(.bottom, hasReceivedCard ? 100 : 20)
    }
  }

  private var emptyState: some View {
    VStack {
      Spacer(minLength: 12)
      VStack(spacing: 12) {
        Image(systemName: "person.2.fill")
          .font(.system(size: 28, weight: .regular))
          .foregroundColor(Color.Theme.textSecondary)
          .frame(width: 56, height: 56)
          .background(
            Circle().fill(Color.Theme.pageBg)
          )

        VStack(spacing: 6) {
          Text("No Lightening Peers Yet")
            .font(.system(size: 16, weight: .semibold))
            .foregroundColor(Color.Theme.textPrimary)
          Text("Start matching to discover nearby professionals with lightning-fast connections")
            .font(.system(size: 13))
            .foregroundColor(Color.Theme.textSecondary)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16)
        }
      }
      .padding(.vertical, 28)
      .frame(maxWidth: .infinity)
      .background(
        RoundedRectangle(cornerRadius: 12)
          .fill(Color.Theme.mutedSurface)
      )
      .padding(.horizontal, 16)
      Spacer()
    }
  }

  private var emptySearchState: some View {
    VStack {
      Spacer(minLength: 12)
      VStack(spacing: 12) {
        Image(systemName: "magnifyingglass")
          .font(.system(size: 28, weight: .regular))
          .foregroundColor(Color.Theme.textSecondary)
          .frame(width: 56, height: 56)
          .background(
            Circle().fill(Color.Theme.pageBg)
          )

        VStack(spacing: 6) {
          Text("No Results")
            .font(.system(size: 16, weight: .semibold))
            .foregroundColor(Color.Theme.textPrimary)
          Text("No peers match your search")
            .font(.system(size: 13))
            .foregroundColor(Color.Theme.textSecondary)
        }
      }
      .padding(.vertical, 28)
      .frame(maxWidth: .infinity)
      .background(
        RoundedRectangle(cornerRadius: 12)
          .fill(Color.Theme.mutedSurface)
      )
      .padding(.horizontal, 16)
      Spacer()
    }
  }

  private var lightningActionButton: some View {
    VStack {
      Spacer()
      Button(action: onViewLatestCard) {
        HStack(spacing: 12) {
          Image(systemName: "bolt.fill")
            .font(.system(size: 15, weight: .semibold))
          Text("View Latest Lightening Card")
            .font(.system(size: 15, weight: .semibold))
        }
        .frame(maxWidth: .infinity)
      }
      .buttonStyle(ThemedPrimaryButtonStyle())
      .padding(.horizontal, 16)
      .padding(.bottom, 20)
    }
  }

  private func sendCard(to peer: ProximityPeer) {
    guard let card = cardManager.businessCards.first else {
      ToastManager.shared.show(
        title: String(localized: "No Card"),
        message: String(localized: "Create an identity card in the Me tab first."),
        type: .error
      )
      return
    }
    sendingInProgress = peer.id
    proximityManager.sendCard(card, to: peer.peerID, sharingLevel: proximityManager.currentSharingLevel)
    ToastManager.shared.show(
      title: String(localized: "Card Sent"),
      message: String(format: String(localized: "Sent your card to %@."), peer.cardName ?? peer.name),
      type: .success
    )
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
      sendingInProgress = nil
    }
  }
}
