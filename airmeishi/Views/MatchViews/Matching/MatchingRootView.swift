//
//  MatchingRootView.swift
//  airmeishi
//
//  Root view hosting orbit UI and sheets; small and reusable.
//

import SwiftUI

struct MatchingRootView: View {
  @StateObject private var proximityManager = ProximityManager.shared
  @StateObject private var cardManager = CardManager.shared
  @StateObject private var niManager = NearbyInteractionManager.shared
  @ObservedObject private var webRTCManager = WebRTCManager.shared
  @Environment(\.colorScheme) private var colorScheme
  @State private var rotateOuter = false
  @State private var rotateMiddle = false
  @State private var rotateInner = false
  @State private var showNearbySheet = false
  @State private var showPeerCardSheet = false
  @State private var showShareSheet = false

  var body: some View {
    ZStack {
      Circle().stroke(Color.Theme.divider, lineWidth: 2).padding(4)
      Circle().stroke(Color.Theme.divider, lineWidth: 2).padding(44)
      Circle().stroke(Color.Theme.divider, lineWidth: 2).padding(84)
      Button(action: { showNearbySheet = true }) {
        ZStack {
          Circle().fill(Color.Theme.cardSurface(for: colorScheme)).frame(width: 96, height: 96)
            .overlay(Circle().stroke(Color.Theme.cardBorder(for: colorScheme), lineWidth: 1))
          VStack(spacing: 2) {
            Text("Nearby").font(.system(size: 12, weight: .semibold)).foregroundColor(Color.Theme.textPrimary)
            Text("\(proximityManager.nearbyPeers.count)").font(.system(size: 14, weight: .bold)).foregroundColor(Color.Theme.textPrimary)
          }
        }
      }
      .buttonStyle(PlainButtonStyle())
      orbit(radiusPadding: 4, size: 18).rotationEffect(.degrees(rotateOuter ? 360 : 0))
        .animation(.linear(duration: 14).repeatForever(autoreverses: false), value: rotateOuter)
      orbit(radiusPadding: 44, size: 16).rotationEffect(.degrees(rotateMiddle ? -360 : 0))
        .animation(.linear(duration: 10).repeatForever(autoreverses: false), value: rotateMiddle)
      orbit(radiusPadding: 84, size: 14).rotationEffect(.degrees(rotateInner ? 360 : 0))
        .animation(.linear(duration: 7).repeatForever(autoreverses: false), value: rotateInner)
    }
    .onAppear {
      rotateOuter = true
      rotateMiddle = true
      rotateInner = true
      setupSpatialTrigger()
    }
    .overlay(spatialStatusOverlay)
    .overlay(sakuraOverlay)
    .overlay(latestMessageOverlay)
    .overlay(incomingInvitationOverlay)
    .sheet(isPresented: $showNearbySheet) {
      NearbyPeersSheet(
        peers: proximityManager.nearbyPeers,
        connectedCount: proximityManager.getSharingStatus().connectedPeersCount,
        onViewLatestCard: {
          // Always open latest card sheet, even if nil -> progress state
          showPeerCardSheet = true
        },
        onSendInvitation: { peer in
          proximityManager.connectToPeer(peer)
        },
        onHandleViewLatestCard: {
          showPeerCardSheet = true
        }
      )
    }
    .sheet(isPresented: $showPeerCardSheet) {
      if let card = proximityManager.receivedCards.last {
        ReceivedCardView(card: card)
      } else {
        VStack(spacing: 16) {
          ProgressView().progressViewStyle(CircularProgressViewStyle(tint: .gray))
          Text("Waiting for peer's card...").font(.body).foregroundColor(.secondary).padding(.horizontal)
        }
        .padding()
      }
    }
    .sheet(isPresented: $showShareSheet) {
      ShareCardPickerSheet(
        cards: cardManager.businessCards,
        onStart: { card, level in proximityManager.startAdvertising(with: card, sharingLevel: level) },
        onStop: { proximityManager.stopAdvertising() },
        isAdvertising: proximityManager.getSharingStatus().isAdvertising
      )
    }
  }

