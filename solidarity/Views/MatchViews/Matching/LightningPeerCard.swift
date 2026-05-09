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
      .padding(14)
      .background(
        RoundedRectangle(cornerRadius: 12)
          .fill(Color.Theme.mutedSurface)
          .overlay(
            Group {
              if peer.status == .connected {
                RoundedRectangle(cornerRadius: 12)
                  .stroke(Color.Theme.featureAccent.opacity(0.4), lineWidth: 1)
              }
            }
          )
      )
      .animation(.easeInOut(duration: 0.25), value: peer.status)
    }
    .buttonStyle(PlainButtonStyle())
    .onHover { hovering in isHovering = hovering }
  }

  private var header: some View {
    HStack {
      ZStack {
        Circle()
          .fill(Color.Theme.searchBg)
          .frame(width: 50, height: 50)
        ImageProvider.animalImage(for: peer.cardAnimal)
          .resizable()
          .scaledToFill()
          .frame(width: 50, height: 50)
          .clipShape(Circle())
        Circle()
          .stroke(statusColor, lineWidth: 1)
          .frame(width: 50, height: 50)
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
          }
          Text(peer.status.rawValue)
            .font(.system(size: 12))
            .foregroundColor(Color.Theme.textPrimary)
        }
        if let verification = peer.verification {
          HStack(spacing: 2) {
            Image(systemName: verification.systemImageName)
              .font(.system(size: 12))
              .foregroundColor(verificationColor)
            Text(verification.displayName)
              .font(.system(size: 12))
              .foregroundColor(Color.Theme.textSecondary)
          }
        } else if peer.discoveryInfo["zk"] == "1" {
          HStack(spacing: 2) {
            Image(systemName: "shield.checkerboard")
              .font(.system(size: 12))
              .foregroundColor(Color.Theme.primaryBlue)
            Text("ZK Ready")
              .font(.system(size: 12))
              .foregroundColor(Color.Theme.textSecondary)
          }
        }
      }
    }
  }

  private var info: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(peer.cardName ?? peer.name)
        .font(.system(size: 16, weight: .semibold))
        .foregroundColor(Color.Theme.textPrimary)
        .lineLimit(1)
      if let title = peer.cardTitle {
        Text(title)
          .font(.system(size: 12))
          .foregroundColor(Color.Theme.featureAccent)
          .lineLimit(1)
      }
      if let company = peer.cardCompany {
        Text(company)
          .font(.system(size: 12))
          .foregroundColor(Color.Theme.textSecondary)
          .lineLimit(1)
      }
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
        .foregroundColor(peer.status == .connected ? Color.Theme.terminalGreen : Color.Theme.textTertiary)
        .font(.system(size: 12))
    }
  }

  private var connectButton: some View {
    Button(action: { onConnect?() }) {
      HStack(spacing: 6) {
        Image(systemName: "link.badge.plus")
        Text("Connect").fontWeight(.semibold)
      }
      .font(.system(size: 12, weight: .semibold))
      .foregroundColor(.white)
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
      .background(Color.Theme.primaryBlue)
      .clipShape(Capsule())
      .shadow(color: Color.Theme.primaryBlue.opacity(0.2), radius: 4, x: 0, y: 2)
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
    .font(.system(size: 12, weight: .semibold))
    .foregroundColor(.white)
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .background(Color.Theme.warning)
    .clipShape(Capsule())
  }

  @ViewBuilder
  private var sendCardButton: some View {
    if let onSendCard {
      Button(action: { onSendCard() }) {
        HStack(spacing: 6) {
          Image(systemName: "paperplane.fill")
          Text("Send").fontWeight(.semibold)
        }
        .font(.system(size: 12, weight: .semibold))
        .foregroundColor(.white)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.Theme.terminalGreen)
        .clipShape(Capsule())
        .shadow(color: Color.Theme.terminalGreen.opacity(0.2), radius: 4, x: 0, y: 2)
      }
      .buttonStyle(PlainButtonStyle())
    }
  }

  @ViewBuilder
  private var disconnectButton: some View {
    if let onDisconnect {
      Button(action: { onDisconnect() }) {
        Image(systemName: "xmark.circle.fill")
          .font(.system(size: 14))
          .foregroundColor(Color.Theme.textSecondary)
          .padding(8)
          .background(Color.Theme.searchBg)
          .clipShape(Circle())
      }
      .buttonStyle(PlainButtonStyle())
    }
  }

  private var statusColor: Color {
    switch peer.status {
    case .connected: return Color.Theme.terminalGreen
    case .connecting: return Color.Theme.warning
    case .disconnected: return Color.Theme.textTertiary
    }
  }

  private var verificationColor: Color {
    if let verification = peer.verification {
      switch verification {
      case .verified: return Color.Theme.terminalGreen
      case .pending: return Color.Theme.warning
      case .unverified: return Color.Theme.primaryBlue
      case .failed: return Color.Theme.destructive
      }
    }
    return Color.Theme.primaryBlue
  }
}
