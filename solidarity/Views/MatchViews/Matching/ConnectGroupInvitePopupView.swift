//
//  ConnectGroupInvitePopupView.swift
//  solidarity
//
//  Popup to accept a nearby group invite without manual matching.
//

import MultipeerConnectivity
import SwiftUI

private enum GroupInvitePhase: Equatable {
  case idle
  case accepting
  case success
  case error(String)
}

struct ConnectGroupInvitePopupView: View {
  let invite: GroupInvitePayload
  let fromPeer: MCPeerID
  @Binding var isPresented: Bool
  var autoDismissOnSuccess: Bool = true
  var onDismiss: (() -> Void)?

  @ObservedObject private var proximityManager = ProximityManager.shared
  @Environment(\.colorScheme) private var colorScheme
  @State private var phase: GroupInvitePhase = .idle

  var body: some View {
    ZStack {
      Color.Theme.overlayBg
        .ignoresSafeArea()
        .onTapGesture { if canTapOutsideToDismiss { dismiss() } }

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
  }

  private var content: some View {
    VStack(spacing: 16) {
      header
      details
      actionButtons
    }
  }

  private var header: some View {
    HStack(spacing: 12) {
      ZStack {
        Circle()
          .fill(
            LinearGradient(
              colors: [Color.Theme.dustyMauve, Color.Theme.primaryBlue],
              startPoint: .topLeading,
              endPoint: .bottomTrailing
            )
          )
          .frame(width: 54, height: 54)
        Image(systemName: "person.3.fill")
          .foregroundColor(.white)
      }
      VStack(alignment: .leading, spacing: 6) {
        Text(invite.groupName)
          .font(.headline)
          .foregroundColor(Color.Theme.textPrimary)
          .lineLimit(1)
        Text("Invite from \(fromPeer.displayName)")
          .font(.caption)
          .foregroundColor(Color.Theme.featureAccent)
          .lineLimit(1)
        if let root = invite.groupRoot, !root.isEmpty {
          Text("Root: \(root)")
            .font(.caption2)
            .foregroundColor(Color.Theme.textSecondary)
            .lineLimit(1)
        }
      }
      Spacer(minLength: 8)
      Image(systemName: "link.badge.plus")
        .foregroundColor(Color.Theme.featureAccent)
    }
  }

  private var details: some View {
    Group {
      switch phase {
      case .idle:
        Text("Accept to join this group. Your identity commitment will be sent to the inviter.")
          .font(.subheadline)
          .foregroundColor(Color.Theme.textSecondary)
          .multilineTextAlignment(.center)
      case .accepting:
        HStack(spacing: 12) {
          ProgressView().progressViewStyle(CircularProgressViewStyle(tint: Color.Theme.featureAccent))
          Text("Sending join response...")
            .font(.subheadline)
            .foregroundColor(Color.Theme.textSecondary)
        }
      case .success:
        HStack(spacing: 8) {
          Image(systemName: "checkmark.seal.fill").foregroundColor(.green)
          Text("Joined. Your card was created.")
            .font(.subheadline)
            .foregroundColor(Color.Theme.textSecondary)
        }
      case .error(let message):
        VStack(spacing: 8) {
          HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.orange)
            Text("Invite failed")
              .font(.subheadline)
              .foregroundColor(Color.Theme.textPrimary)
          }
          Text(message)
            .font(.caption)
            .foregroundColor(Color.Theme.textSecondary)
            .multilineTextAlignment(.center)
        }
      }
    }
  }

  private var actionButtons: some View {
    HStack(spacing: 12) {
      switch phase {
      case .idle:
        Button(action: { dismiss() }) {
          Text("Decline").frame(maxWidth: .infinity)
        }
        .buttonStyle(ThemedSecondaryButtonStyle())
        Button(action: accept) {
          HStack(spacing: 6) {
            Image(systemName: "hand.thumbsup.fill")
            Text("Accept").fontWeight(.semibold)
          }
          .frame(maxWidth: .infinity)
        }
        .buttonStyle(ThemedPrimaryButtonStyle())
      case .accepting:
        Button(action: { dismiss() }) {
          Text("Hide").frame(maxWidth: .infinity)
        }
        .buttonStyle(ThemedSecondaryButtonStyle())
      case .success:
        Button(action: { dismiss() }) {
          Text("Done").frame(maxWidth: .infinity)
        }
        .buttonStyle(ThemedPrimaryButtonStyle())
      case .error:
        Button(action: { dismiss() }) {
          Text("Close").frame(maxWidth: .infinity)
        }
        .buttonStyle(ThemedSecondaryButtonStyle())
      }
    }
  }

  private var canTapOutsideToDismiss: Bool {
    switch phase {
    case .accepting: return false
    default: return true
    }
  }

  private func accept() {
    withAnimation { phase = .accepting }
    // Get our identity commitment and name
    let identity = SemaphoreIdentityManager.shared.getIdentity()
    let commitment = identity?.commitment ?? ""
    let name: String = {
      if case .success(let cards) = CardManager.shared.getAllCards(), let first = cards.first { return first.name }
      return UIDevice.current.name
    }()
    if commitment.isEmpty {
      withAnimation { phase = .error(String(localized: "Missing identity commitment")) }
      return
    }
    // Defer actual send until connected by accepting the MP invite now
    proximityManager.acceptPendingGroupInvite(memberName: name, memberCommitment: commitment)
    withAnimation { phase = .success }
    if autoDismissOnSuccess {
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { dismiss() }
    }
  }

  private func dismiss() {
    withAnimation { isPresented = false }
    onDismiss?()
  }
}
