//
//  SharingTabView.swift
//  solidarity
//
//  Main sharing hub: radar matching view with peer discovery,
//  inline QR code, and Share Settings navigation.
//

import SwiftUI

struct SharingTabView: View {
  @StateObject private var proximityManager = ProximityManager.shared
  @StateObject var cardManager = CardManager.shared
  @StateObject private var niManager = NearbyInteractionManager.shared
  @StateObject private var qrCodeManager = QRCodeManager.shared
  @Environment(\.colorScheme) var colorScheme

  @State var showingScanSheet = false
  @State private var showingNearbySheet = false
  @State private var showingReceivedCard = false
  @State private var isMatching = false
  @State var showingShareActivity = false
  @State var generatedQRImage: UIImage?
  @State private var lastReceivedCardCount = 0
  /// Tracks the field set last used to render the QR. Lets the
  /// UserDefaults observer skip refreshes that don't actually change the
  /// visible payload (e.g. unrelated AppStorage writes).
  @State private var lastRenderedFields: Set<BusinessCardField> = []
  @AppStorage("sharing_qr_expanded") var isQRExpanded: Bool = true
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

          Spacer().frame(height: 100)
        }
      }
      .background(Color.Theme.pageBg.ignoresSafeArea())
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
    // Re-render the QR when the underlying card mutates (edits in Me tab,
    // sharingPreferences format change, etc.). `.onAppear` only catches
    // re-entry from navigation, not in-place updates.
    .onReceive(cardManager.$businessCards) { _ in
      refreshQR()
    }
    // ShareSettings writes through @AppStorage → UserDefaults. Without
    // this observer the QR stays stale after the user toggles a field
    // and pops back, because @AppStorage writes don't republish through
    // any object SharingTabView observes. We dedupe against the last
    // rendered field set so unrelated UserDefaults writes (theme,
    // notification prefs, etc.) don't trigger needless QR regeneration.
    .onReceive(
      NotificationCenter.default
        .publisher(for: UserDefaults.didChangeNotification)
        .receive(on: DispatchQueue.main)
    ) { _ in
      let current = ShareSettingsReader.enabledFields
      guard current != lastRenderedFields else { return }
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

  private var shareText: String {
    guard let card = cardManager.businessCards.first else { return "" }
    let filtered = card.filteredCard(for: ShareSettingsReader.enabledFields)
    return filtered.vCardData
  }

  @ViewBuilder
  func profileAvatar(for card: BusinessCard?) -> some View {
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
    } else if let card {
      // Always render an animal: chosen → saved → stable default from card.id.
      // Letter initials would surface here when the user resumed onboarding
      // mid-flow (selectedAvatar lost) or restored a legacy backup.
      let animal = card.animal
        ?? savedAvatar.flatMap(AnimalCharacter.init(rawValue:))
        ?? AnimalCharacter.default(forId: card.id.uuidString)
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
        Image(systemName: "person")
          .font(.system(size: 14, weight: .semibold))
          .foregroundColor(Color.Theme.textTertiary)
      }
      .overlay(Circle().stroke(Color.Theme.divider, lineWidth: 1))
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
      proximityManager.startMatching(with: card, autoSendCardOnConnect: true)
      isMatching = true
    }
  }

  private var statusSubtitle: String {
    if isMatching {
      let count = proximityManager.nearbyPeers.count
      if count > 0 {
        if count == 1 {
          return String(localized: "Found 1 nearby peer. Tap the radar to connect.")
        }
        return String(localized: "Found \(count) nearby peers. Tap the radar to connect.")
      }
      return String(localized: "Searching for nearby peers...")
    }
    return String(localized: "Start matching to discover nearby people.")
  }

  private func refreshQR() {
    guard let card = cardManager.businessCards.first else {
      generatedQRImage = nil
      lastRenderedFields = []
      return
    }
    let fields = ShareSettingsReader.enabledFields
    lastRenderedFields = fields
    switch qrCodeManager.generateQRCode(for: card, fields: fields) {
    case .success(let image):
      generatedQRImage = image
    case .failure(let error):
      // Old behaviour was `if case .success` only — failures left a stale
      // image with no signal to the user. Clear the image so the QR card
      // reverts to the placeholder, and surface the message via Toast
      // (same channel used for the other QR / sharing errors above).
      generatedQRImage = nil
      ToastManager.shared.show(
        title: String(localized: "QR Generation Failed"),
        message: error.localizedDescription,
        type: .error
      )
    }
  }

  // MARK: - UWB

  private func setupSpatialTrigger() {
    niManager.onSpatialTrigger = { peerID in
      ProximityManager.shared.handleSpatialTrigger(peerID: peerID)
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
