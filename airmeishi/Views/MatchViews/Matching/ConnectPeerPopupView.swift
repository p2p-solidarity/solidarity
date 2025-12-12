//
//  ConnectPeerPopupView.swift
//  airmeishi
//
//  Reusable popup to confirm and track connecting to a nearby peer.
//

import SwiftUI

private enum ConnectPeerPhase: Equatable {
    case idle
    case connecting
    case success
    case error(String)
}

struct ConnectPeerPopupView: View {
    let peer: ProximityPeer
    @Binding var isPresented: Bool
    var autoDismissOnSuccess: Bool = true
    var onDismiss: (() -> Void)?

    @ObservedObject private var proximityManager = ProximityManager.shared
    @State private var phase: ConnectPeerPhase = .idle
    @State private var displayedPeer: ProximityPeerStatus = .disconnected
    @State private var isAnimating = false

    var body: some View {
        ZStack {
            Color.black.opacity(0.5)
                .ignoresSafeArea()
                .onTapGesture { if canTapOutsideToDismiss { dismiss() } }

            content
                .padding(20)
                .background(
                    RoundedRectangle(cornerRadius: 20)
                        .fill(Color(.secondarySystemBackground).opacity(0.95))
                        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.white.opacity(0.1), lineWidth: 1))
                )
                .padding(.horizontal, 24)
                .shadow(color: Color.black.opacity(0.3), radius: 20, x: 0, y: 10)
        }
        .onAppear {
            isAnimating = true
            updateDisplayedStatus()
        }
        .onChange(of: proximityManager.nearbyPeers) { _, _ in
            handlePeerStatusChange()
        }
        .onChange(of: proximityManager.connectionStatus) { _, _ in
            handlePeerStatusChange()
        }
        .onChange(of: proximityManager.lastError) { _, newValue in
            if case let .some(.sharingError(message)) = newValue {
                withAnimation { phase = .error(message) }
            }
        }
    }

    private var content: some View {
        VStack(spacing: 16) {
            header
            statusSection
            actionButtons
        }
        .preferredColorScheme(.dark)
    }

    private var header: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(LinearGradient(colors: [statusColor, statusColor.opacity(0.6)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 54, height: 54)
                Text(peerInitials)
                    .font(.headline)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                if displayedPeer == .connected {
                    Circle()
                        .stroke(Color.yellow, lineWidth: 2)
                        .frame(width: 60, height: 60)
                        .scaleEffect(isAnimating ? 1.1 : 1.0)
                        .animation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true), value: isAnimating)
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(peer.cardName ?? peer.name)
                    .font(.headline)
                    .foregroundColor(.white)
                    .lineLimit(1)
                if let title = peer.cardTitle { Text(title).font(.caption).foregroundColor(.yellow).lineLimit(1) }
                if let company = peer.cardCompany { Text(company).font(.caption2).foregroundColor(.gray).lineLimit(1) }
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
                    .foregroundColor(.gray)
                    .multilineTextAlignment(.center)
            case .connecting:
                HStack(spacing: 12) {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .yellow))
                    Text("Connecting...")
                        .font(.subheadline)
                        .foregroundColor(.gray)
                }
            case .success:
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.seal.fill").foregroundColor(.green)
                    Text("Connected! Sending card...")
                        .font(.subheadline)
                        .foregroundColor(.gray)
                }
            case .error(let message):
                VStack(spacing: 8) {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.orange)
                        Text("Connection failed")
                            .font(.subheadline)
                            .foregroundColor(.white)
                    }
                    Text(message)
                        .font(.caption)
                        .foregroundColor(.gray)
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
                .buttonStyle(SecondaryButtonStyle())
                Button(action: startConnect) {
                    HStack(spacing: 6) {
                        Image(systemName: "link.badge.plus")
                        Text("Connect").fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryGradientButtonStyle())
            case .connecting:
                Button(action: { dismiss() }) {
                    Text("Hide").frame(maxWidth: .infinity)
                }
                .buttonStyle(SecondaryButtonStyle())
            case .success:
                Button(action: { dismiss() }) {
                    Text("Done").frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryGradientButtonStyle())
            case .error:
                Button(action: { dismiss() }) {
                    Text("Close").frame(maxWidth: .infinity)
                }
                .buttonStyle(SecondaryButtonStyle())
                Button(action: startConnect) {
                    Text("Try Again").frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryGradientButtonStyle())
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
        switch phase { case .connecting: return false; default: return true }
    }

    private func startConnect() {
        withAnimation { phase = .connecting }
        proximityManager.connectToPeer(peer)
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
            if phase == .idle { withAnimation { phase = .connecting } }
        case .connected:
            if previous != .connected {
                withAnimation { phase = .success }
                if autoDismissOnSuccess {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                        dismiss()
                    }
                }
            }
        case .disconnected:
            if case .connecting = phase {
                // No-op, still attempting; keep showing
            }
        }
    }

    private func dismiss() {
        withAnimation { isPresented = false }
        onDismiss?()
    }
}

// MARK: - Button Styles

private struct PrimaryGradientButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.vertical, 12)
            .foregroundColor(.white)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(LinearGradient(colors: [Color.blue.opacity(0.9), Color.purple.opacity(0.9)], startPoint: .topLeading, endPoint: .bottomTrailing))
            )
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.2), lineWidth: 1))
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
    }
}

private struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.vertical, 12)
            .foregroundColor(.white)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.white.opacity(0.08))
            )
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.15), lineWidth: 1))
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
    }
}