  /*
  private var shareButton: some View {
      VStack {
          Spacer()
          HStack {
              Spacer()
              Button(action: { showShareSheet = true }) {
                  HStack(spacing: 8) {
                      Image(systemName: proximityManager.getSharingStatus().isAdvertising ? "antenna.radiowaves.left.and.right" : "paperplane")
                      Text(proximityManager.getSharingStatus().isAdvertising ? "Sharing" : "Share").fontWeight(.semibold)
                  }
                  .padding(.horizontal, 14).padding(.vertical, 10)
                  .background(Color.white.opacity(0.2))
                  .foregroundColor(.white)
                  .clipShape(Capsule())
              }
              .padding()
          }
      }
  }
  */

  private var sakuraOverlay: some View {
    VStack {
      Spacer()
      // Only show if WebRTC data channel is actually open
      if webRTCManager.isChannelOpen {
        Button(action: {
          webRTCManager.sendSakura()
          // Also trigger local effect
          withAnimation {
            // TODO: Add local visual effect
          }
        }) {
          Text("🌸")
            .font(.system(size: 40))
            .padding()
            .background(Color.Theme.cardSurface(for: colorScheme))
            .clipShape(Circle())
        }
        .padding(.bottom, 100)
      }
    }
  }

  private var latestMessageOverlay: some View {
    VStack {
      if let message = webRTCManager.latestMessage {
        Text(message.content)
          .font(.largeTitle)
          .padding()
          .background(Color.Theme.overlayBg)
          .cornerRadius(10)
          .foregroundColor(Color.Theme.textPrimary)
          .transition(.scale.combined(with: .opacity))
          .id(message.timestamp)  // Force transition on new message
      }
      Spacer()
    }
    .padding(.top, 60)
    .animation(.spring(), value: webRTCManager.latestMessage?.timestamp)
  }

  private func orbit(radiusPadding: CGFloat, size: CGFloat) -> some View {
    GeometryReader { proxy in
      let frame = proxy.size
      let minSide = min(frame.width, frame.height)
      let radius = (minSide / 2) - radiusPadding
      ZStack {
        satellite(size: size).offset(x: radius, y: 0)
        satellite(size: size).offset(x: 0, y: radius)
        satellite(size: size).offset(x: -radius * 0.9, y: -radius * 0.4)
        satellite(size: size).offset(x: radius * 0.4, y: -radius * 0.85)
      }
      .frame(width: frame.width, height: frame.height)
    }
  }

  private func satellite(size: CGFloat) -> some View {
    Circle().fill(Color.Theme.textPrimary.opacity(0.8)).frame(width: size, height: size)
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

  // MARK: - UWB Spatial Trigger

  private func setupSpatialTrigger() {
    niManager.onSpatialTrigger = { [weak proximityManager] peerID in
      guard let pm = proximityManager,
            let card = pm.currentCard else {
        NearbyInteractionManager.shared.exchangeDidFail()
        return
      }
      pm.sendCard(card, to: peerID, sharingLevel: pm.currentSharingLevel)
      NearbyInteractionManager.shared.exchangeDidComplete()
    }
  }

  private var spatialStatusOverlay: some View {
    VStack {
      if niManager.isSupported, niManager.spatialState.isActive {
        HStack(spacing: 8) {
          Circle()
            .fill(spatialStateColor)
            .frame(width: 8, height: 8)
          Text(spatialStateLabel)
            .font(.caption)
            .fontWeight(.medium)
            .foregroundColor(Color.Theme.textPrimary)
          if let distance = niManager.currentDistance {
            Text(String(format: "%.0f cm", distance * 100))
              .font(.caption2)
              .foregroundColor(Color.Theme.textSecondary)
          }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(
          Capsule()
            .fill(Color.Theme.cardSurface(for: colorScheme))
            .overlay(Capsule().stroke(spatialStateColor.opacity(0.5), lineWidth: 1))
        )
        .transition(.scale.combined(with: .opacity))
      }
      Spacer()
    }
    .padding(.top, 8)
    .animation(.spring(), value: niManager.spatialState)
  }

  private var spatialStateColor: Color {
    switch niManager.spatialState {
    case .approaching: return .orange
    case .confirmed, .exchanging: return .green
    default: return .gray
    }
  }

  private var spatialStateLabel: String {
    switch niManager.spatialState {
    case .approaching(let frames):
      let total = niManager.config.requiredFrames
      return "Detecting... (\(frames)/\(total))"
    case .confirmed:
      return "Contact!"
    case .exchanging:
      return "Exchanging..."
    default:
      return niManager.spatialState.displayName
    }
  }
}
