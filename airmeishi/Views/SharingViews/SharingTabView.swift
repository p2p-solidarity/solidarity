//
//  SharingTabView.swift
//  airmeishi
//
//  Main sharing hub: radar matching view with UWB spatial sensing,
//  QR scanner access via toolbar, and peer discovery.
//

import SwiftUI

struct SharingTabView: View {
  @StateObject private var proximityManager = ProximityManager.shared
  @StateObject private var cardManager = CardManager.shared
  @StateObject private var niManager = NearbyInteractionManager.shared
  @Environment(\.colorScheme) private var colorScheme
  @State private var showingScanSheet = false
  @State private var showingShareSheet = false
  @State private var showingNearbySheet = false
  @State private var showingReceivedCard = false
  @State private var isMatching = false

  var body: some View {
    NavigationStack {
      ZStack {
        // Background gradient
        LinearGradient(
          colors: Color.Theme.pageGradient(for: colorScheme),
          startPoint: .top,
          endPoint: .bottom
        )
        .ignoresSafeArea()

        VStack(spacing: 0) {
          Spacer()

          // Radar view
          RadarMatchingView(
            peers: proximityManager.nearbyPeers,
            isMatching: isMatching,
            niManager: niManager
          )
          .frame(height: 300)
          .onTapGesture {
            if !proximityManager.nearbyPeers.isEmpty {
              showingNearbySheet = true
            }
          }

          Spacer().frame(height: 24)

          // Status text
          VStack(spacing: 8) {
            Text(isMatching ? "Scanning Nearby" : "Ready To Match")
              .font(.system(size: 22, weight: .bold))
              .foregroundColor(Color.Theme.textPrimary)

            Text(statusSubtitle)
              .font(.system(size: 14))
              .foregroundColor(Color.Theme.textSecondary)
              .multilineTextAlignment(.center)
              .padding(.horizontal, 40)
          }

          Spacer().frame(height: 28)

          // Main action button
          Button(action: toggleMatching) {
            HStack(spacing: 10) {
              Image(systemName: isMatching ? "stop.fill" : "dot.radiowaves.left.and.right")
                .font(.system(size: 16, weight: .semibold))
              Text(isMatching ? "Stop Matching" : "Start Matching")
                .font(.system(size: 16, weight: .semibold))
            }
          }
          .buttonStyle(ThemedPrimaryButtonStyle())
          .padding(.horizontal, 48)

          // UWB status pill
          if niManager.isSupported, niManager.spatialState.isActive {
            uwbStatusPill
              .padding(.top, 12)
          }

          Spacer()
        }
        .padding(.bottom, 80)
      }
      .navigationTitle("Sharing")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarLeading) {
          Button {
            showingScanSheet = true
          } label: {
            Image(systemName: "qrcode.viewfinder")
              .foregroundColor(Color.Theme.toolbarTint(for: colorScheme))
          }
        }
        ToolbarItem(placement: .navigationBarTrailing) {
          Button {
            showingShareSheet = true
          } label: {
            Image(systemName: "square.and.arrow.up")
              .foregroundColor(Color.Theme.toolbarTint(for: colorScheme))
          }
        }
      }
    }
    .onAppear {
      setupSpatialTrigger()
    }
    .sheet(isPresented: $showingScanSheet) {
      ScanTabView()
    }
    .sheet(isPresented: $showingShareSheet) {
      ShareCardPickerSheet(
        cards: cardManager.businessCards,
        onStart: { card, level in proximityManager.startAdvertising(with: card, sharingLevel: level) },
        onStop: { proximityManager.stopAdvertising() },
        isAdvertising: proximityManager.getSharingStatus().isAdvertising
      )
    }
    .sheet(isPresented: $showingNearbySheet) {
      NearbyPeersSheet(
        peers: proximityManager.nearbyPeers,
        connectedCount: proximityManager.getSharingStatus().connectedPeersCount,
        onViewLatestCard: { showingReceivedCard = true },
        onSendInvitation: { peer in proximityManager.connectToPeer(peer) },
        onHandleViewLatestCard: { showingReceivedCard = true }
      )
    }
    .sheet(isPresented: $showingReceivedCard) {
      if let card = proximityManager.receivedCards.last {
        ReceivedCardView(card: card)
      }
    }
  }

  // MARK: - Actions

  private func toggleMatching() {
    HapticFeedbackManager.shared.heavyImpact()
    if isMatching {
      proximityManager.disconnect()
      isMatching = false
    } else {
      let card = cardManager.businessCards.first
      proximityManager.startMatching(with: card)
      isMatching = true
    }
  }

  private var statusSubtitle: String {
    if isMatching {
      let count = proximityManager.nearbyPeers.count
      if count > 0 {
        return "Found \(count) nearby \(count == 1 ? "peer" : "peers"). Tap the radar to connect."
      }
      return "Searching for nearby peers... Keep the app open."
    }
    return "Start matching to discover nearby people and exchange cards."
  }

  // MARK: - UWB

  private func setupSpatialTrigger() {
    niManager.onSpatialTrigger = { peerID in
      guard let card = CardManager.shared.businessCards.first else {
        NearbyInteractionManager.shared.exchangeDidFail()
        return
      }
      ProximityManager.shared.sendCard(
        card, to: peerID,
        sharingLevel: ProximityManager.shared.currentSharingLevel
      )
      NearbyInteractionManager.shared.exchangeDidComplete()
    }
  }

  private var uwbStatusPill: some View {
    HStack(spacing: 6) {
      Circle()
        .fill(uwbColor)
        .frame(width: 6, height: 6)
      Text(uwbLabel)
        .font(.system(size: 12, weight: .medium))
        .foregroundColor(Color.Theme.textSecondary)
      if let d = niManager.currentDistance {
        Text(String(format: "%.0f cm", d * 100))
          .font(.system(size: 11, weight: .regular, design: .monospaced))
          .foregroundColor(Color.Theme.textTertiary)
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 5)
    .background(
      Capsule()
        .fill(Color.Theme.cardSurface(for: colorScheme))
        .overlay(Capsule().stroke(uwbColor.opacity(0.4), lineWidth: 1))
    )
    .transition(.scale.combined(with: .opacity))
    .animation(.spring(), value: niManager.spatialState)
  }

  private var uwbColor: Color {
    switch niManager.spatialState {
    case .approaching: return .orange
    case .confirmed, .exchanging: return Color.Theme.terminalGreen
    default: return Color.Theme.textTertiary
    }
  }

  private var uwbLabel: String {
    switch niManager.spatialState {
    case .approaching(let f):
      return "Detecting (\(f)/\(niManager.config.requiredFrames))"
    case .confirmed: return "Contact!"
    case .exchanging: return "Exchanging..."
    case .cooldown: return "Done"
    default: return "UWB"
    }
  }
}

