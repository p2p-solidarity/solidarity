//
//  RadarMatchingView.swift
//  solidarity
//

import SwiftUI

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
