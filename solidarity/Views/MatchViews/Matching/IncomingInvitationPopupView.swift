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
    let animal = peer?.cardAnimal ?? AnimalCharacter.default(forId: invitation.peerID.displayName)
    let statusColor: Color = {
      switch status {
      case .connected: return Color.Theme.terminalGreen
      case .connecting: return Color.Theme.warning
      case .disconnected: return Color.Theme.textTertiary
      }
    }()
    return HStack(spacing: 12) {
      ZStack {
        Circle()
          .fill(Color.Theme.searchBg)
          .frame(width: 54, height: 54)
        ImageProvider.animalImage(for: animal)
          .resizable()
          .scaledToFill()
          .frame(width: 54, height: 54)
          .clipShape(Circle())
        Circle()
          .stroke(statusColor, lineWidth: 1)
          .frame(width: 54, height: 54)
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