// MARK: - Radar Matching View

struct RadarMatchingView: View {
  let peers: [ProximityPeer]
  let isMatching: Bool
  @ObservedObject var niManager: NearbyInteractionManager
  @Environment(\.colorScheme) private var colorScheme

  @State private var pulseScale1: CGFloat = 0.3
  @State private var pulseScale2: CGFloat = 0.3
  @State private var pulseScale3: CGFloat = 0.3
  @State private var pulseOpacity1: Double = 0.6
  @State private var pulseOpacity2: Double = 0.6
  @State private var pulseOpacity3: Double = 0.6

  var body: some View {
    GeometryReader { geo in
      let size = min(geo.size.width, geo.size.height)
      let center = CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)

      ZStack {
        // Expanding pulse rings
        if isMatching {
          pulseRing(scale: pulseScale1, opacity: pulseOpacity1, size: size)
          pulseRing(scale: pulseScale2, opacity: pulseOpacity2, size: size)
          pulseRing(scale: pulseScale3, opacity: pulseOpacity3, size: size)
        }

        // Static concentric rings
        Circle()
          .stroke(Color.Theme.radarRing, lineWidth: 1)
          .frame(width: size * 0.85, height: size * 0.85)
        Circle()
          .stroke(Color.Theme.radarRing, lineWidth: 1)
          .frame(width: size * 0.6, height: size * 0.6)
        Circle()
          .stroke(Color.Theme.radarRing, lineWidth: 1)
          .frame(width: size * 0.35, height: size * 0.35)

        // Center glow sphere
        RadialGradient(
          colors: [
            Color.Theme.radarGlow,
            Color.Theme.radarGlow.opacity(0.3),
            Color.clear,
          ],
          center: .center,
          startRadius: 5,
          endRadius: size * 0.18
        )
        .frame(width: size * 0.36, height: size * 0.36)

        // Center orb
        Circle()
          .fill(
            RadialGradient(
              colors: [
                Color.white.opacity(colorScheme == .dark ? 0.2 : 0.8),
                Color.Theme.featureAccent.opacity(0.3),
                Color.Theme.featureAccent.opacity(0.1),
              ],
              center: .center,
              startRadius: 2,
              endRadius: size * 0.08
            )
          )
          .frame(width: size * 0.16, height: size * 0.16)
          .overlay(
            Circle()
              .stroke(Color.Theme.featureAccent.opacity(0.4), lineWidth: 1)
          )

        // Peer avatars
        ForEach(Array(peers.prefix(8).enumerated()), id: \.element.id) { index, peer in
          peerDot(peer: peer, index: index, total: min(peers.count, 8), center: center, radius: size * 0.35)
        }
      }
      .frame(width: geo.size.width, height: geo.size.height)
    }
    .onAppear {
      if isMatching { startPulse() }
    }
    .onChange(of: isMatching) { _, matching in
      if matching { startPulse() }
    }
  }

  private func pulseRing(scale: CGFloat, opacity: Double, size: CGFloat) -> some View {
    Circle()
      .stroke(Color.Theme.featureAccent.opacity(0.5), lineWidth: 1.5)
      .frame(width: size, height: size)
      .scaleEffect(scale)
      .opacity(opacity)
  }

  private func startPulse() {
    // Staggered expanding pulse animation
    withAnimation(.easeOut(duration: 3.0).repeatForever(autoreverses: false)) {
      pulseScale1 = 1.0
      pulseOpacity1 = 0.0
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
      withAnimation(.easeOut(duration: 3.0).repeatForever(autoreverses: false)) {
        pulseScale2 = 1.0
        pulseOpacity2 = 0.0
      }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
      withAnimation(.easeOut(duration: 3.0).repeatForever(autoreverses: false)) {
        pulseScale3 = 1.0
        pulseOpacity3 = 0.0
      }
    }
  }

  private func peerDot(peer: ProximityPeer, index: Int, total: Int, center: CGPoint, radius: CGFloat) -> some View {
    let angle = (2 * .pi / Double(total)) * Double(index) - .pi / 2
    let x = cos(angle) * Double(radius)
    let y = sin(angle) * Double(radius)

    return VStack(spacing: 2) {
      ZStack {
        Circle()
          .fill(peerColor(peer))
          .frame(width: 32, height: 32)
        Text(peerInitials(peer))
          .font(.system(size: 11, weight: .bold))
          .foregroundColor(.white)
      }
    }
    .offset(x: CGFloat(x), y: CGFloat(y))
  }

  private func peerColor(_ peer: ProximityPeer) -> Color {
    switch peer.status {
    case .connected: return Color.Theme.featureAccent
    case .connecting: return .orange
    case .disconnected: return Color.Theme.textTertiary
    }
  }

  private func peerInitials(_ peer: ProximityPeer) -> String {
    let name = peer.cardName ?? peer.name
    let parts = name.components(separatedBy: " ")
    return parts.compactMap { $0.first }.map { String($0) }.prefix(2).joined().uppercased()
  }
}
