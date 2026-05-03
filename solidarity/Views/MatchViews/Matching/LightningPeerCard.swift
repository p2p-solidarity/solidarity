//
//  LighteningPeerCard.swift
//  solidarity
//
//  Card cell showing a peer with status-aware actions (Connect / Connecting /
//  Send Card · Disconnect). Drives the lightning-card flow inside
//  `NearbyPeersSheet`.
//

import SwiftUI

struct LighteningPeerCard: View {
  let peer: ProximityPeer
  let isLighteningAnimating: Bool
  let onTap: () -> Void
  let onConnect: (() -> Void)?
  /// Invoked when the user taps "Send Card" on a connected peer. Optional —
  /// callers that don't want to expose a manual send (e.g. screens that
  /// auto-exchange) can leave it nil.
  var onSendCard: (() -> Void)?
  /// Invoked when the user taps "Disconnect" on a connected peer.
  var onDisconnect: (() -> Void)?

  @Environment(\.colorScheme) private var colorScheme
  @State private var isHovering = false

  var body: some View {
    Button(action: onTap) {
      VStack(spacing: 12) {
        header
        info
        footer
      }
      .padding(16)
      .background(
        RoundedRectangle(cornerRadius: 16)
          .fill(Color.Theme.cardSurface(for: colorScheme))
          .overlay(
            RoundedRectangle(cornerRadius: 16)
              .stroke(borderColor, lineWidth: peer.status == .connected ? 1.5 : 1)
          )
      )
      .scaleEffect(isHovering ? 1.05 : 1.0)
      .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovering)
      .animation(.easeInOut(duration: 0.25), value: peer.status)
    }
    .buttonStyle(PlainButtonStyle())
    .onHover { hovering in isHovering = hovering }
  }

  private var header: some View {
    HStack {
      ZStack {
        Circle()
          .fill(
            LinearGradient(
              colors: [statusColor, statusColor.opacity(0.6)],
              startPoint: .topLeading,
              endPoint: .bottomTrailing
            )
          )
          .frame(width: 50, height: 50)
        Text(peerAvatarInitials).font(.headline).fontWeight(.bold).foregroundColor(.white)
        if peer.status == .connected {
          Circle()
            .stroke(Color.Theme.featureAccent, lineWidth: 2)
            .frame(width: 56, height: 56)
            .scaleEffect(isLighteningAnimating ? 1.1 : 1.0)
            .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: isLighteningAnimating)
        }
      }
      Spacer()
      VStack(alignment: .trailing, spacing: 4) {
        HStack(spacing: 4) {
          if peer.status == .connecting {
            ProgressView()
              .progressViewStyle(CircularProgressViewStyle(tint: statusColor))
              .scaleEffect(0.6)
              .frame(width: 8, height: 8)
          } else {
            Circle().fill(statusColor).frame(width: 8, height: 8)
              .scaleEffect(isLighteningAnimating ? 1.2 : 1.0)
              .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: isLighteningAnimating)
          }
          Text(peer.status.rawValue).font(.caption2).foregroundColor(Color.Theme.textPrimary)
        }
        if let verification = peer.verification {
          HStack(spacing: 2) {
            Image(systemName: verification.systemImageName).font(.caption2).foregroundColor(verificationColor)
            Text(verification.displayName).font(.caption2).foregroundColor(Color.Theme.textSecondary)
          }
        } else if peer.discoveryInfo["zk"] == "1" {
          HStack(spacing: 2) {
            Image(systemName: "shield.checkerboard").font(.caption2).foregroundColor(Color.Theme.primaryBlue)
            Text("ZK Ready").font(.caption2).foregroundColor(Color.Theme.textSecondary)
          }
        }
      }
    }
  }

  private var info: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(peer.cardName ?? peer.name).font(.headline).fontWeight(.semibold).foregroundColor(Color.Theme.textPrimary).lineLimit(1)
      if let title = peer.cardTitle { Text(title).font(.caption).foregroundColor(Color.Theme.featureAccent).lineLimit(1) }
      if let company = peer.cardCompany { Text(company).font(.caption2).foregroundColor(Color.Theme.textSecondary).lineLimit(1) }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder
  private var footer: some View {
    HStack(spacing: 8) {
      switch peer.status {
      case .disconnected:
        connectButton
        Spacer()
      case .connecting:
        connectingPill
        Spacer()
      case .connected:
        sendCardButton
        disconnectButton
      }
      Image(systemName: "bolt.fill")
        .foregroundColor(isLighteningAnimating ? Color.Theme.featureAccent : Color.Theme.textSecondary)
        .font(.caption)
        .scaleEffect(isLighteningAnimating ? 1.2 : 1.0)
        .animation(.easeInOut(duration: 0.3).repeatForever(autoreverses: true), value: isLighteningAnimating)
    }
  }

  private var connectButton: some View {
    Button(action: { onConnect?() }) {
      HStack(spacing: 6) {
        Image(systemName: "link.badge.plus")
        Text("Connect").fontWeight(.semibold)
      }
      .font(.caption)
      .foregroundColor(.white)
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
      .background(Color.Theme.primaryBlue)
      .clipShape(Capsule())
      .overlay(
        Capsule().stroke(Color.Theme.cardBorder(for: colorScheme), lineWidth: 1)
      )
      .shadow(color: Color.Theme.primaryBlue.opacity(0.3), radius: 6, x: 0, y: 2)
    }
    .buttonStyle(PlainButtonStyle())
  }

  private var connectingPill: some View {
    HStack(spacing: 6) {
      ProgressView()
        .progressViewStyle(CircularProgressViewStyle(tint: .white))
        .scaleEffect(0.65)
      Text("Connecting…").fontWeight(.semibold)
    }
    .font(.caption)
    .foregroundColor(.white)
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .background(Color.orange)
    .clipShape(Capsule())
    .overlay(Capsule().stroke(Color.orange.opacity(0.6), lineWidth: 1))
  }

  @ViewBuilder
  private var sendCardButton: some View {
    if let onSendCard {
      Button(action: { onSendCard() }) {
        HStack(spacing: 6) {
          Image(systemName: "paperplane.fill")
          Text("Send").fontWeight(.semibold)
        }
        .font(.caption)
        .foregroundColor(.white)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.green)
        .clipShape(Capsule())
        .shadow(color: Color.green.opacity(0.3), radius: 6, x: 0, y: 2)
      }
      .buttonStyle(PlainButtonStyle())
    }
  }

  @ViewBuilder
  private var disconnectButton: some View {
    if let onDisconnect {
      Button(action: { onDisconnect() }) {
        Image(systemName: "xmark.circle.fill")
          .font(.caption)
          .foregroundColor(Color.Theme.textSecondary)
          .padding(8)
          .background(Color.Theme.searchBg)
          .clipShape(Circle())
      }
      .buttonStyle(PlainButtonStyle())
    }
  }

  private var peerAvatarInitials: String {
    let name = peer.cardName ?? peer.name
    let components = name.components(separatedBy: " ")
    let initials = components.compactMap { $0.first }.map { String($0) }
    return initials.prefix(2).joined().uppercased()
  }

  private var statusColor: Color {
    switch peer.status {
    case .connected: return .green
    case .connecting: return .orange
    case .disconnected: return .gray
    }
  }

  private var borderColor: Color {
    switch peer.status {
    case .connected: return Color.Theme.featureAccent.opacity(0.5)
    case .connecting: return Color.orange.opacity(0.5)
    case .disconnected:
      return isLighteningAnimating
        ? Color.Theme.featureAccent.opacity(0.3)
        : Color.Theme.cardBorder(for: colorScheme)
    }
  }

  private var verificationColor: Color {
    if let verification = peer.verification {
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
