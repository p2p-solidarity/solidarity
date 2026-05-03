//
//  ConnectPeerPopupView.swift
//  solidarity
//
//  Reusable popup to confirm and track connecting to a nearby peer.
//

import SwiftUI

private enum ConnectPeerPhase: Equatable {
  case idle
  case connecting
  case connected
  case exchanging
  case success
  case error(String)
}

struct ConnectPeerPopupView: View {
  let peer: ProximityPeer
  @Binding var isPresented: Bool
  var autoDismissOnSuccess: Bool = true
  /// When true, kicks off the invite the moment the popup appears for a
  /// disconnected peer. Saves the user a redundant second tap when this
  /// popup is opened from a "Connect" button — at that point the intent is
  /// already clear.
  var autoStartConnect: Bool = true
  /// When true, kicks off a card send the moment MultipeerConnectivity reports
  /// `.connected`. This is what makes the lightning-card flow feel one-tap:
  /// user taps Connect → invite → ack → card sent → done.
  var autoExchangeOnConnect: Bool = true
  var onDismiss: (() -> Void)?

  @ObservedObject private var proximityManager = ProximityManager.shared
  @ObservedObject private var cardManager = CardManager.shared
  @Environment(\.colorScheme) private var colorScheme
  @State private var phase: ConnectPeerPhase = .idle
  @State private var displayedPeer: ProximityPeerStatus = .disconnected
  @State private var isAnimating = false
  @State private var connectStartedAt: Date?
  @State private var timeoutTask: DispatchWorkItem?
  @State private var didTriggerExchange = false

