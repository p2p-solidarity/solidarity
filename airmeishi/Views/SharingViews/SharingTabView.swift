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
  @State private var lastReceivedCardCount = 0
  @AppStorage("sharing_qr_expanded") private var isQRExpanded: Bool = true
  @AppStorage("theme_selected_animal") private var savedAvatar: String?

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
      lastReceivedCardCount = proximityManager.receivedCards.count
    }
    .onReceive(proximityManager.$receivedCards) { cards in
      guard cards.count > lastReceivedCardCount, let latest = cards.last else {
        lastReceivedCardCount = cards.count
        return
      }
      lastReceivedCardCount = cards.count
      ToastManager.shared.show(
        title: String(localized: "Card Received"),
        message: String(localized: "Received from \(latest.name)."),
        type: .success
      )
      showingReceivedCard = true
    }
    .onReceive(proximityManager.$lastError) { error in
      guard let error else { return }
      ToastManager.shared.show(
        title: String(localized: "Sharing Failed"),
        message: error.localizedDescription,
        type: .error
      )
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
    let card = cardManager.businessCards.first

    return VStack(spacing: 0) {
      // Collapsible QR code with white background
      if isQRExpanded {
        ZStack {
          if let generatedQRImage {
            Image(uiImage: generatedQRImage)
              .resizable()
              .interpolation(.none)
              .scaledToFit()
              .padding(24)
          } else {
            VStack(spacing: 10) {
              Image(systemName: "qrcode")
                .font(.system(size: 44))
                .foregroundColor(Color(white: 0.78))
              Text("Create a card to generate QR")
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(Color(white: 0.6))
            }
            .frame(maxWidth: .infinity)
            .frame(height: 200)
          }
        }
        .frame(maxWidth: .infinity)
        .aspectRatio(1, contentMode: .fit)
        .background(Color.white)
        .transition(.opacity.combined(with: .move(edge: .top)))
      }

      // Card info footer (always visible, tappable to toggle QR)
      VStack(spacing: 10) {
        // Name + avatar row
        HStack(spacing: 10) {
          profileAvatar(for: card)

          VStack(alignment: .leading, spacing: 2) {
            Text(card?.name ?? "No Card")
              .font(.system(size: 15, weight: .semibold))
              .foregroundColor(Color.Theme.textPrimary)
              .lineLimit(1)

            Text(sharedFieldsSummary)
              .font(.system(size: 11, design: .monospaced))
              .foregroundColor(Color.Theme.textTertiary)
              .lineLimit(1)
          }

          Spacer()

          // Collapse/expand chevron
          Button {
            withAnimation(.easeInOut(duration: 0.25)) {
              isQRExpanded.toggle()
            }
          } label: {
            Image(systemName: "chevron.up")
              .font(.system(size: 12, weight: .semibold))
              .foregroundColor(Color.Theme.textTertiary)
              .rotationEffect(.degrees(isQRExpanded ? 0 : 180))
              .padding(8)
              .background(Color.Theme.searchBg)
              .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
          }

          NavigationLink {
            ShareSettingsView()
          } label: {
            Image(systemName: "slider.horizontal.3")
              .font(.system(size: 14))
              .foregroundColor(Color.Theme.textSecondary)
              .padding(8)
              .background(Color.Theme.searchBg)
              .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
          }
        }

        // Proof badges
        proofBadges
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
      .background(Color.Theme.cardSurface(for: colorScheme))
    }
    .clipShape(RoundedRectangle(cornerRadius: 12))
    .overlay(
      RoundedRectangle(cornerRadius: 12)
        .stroke(Color.Theme.cardBorder(for: colorScheme), lineWidth: 1)
    )
    .shadow(color: .black.opacity(0.08), radius: 12, x: 0, y: 4)
  }

  private var sharedFieldsSummary: String {
    let fields = ShareSettingsReader.enabledFields
    let labels = fields.sorted(by: { $0.rawValue < $1.rawValue }).compactMap { field -> String? in
      switch field {
      case .name: return nil // always on, skip
      case .title: return "title"
      case .company: return "company"
      case .email: return "email"
      case .phone: return "phone"
      case .profileImage: return "photo"
      case .socialNetworks: return "socials"
      case .skills: return "skills"
      }
    }
    if labels.isEmpty { return "name only" }
    return "name + " + labels.joined(separator: ", ")
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

  @ViewBuilder
  private func profileAvatar(for card: BusinessCard?) -> some View {
    let frame: CGFloat = 32

    if let imageData = card?.profileImage,
      let uiImage = UIImage(data: imageData)
    {
      Image(uiImage: uiImage)
        .resizable()
        .scaledToFill()
        .frame(width: frame, height: frame)
        .clipShape(Circle())
        .overlay(Circle().stroke(Color.Theme.divider, lineWidth: 1))
    } else if let animal = card?.animal ?? savedAvatar.flatMap(AnimalCharacter.init(rawValue:)) {
      ImageProvider.animalImage(for: animal)
        .resizable()
        .scaledToFill()
        .frame(width: frame, height: frame)
        .clipShape(Circle())
        .overlay(Circle().stroke(Color.Theme.divider, lineWidth: 1))
    } else {
      ZStack {
        Circle()
          .fill(Color.Theme.searchBg)
          .frame(width: frame, height: frame)
        Text(initials(for: card?.name))
          .font(.system(size: 12, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textPrimary)
      }
      .overlay(Circle().stroke(Color.Theme.divider, lineWidth: 1))
    }
  }

  private func initials(for name: String?) -> String {
    guard let name, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return "?"
    }
    let parts = name.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }
    let letters = parts.compactMap(\.first).map(String.init)
    return letters.prefix(2).joined().uppercased()
  }

  // MARK: - Actions

  private func toggleMatching() {
    HapticFeedbackManager.shared.heavyImpact()
    if isMatching {
      proximityManager.disconnect()
      isMatching = false
    } else {
      let card = cardManager.businessCards.first
      proximityManager.startMatching(with: card, autoSendCardOnConnect: true)
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
      // If connection-based auto-send is enabled, avoid sending duplicate payloads on UWB trigger.
      if ProximityManager.shared.autoSendCardOnConnect {
        NearbyInteractionManager.shared.exchangeDidComplete()
        return
      }

      let baseCard = ProximityManager.shared.currentCard ?? CardManager.shared.businessCards.first
      guard let card = baseCard else {
        NearbyInteractionManager.shared.exchangeDidFail()
        return
      }
      let sharingLevel = ProximityManager.shared.currentSharingLevel
      let prepared = ShareSettingsStore.applyFields(to: card, level: sharingLevel)
      ProximityManager.shared.sendCard(
        prepared,
        to: peerID,
        sharingLevel: sharingLevel
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
