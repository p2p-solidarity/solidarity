//
//  IncomingInvitationPopupView.swift
//  solidarity
//
//  Popup to request consent for incoming proximity connection.
//

import MultipeerConnectivity
import SwiftUI

struct IncomingInvitationPopupView: View {
  let invitation: PendingInvitation
  let onAccept: () -> Void
  let onDecline: () -> Void
  let onDismiss: () -> Void

  @ObservedObject private var proximityManager = ProximityManager.shared
  @Environment(\.colorScheme) private var colorScheme
  @State private var isAnimating = false
  @State private var didRespond = false

  var body: some View {
    ZStack {
      Color.Theme.overlayBg.ignoresSafeArea()
      content
        .padding(20)
        .background(
          RoundedRectangle(cornerRadius: 20)
            .fill(Color.Theme.popupSurface.opacity(0.95))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.Theme.cardBorder(for: colorScheme), lineWidth: 1))
        )
        .padding(.horizontal, 24)
        .shadow(color: Color.black.opacity(0.2), radius: 20, x: 0, y: 10)
    }
    .onAppear { isAnimating = true }
    .onDisappear { onDismiss() }
  }

  private var content: some View {
    VStack(spacing: 16) {
      header
      Text("wants to connect with you")
        .font(.subheadline)
        .foregroundColor(Color.Theme.textSecondary)
      actionButtons
    }
  }

  private var header: some View {
    let peer = proximityManager.nearbyPeers.first(where: { $0.peerID == invitation.peerID })
    let name = peer?.cardName ?? peer?.name ?? invitation.peerID.displayName
    let title = peer?.cardTitle
    let company = peer?.cardCompany
    let status = peer?.status ?? .disconnected
    let initials = name.split(separator: " ").compactMap { $0.first }.map(String.init).prefix(2).joined().uppercased()
    let statusColor: Color = {
      switch status {
      case .connected: return .green
      case .connecting: return .orange
      case .disconnected: return .gray
      }
    }()
    return HStack(spacing: 12) {
      ZStack {
        Circle()
          .fill(
            LinearGradient(
              colors: [statusColor, statusColor.opacity(0.6)],
              startPoint: .topLeading,
              endPoint: .bottomTrailing
            )
          )
          .frame(width: 54, height: 54)
        Text(initials)
          .font(.headline)
          .fontWeight(.bold)
          .foregroundColor(.white)
        Circle()
          .stroke(Color.Theme.featureAccent, lineWidth: 2)
          .frame(width: 60, height: 60)
          .scaleEffect(isAnimating ? 1.1 : 1.0)
          .animation(
            .easeInOut(duration: 0.6).repeatForever(autoreverses: true),
            value: isAnimating
          )
      }
      VStack(alignment: .leading, spacing: 6) {
        Text(name).font(.headline).foregroundColor(Color.Theme.textPrimary).lineLimit(1)
        if let title = title { Text(title).font(.caption).foregroundColor(Color.Theme.featureAccent).lineLimit(1) }
        if let company = company { Text(company).font(.caption2).foregroundColor(Color.Theme.textSecondary).lineLimit(1) }
      }
      Spacer(minLength: 8)
      Image(systemName: status.systemImageName).foregroundColor(statusColor)
    }
  }

  private var actionButtons: some View {
    HStack(spacing: 12) {
      Button(action: {
        guard !didRespond else { return }
        didRespond = true
        onDecline()
      }) {
        Text("Decline").frame(maxWidth: .infinity)
      }
      .buttonStyle(ThemedSecondaryButtonStyle())
      Button(action: {
        guard !didRespond else { return }
        didRespond = true
        onAccept()
      }) {
        HStack(spacing: 6) {
          Image(systemName: "hand.thumbsup.fill")
          Text("Accept").fontWeight(.semibold)
        }
        .frame(maxWidth: .infinity)
      }
      .buttonStyle(ThemedPrimaryButtonStyle())
    }
  }
}
