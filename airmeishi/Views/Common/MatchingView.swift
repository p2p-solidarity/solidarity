//
//  MatchingView.swift
//  airmeishi
//
//  Matching interface with orbit animation and peer management
//

import SwiftUI

// Thin wrapper to keep the original name used elsewhere
struct MatchingView: View {
  var body: some View {
    MatchingRootView()
  }
}

// Subviews moved to `Views/Common/Matching/*`

// Subviews moved to `Views/Common/Matching/*`

// MARK: - Peer Detail Sheet
struct PeerDetailSheet: View {
  let peer: ProximityPeer
  @Environment(\.dismiss) private var dismiss
  @State private var isLighteningAnimating = false

  var body: some View {
    NavigationView {
      ZStack {
        LinearGradient(
          colors: [Color.black, Color.blue.opacity(0.1)],
          startPoint: .top,
          endPoint: .bottom
        )
        .ignoresSafeArea()

        ScrollView {
          VStack(spacing: 24) {
            // Lightening header
            HStack {
              Image(systemName: "bolt.fill")
                .foregroundColor(.yellow)
                .font(.title)
                .scaleEffect(isLighteningAnimating ? 1.3 : 1.0)
                .animation(
                  .easeInOut(duration: 0.5).repeatForever(autoreverses: true),
                  value: isLighteningAnimating
                )

              Text("Peer Details")
                .font(.title2)
                .fontWeight(.bold)
                .foregroundColor(.white)

              Spacer()
            }
            .padding(.horizontal)

            // Peer info card
            VStack(spacing: 16) {
              // Avatar and basic info
              VStack(spacing: 12) {
                ZStack {
                  Circle()
                    .fill(
                      LinearGradient(
                        colors: [.blue, .purple],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                      )
                    )
                    .frame(width: 80, height: 80)

                  Text(peerAvatarInitials)
                    .font(.title)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                }

                VStack(spacing: 4) {
                  Text(peer.cardName ?? peer.name)
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(.white)

                  if let title = peer.cardTitle {
                    Text(title)
                      .font(.headline)
                      .foregroundColor(.yellow)
                  }

                  if let company = peer.cardCompany {
                    Text(company)
                      .font(.subheadline)
                      .foregroundColor(.gray)
                  }
                }
              }

              // Status and verification
              VStack(spacing: 12) {
                HStack {
                  Text("Connection Status")
                    .font(.headline)
                    .foregroundColor(.white)
                  Spacer()
                  HStack(spacing: 6) {
                    Circle()
                      .fill(statusColor)
                      .frame(width: 8, height: 8)
                    Text(peer.status.rawValue)
                      .font(.subheadline)
                      .foregroundColor(.white)
                  }
                }

                if let verification = peer.verification {
                  HStack {
                    Text("Verification")
                      .font(.headline)
                      .foregroundColor(.white)
                    Spacer()
                    HStack(spacing: 6) {
                      Image(systemName: verification.systemImageName)
                        .foregroundColor(verificationColor)
                      Text(verification.displayName)
                        .font(.subheadline)
                        .foregroundColor(.white)
                    }
                  }
                }

                if peer.discoveryInfo["zk"] == "1" {
                  HStack {
                    Text("ZK Capability")
                      .font(.headline)
                      .foregroundColor(.white)
                    Spacer()
                    HStack(spacing: 6) {
                      Image(systemName: "shield.checkerboard")
                        .foregroundColor(.blue)
                      Text("Enabled")
                        .font(.subheadline)
                        .foregroundColor(.white)
                    }
                  }
                }
              }
            }
            .padding()
            .background(
              RoundedRectangle(cornerRadius: 16)
                .fill(Color.white.opacity(0.05))
                .overlay(
                  RoundedRectangle(cornerRadius: 16)
                    .stroke(Color.yellow.opacity(0.3), lineWidth: 1)
                )
            )

            Spacer()
          }
          .padding()
        }
      }
      .navigationTitle("Peer Details")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button("Done") { dismiss() }
        }
      }
      .onAppear {
        isLighteningAnimating = true
      }
    }
    .preferredColorScheme(.dark)
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

#Preview {
  ZStack {
    Color.black.ignoresSafeArea()
    MatchingView().frame(width: 300, height: 300)
  }
  .preferredColorScheme(.dark)
}
