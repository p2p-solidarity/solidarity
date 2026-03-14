//
//  SharingTabView.swift
//  airmeishi
//
//  Main sharing hub: radar matching view with peer discovery,
//  inline QR code, and Share Settings navigation.
//

import SwiftUI

struct SharingTabView: View {
  @StateObject private var proximityManager = ProximityManager.shared
  @StateObject private var cardManager = CardManager.shared
  @StateObject private var niManager = NearbyInteractionManager.shared
  @StateObject private var qrCodeManager = QRCodeManager.shared
  @Environment(\.colorScheme) private var colorScheme

  @State private var showingScanSheet = false
  @State private var showingNearbySheet = false
  @State private var showingReceivedCard = false
  @State private var isMatching = false
  @State private var showingShareActivity = false
  @State private var generatedQRImage: UIImage?

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 0) {
          // Radar hero
          RadarMatchingView(
            peers: proximityManager.nearbyPeers,
            isMatching: isMatching,
            niManager: niManager
          )
          .frame(height: 260)
          .onTapGesture {
            if !proximityManager.nearbyPeers.isEmpty {
              showingNearbySheet = true
            }
          }

          Spacer().frame(height: 16)

          // Status + matching button
          VStack(spacing: 8) {
            Text(isMatching ? "Scanning Nearby" : "Ready To Match")
              .font(.system(size: 20, weight: .bold))
              .foregroundColor(Color.Theme.textPrimary)

            Text(statusSubtitle)
              .font(.system(size: 13))
              .foregroundColor(Color.Theme.textSecondary)
              .multilineTextAlignment(.center)
              .padding(.horizontal, 40)
          }

          Spacer().frame(height: 16)

          Button(action: toggleMatching) {
            HStack(spacing: 10) {
              Image(systemName: isMatching ? "stop.fill" : "dot.radiowaves.left.and.right")
                .font(.system(size: 15, weight: .semibold))
              Text(isMatching ? "Stop Matching" : "Start Matching")
                .font(.system(size: 15, weight: .semibold))
            }
          }
          .buttonStyle(ThemedPrimaryButtonStyle())
          .padding(.horizontal, 48)

          // UWB status
          if niManager.isSupported, niManager.spatialState.isActive {
            uwbStatusPill
              .padding(.top, 10)
          }

          Spacer().frame(height: 24)

          // QR code section
          qrSection
            .padding(.horizontal, 16)

          Spacer().frame(height: 16)

          // Quick actions
          quickActions
            .padding(.horizontal, 16)

          Spacer().frame(height: 100)
        }
      }
      .background(
        LinearGradient(
          colors: Color.Theme.pageGradient(for: colorScheme),
          startPoint: .top,
          endPoint: .bottom
        )
        .ignoresSafeArea()
      )
      .navigationTitle("Share")
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
      }
    }
    .onAppear {
      setupSpatialTrigger()
      refreshQR()
    }
    .sheet(isPresented: $showingScanSheet) {
      ScanTabView()
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
    .sheet(isPresented: $showingShareActivity) {
      let text = shareText
      if !text.isEmpty {
        ShareSheet(activityItems: [text])
      }
    }
  }

  // MARK: - QR Section

  private var qrSection: some View {
    VStack(spacing: 12) {
      HStack {
        Text("MY QR")
          .font(.system(size: 12, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textTertiary)

        Spacer()

        NavigationLink {
          ShareSettingsView()
        } label: {
          HStack(spacing: 4) {
            Image(systemName: "gearshape")
              .font(.system(size: 12))
            Text("Settings")
              .font(.system(size: 12, weight: .medium))
          }
          .foregroundColor(Color.Theme.primaryBlue)
        }
      }

      Group {
        if let generatedQRImage {
          Image(uiImage: generatedQRImage)
            .resizable()
            .interpolation(.none)
            .scaledToFit()
        } else {
          VStack(spacing: 8) {
            Image(systemName: "qrcode")
              .font(.system(size: 36))
              .foregroundColor(Color.Theme.textTertiary)
            Text("Create a card to generate QR")
              .font(.system(size: 12))
              .foregroundColor(Color.Theme.textTertiary)
          }
          .frame(maxWidth: .infinity)
          .frame(height: 180)
        }
      }
      .frame(maxWidth: .infinity)
      .aspectRatio(1, contentMode: .fit)
      .padding(10)
      .background(Color.white)
      .cornerRadius(8)

      // Active proof badges
      proofBadges
    }
    .padding(16)
    .background(Color.Theme.cardSurface(for: colorScheme))
    .overlay(Rectangle().stroke(Color.Theme.cardBorder(for: colorScheme), lineWidth: 1))
  }

  private var proofBadges: some View {
    let claims = IdentityDataStore.shared.provableClaims.filter { $0.issuerType == "government" }
    return Group {
      if !claims.isEmpty {
        HStack(spacing: 8) {
          if ShareSettingsReader.shareIsHuman,
             claims.contains(where: { $0.claimType == "is_human" }) {
            proofPill(label: "Real Human", color: Color.Theme.terminalGreen)
          }
          if ShareSettingsReader.shareAgeOver18,
             claims.contains(where: { $0.claimType == "age_over_18" }) {
            proofPill(label: "Age 18+", color: Color.Theme.terminalGreen)
          }
          Spacer()
        }
      }
    }
  }

  private func proofPill(label: String, color: Color) -> some View {
    HStack(spacing: 4) {
      Circle()
        .fill(color)
        .frame(width: 6, height: 6)
      Text(label)
        .font(.system(size: 11, weight: .semibold, design: .monospaced))
        .foregroundColor(color)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 4)
    .background(
      Capsule()
        .fill(color.opacity(0.12))
    )
  }

  // MARK: - Quick Actions

  private var quickActions: some View {
    HStack(spacing: 12) {
      Button {
        showingScanSheet = true
      } label: {
        HStack(spacing: 8) {
          Image(systemName: "qrcode.viewfinder")
            .font(.system(size: 16, weight: .semibold))
          Text("Scan QR")
            .font(.system(size: 14, weight: .semibold))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .foregroundColor(Color.Theme.textPrimary)
        .background(Color.Theme.searchBg)
        .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
      }
      .buttonStyle(.plain)

      Button {
        showingShareActivity = true
      } label: {
        HStack(spacing: 8) {
          Image(systemName: "square.and.arrow.up")
            .font(.system(size: 16, weight: .semibold))
          Text("Share")
            .font(.system(size: 14, weight: .semibold))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .foregroundColor(Color.Theme.textPrimary)
        .background(Color.Theme.searchBg)
        .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
      }
      .buttonStyle(.plain)
    }
  }

  private var shareText: String {
    guard let card = cardManager.businessCards.first else { return "" }
    let filtered = card.filteredCard(for: ShareSettingsReader.enabledFields)
    return filtered.vCardData
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
      return "Searching for nearby peers..."
    }
    return "Start matching to discover nearby people."
  }

  private func refreshQR() {
    guard let card = cardManager.businessCards.first else {
      generatedQRImage = nil
      return
    }
    let fields = ShareSettingsReader.enabledFields
    let result = qrCodeManager.generateQRCode(for: card, fields: fields)
    if case .success(let image) = result {
      generatedQRImage = image
    }
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

// MARK: - Radar Matching View (kept from original)

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
          peerDot(peer: peer, index: index, total: min(peers.count, 8), radius: size * 0.35)
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

  private func peerDot(peer: ProximityPeer, index: Int, total: Int, radius: CGFloat) -> some View {
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
