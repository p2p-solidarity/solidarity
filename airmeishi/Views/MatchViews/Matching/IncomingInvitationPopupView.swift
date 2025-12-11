//
//  IncomingInvitationPopupView.swift
//  airmeishi
//
//  Popup to request consent for incoming proximity connection.
//

import SwiftUI
import MultipeerConnectivity

struct IncomingInvitationPopupView: View {
    let invitation: PendingInvitation
    let onAccept: () -> Void
    let onDecline: () -> Void
    let onDismiss: () -> Void
    
    @ObservedObject private var proximityManager = ProximityManager.shared
    @State private var isAnimating = false
    @State private var didRespond = false
    
    var body: some View {
        ZStack {
            Color.black.opacity(0.5).ignoresSafeArea()
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
        .onAppear { isAnimating = true }
        .onDisappear { onDismiss() }
        .preferredColorScheme(.dark)
    }
    
    private var content: some View {
        VStack(spacing: 16) {
            header
            Text("wants to connect with you")
                .font(.subheadline)
                .foregroundColor(.gray)
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
            switch status { case .connected: return .green; case .connecting: return .orange; case .disconnected: return .gray }
        }()
        return HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(LinearGradient(colors: [statusColor, statusColor.opacity(0.6)],
                                         startPoint: .topLeading,
                                         endPoint: .bottomTrailing))
                    .frame(width: 54, height: 54)
                Text(initials)
                    .font(.headline)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                Circle()
                    .stroke(Color.yellow, lineWidth: 2)
                    .frame(width: 60, height: 60)
                    .scaleEffect(isAnimating ? 1.1 : 1.0)
                    .animation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true),
                               value: isAnimating)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(name).font(.headline).foregroundColor(.white).lineLimit(1)
                if let title = title { Text(title).font(.caption).foregroundColor(.yellow).lineLimit(1) }
                if let company = company { Text(company).font(.caption2).foregroundColor(.gray).lineLimit(1) }
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
            .buttonStyle(SecondaryButtonStyle())
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
            .buttonStyle(PrimaryGradientButtonStyle())
        }
    }
}

// MARK: - Button Styles (local to this view)

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