  /// MultipeerConnectivity's `invitePeer` carries a 30s timeout. We fail the
  /// popup a few seconds earlier so the user gets feedback rather than
  /// staring at an indefinite spinner if the peer never responds.
  private static let connectTimeoutSeconds: Double = 25

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
    .onAppear {
      isAnimating = true
      updateDisplayedStatus()
      // If the lightning card invoked us with the peer already connecting (because
      // auto-pilot fired the invite first), surface the connecting phase right away.
      if displayedPeer == .connecting, phase == .idle {
        phase = .connecting
        connectStartedAt = Date()
        scheduleTimeoutCheck()
      } else if displayedPeer == .connected, phase == .idle {
        phase = .connected
        triggerExchangeIfNeeded()
      } else if autoStartConnect, displayedPeer == .disconnected, phase == .idle {
        // The popup was opened from a deliberate "Connect" tap. Skip the
        // confirmation step and start inviting immediately.
        startConnect()
      }
    }
    .onDisappear {
      timeoutTask?.cancel()
      timeoutTask = nil
    }
    .onChange(of: proximityManager.nearbyPeers) { _, _ in
      handlePeerStatusChange()
    }
    .onChange(of: proximityManager.connectionStatus) { _, _ in
      handlePeerStatusChange()
    }
    .onChange(of: proximityManager.lastError) { _, newValue in
      if case let .some(.sharingError(message)) = newValue, phase != .success {
        transitionToError(message)
      }
    }
  }

  private var content: some View {
    VStack(spacing: 16) {
      header
      statusSection
      actionButtons
    }
  }

  private var header: some View {
    HStack(spacing: 12) {
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
        Text(peerInitials)
          .font(.headline)
          .fontWeight(.bold)
          .foregroundColor(.white)
        if displayedPeer == .connected {
          Circle()
            .stroke(Color.Theme.featureAccent, lineWidth: 2)
            .frame(width: 60, height: 60)
            .scaleEffect(isAnimating ? 1.1 : 1.0)
            .animation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true), value: isAnimating)
        }
      }
      VStack(alignment: .leading, spacing: 6) {
        Text(peer.cardName ?? peer.name)
          .font(.headline)
          .foregroundColor(Color.Theme.textPrimary)
          .lineLimit(1)
        if let title = peer.cardTitle { Text(title).font(.caption).foregroundColor(Color.Theme.featureAccent).lineLimit(1) }
        if let company = peer.cardCompany { Text(company).font(.caption2).foregroundColor(Color.Theme.textSecondary).lineLimit(1) }
      }
      Spacer(minLength: 8)
      Image(systemName: displayedPeer.systemImageName)
        .foregroundColor(statusColor)
    }
  }

  private var statusSection: some View {
    Group {
      switch phase {
      case .idle:
        Text("Connect to this peer to exchange cards fast.")
          .font(.subheadline)
          .foregroundColor(Color.Theme.textSecondary)
          .multilineTextAlignment(.center)
      case .connecting:
        VStack(spacing: 6) {
          HStack(spacing: 12) {
            ProgressView()
              .progressViewStyle(CircularProgressViewStyle(tint: Color.Theme.featureAccent))
            Text("Waiting for peer to accept…")
              .font(.subheadline)
              .foregroundColor(Color.Theme.textSecondary)
          }
          Text("They need to confirm on their device.")
            .font(.caption2)
            .foregroundColor(Color.Theme.textTertiary)
        }
      case .connected:
        HStack(spacing: 8) {
          Image(systemName: "link.circle.fill").foregroundColor(.green)
          Text("Connected")
            .font(.subheadline)
            .foregroundColor(Color.Theme.textSecondary)
        }
      case .exchanging:
        HStack(spacing: 12) {
          ProgressView()
            .progressViewStyle(CircularProgressViewStyle(tint: Color.Theme.featureAccent))
          Text("Sending card…")
            .font(.subheadline)
            .foregroundColor(Color.Theme.textSecondary)
        }
      case .success:
        HStack(spacing: 8) {
          Image(systemName: "checkmark.seal.fill").foregroundColor(.green)
          Text(autoExchangeOnConnect ? "Card sent!" : "Connected!")
            .font(.subheadline)
            .foregroundColor(Color.Theme.textSecondary)
        }
      case .error(let message):
        VStack(spacing: 8) {
          HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.orange)
            Text("Connection failed")
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
          Text("Cancel").frame(maxWidth: .infinity)
        }
        .buttonStyle(ThemedSecondaryButtonStyle())
        Button(action: startConnect) {
          HStack(spacing: 6) {
            Image(systemName: "link.badge.plus")
            Text("Connect").fontWeight(.semibold)
          }
          .frame(maxWidth: .infinity)
        }
        .buttonStyle(ThemedPrimaryButtonStyle())
      case .connecting:
        Button(action: cancelConnect) {
          Text("Cancel").frame(maxWidth: .infinity)
        }
        .buttonStyle(ThemedSecondaryButtonStyle())
      case .connected:
        Button(action: { dismiss() }) {
          Text("Done").frame(maxWidth: .infinity)
        }
        .buttonStyle(ThemedSecondaryButtonStyle())
        if !autoExchangeOnConnect {
          Button(action: triggerManualExchange) {
            HStack(spacing: 6) {
              Image(systemName: "paperplane.fill")
              Text("Send Card").fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
          }
          .buttonStyle(ThemedPrimaryButtonStyle())
        }
      case .exchanging:
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
        Button(action: startConnect) {
          Text("Try Again").frame(maxWidth: .infinity)
        }
        .buttonStyle(ThemedPrimaryButtonStyle())
      }
    }
  }

  private var peerInitials: String {
    let name = peer.cardName ?? peer.name
    let components = name.components(separatedBy: " ")
    let initials = components.compactMap { $0.first }.map { String($0) }
    return initials.prefix(2).joined().uppercased()
  }

  private var statusColor: Color {
    switch displayedPeer {
    case .connected: return .green
    case .connecting: return .orange
    case .disconnected: return .gray
    }
  }

  private var canTapOutsideToDismiss: Bool {
    switch phase {
    case .connecting, .exchanging: return false
    default: return true
    }
  }

  private func startConnect() {
    didTriggerExchange = false
    connectStartedAt = Date()
    withAnimation { phase = .connecting }
    proximityManager.connectToPeer(peer)
    scheduleTimeoutCheck()
  }

  private func cancelConnect() {
    timeoutTask?.cancel()
    timeoutTask = nil
    proximityManager.cancelConnectionAttempt(for: peer)
    dismiss()
  }

  private func scheduleTimeoutCheck() {
    timeoutTask?.cancel()
    let task = DispatchWorkItem {
      // Only fire if we're still spinning. Successful or already-errored state
      // shouldn't be overwritten by a stale timeout fire.
      if case .connecting = phase {
        proximityManager.cancelConnectionAttempt(for: peer)
        transitionToError(String(localized: "Peer didn't respond in time. They may have closed the app or declined."))
      }
    }
    timeoutTask = task
    DispatchQueue.main.asyncAfter(
      deadline: .now() + Self.connectTimeoutSeconds,
      execute: task
    )
  }

  private func transitionToError(_ message: String) {
    timeoutTask?.cancel()
    timeoutTask = nil
    withAnimation { phase = .error(message) }
  }

  private func triggerManualExchange() {
    triggerExchangeIfNeeded(force: true)
  }

  private func triggerExchangeIfNeeded(force: Bool = false) {
    guard force || (autoExchangeOnConnect && !didTriggerExchange) else { return }
    guard let card = cardManager.businessCards.first else {
      transitionToError(String(localized: "No identity card available. Create one in the Me tab."))
      return
    }
    didTriggerExchange = true
    withAnimation { phase = .exchanging }
    proximityManager.sendCard(card, to: peer.peerID, sharingLevel: proximityManager.currentSharingLevel)
    // Wait briefly so the data goes out via MCSession.send, then surface success.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
      guard case .exchanging = phase else { return }
      withAnimation { phase = .success }
      if autoDismissOnSuccess {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { dismiss() }
      }
    }
  }

  private func updateDisplayedStatus() {
    if let live = proximityManager.nearbyPeers.first(where: { $0.peerID == peer.peerID })?.status {
      displayedPeer = live
    } else {
      displayedPeer = peer.status
    }
  }

  private func handlePeerStatusChange() {
    let previous = displayedPeer
    updateDisplayedStatus()
    switch displayedPeer {
    case .connecting:
      if phase == .idle {
        connectStartedAt = Date()
        withAnimation { phase = .connecting }
        scheduleTimeoutCheck()
      }
    case .connected:
      timeoutTask?.cancel()
      timeoutTask = nil
      if previous != .connected {
        if autoExchangeOnConnect {
          withAnimation { phase = .connected }
          // Defer the actual send by one runloop so the SwiftUI transition lands
          // before we kick the exchange — otherwise the user sees a brief flash.
          DispatchQueue.main.async { triggerExchangeIfNeeded() }
        } else {
          withAnimation { phase = .connected }
        }
      }
    case .disconnected:
      // Was previously a no-op, which is exactly why the popup got stuck at
      // "Connecting…" forever after a timeout/decline. Treat the
      // connecting → disconnected transition as a failure and surface it.
      if case .connecting = phase, previous == .connecting {
        transitionToError(String(localized: "Peer disconnected before accepting. Please try again."))
      }
    }
  }

  private func dismiss() {
    timeoutTask?.cancel()
    timeoutTask = nil
    withAnimation { isPresented = false }
    onDismiss?()
  }
}
