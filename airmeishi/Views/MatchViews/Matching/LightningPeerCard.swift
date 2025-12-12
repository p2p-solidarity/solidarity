//
//  LighteningPeerCard.swift
//  airmeishi
//
//  Card cell showing a peer with a styled Connect button.
//

import SwiftUI

struct LighteningPeerCard: View {
    let peer: ProximityPeer
    let isLighteningAnimating: Bool
    let onTap: () -> Void
    let onConnect: (() -> Void)?
    
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
                    .fill(Color.white.opacity(0.05))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(isLighteningAnimating ? Color.yellow.opacity(0.3) : Color.white.opacity(0.1), lineWidth: 1)
                    )
            )
            .scaleEffect(isHovering ? 1.05 : 1.0)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovering)
        }
        .buttonStyle(PlainButtonStyle())
        .onHover { hovering in isHovering = hovering }
    }
    
    private var header: some View {
        HStack {
            ZStack {
                Circle()
                    .fill(LinearGradient(colors: [statusColor, statusColor.opacity(0.6)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 50, height: 50)
                Text(peerAvatarInitials).font(.headline).fontWeight(.bold).foregroundColor(.white)
                if peer.status == .connected {
                    Circle()
                        .stroke(Color.yellow, lineWidth: 2)
                        .frame(width: 56, height: 56)
                        .scaleEffect(isLighteningAnimating ? 1.1 : 1.0)
                        .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: isLighteningAnimating)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                HStack(spacing: 4) {
                    Circle().fill(statusColor).frame(width: 8, height: 8)
                        .scaleEffect(isLighteningAnimating ? 1.2 : 1.0)
                        .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: isLighteningAnimating)
                    Text(peer.status.rawValue).font(.caption2).foregroundColor(.white)
                }
                if let verification = peer.verification {
                    HStack(spacing: 2) {
                        Image(systemName: verification.systemImageName).font(.caption2).foregroundColor(verificationColor)
                        Text(verification.displayName).font(.caption2).foregroundColor(.gray)
                    }
                } else if peer.discoveryInfo["zk"] == "1" {
                    HStack(spacing: 2) {
                        Image(systemName: "shield.checkerboard").font(.caption2).foregroundColor(.blue)
                        Text("ZK Ready").font(.caption2).foregroundColor(.gray)
                    }
                }
            }
        }
    }
    
    private var info: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(peer.cardName ?? peer.name).font(.headline).fontWeight(.semibold).foregroundColor(.white).lineLimit(1)
            if let title = peer.cardTitle { Text(title).font(.caption).foregroundColor(.yellow).lineLimit(1) }
            if let company = peer.cardCompany { Text(company).font(.caption2).foregroundColor(.gray).lineLimit(1) }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    
    private var footer: some View {
        HStack {
            if peer.status == .disconnected {
                Button(action: { onConnect?() }) {
                    HStack(spacing: 6) {
                        Image(systemName: "link.badge.plus")
                        Text("Connect")
                            .fontWeight(.semibold)
                    }
                    .font(.caption)
                    .foregroundColor(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        LinearGradient(
                            colors: [Color.blue.opacity(0.9), Color.purple.opacity(0.9)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .clipShape(Capsule())
                    .overlay(
                        Capsule().stroke(Color.white.opacity(0.2), lineWidth: 1)
                    )
                    .shadow(color: Color.blue.opacity(0.3), radius: 6, x: 0, y: 2)
                }
                .buttonStyle(PlainButtonStyle())
            }
            Spacer()
            Image(systemName: "bolt.fill")
                .foregroundColor(isLighteningAnimating ? .yellow : .gray)
                .font(.caption)
                .scaleEffect(isLighteningAnimating ? 1.2 : 1.0)
                .animation(.easeInOut(duration: 0.3).repeatForever(autoreverses: true), value: isLighteningAnimating)
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
    
    private var verificationColor: Color {
        if let verification = peer.verification {
            switch verification {
            case .verified: return .green
            case .pending: return .orange
            case .unverified: return .blue
            case .failed: return .red
            }
        }
        return .blue
    }
}
