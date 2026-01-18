import SwiftUI

struct MatchingBarView: View {
  @StateObject private var proximityManager = ProximityManager.shared
  @State private var showFullView = false

  var body: some View {
    VStack {
      if shouldShowBar {
        Button(action: { showFullView = true }) {
          HStack(spacing: 12) {
            // Status Indicator
            ZStack {
              Circle()
                .fill(statusColor.opacity(0.2))
                .frame(width: 32, height: 32)

              if isAnimating {
                Circle()
                  .stroke(statusColor, lineWidth: 2)
                  .frame(width: 32, height: 32)
                  .scaleEffect(1.2)
                  .opacity(0)
                  .animation(.easeOut(duration: 1.5).repeatForever(autoreverses: false), value: isAnimating)
              }

              Image(systemName: statusIcon)
                .foregroundColor(statusColor)
                .font(.system(size: 14, weight: .bold))
            }

            VStack(alignment: .leading, spacing: 2) {
              Text(statusTitle)
                .font(.subheadline)
                .fontWeight(.semibold)
                .foregroundColor(.primary)

              Text(statusSubtitle)
                .font(.caption)
                .foregroundColor(.secondary)
            }

            Spacer()

            Image(systemName: "chevron.up")
              .foregroundColor(.secondary)
              .font(.caption)
          }
          .padding(.horizontal, 16)
          .padding(.vertical, 12)
          .background(.thinMaterial)
          .cornerRadius(16)
          .shadow(color: Color.black.opacity(0.1), radius: 5, x: 0, y: 2)
        }
        .padding(.horizontal, 16)
        .transition(.move(edge: .bottom).combined(with: .opacity))
      }
    }
    .sheet(isPresented: $showFullView) {
      ProximitySharingView()
    }
    .animation(.spring(), value: shouldShowBar)
    .animation(.spring(), value: proximityManager.connectionStatus)
  }

  private var shouldShowBar: Bool {
    // Show if advertising, browsing, or connected
    return proximityManager.isAdvertising || proximityManager.isBrowsing || !proximityManager.nearbyPeers.isEmpty
  }

  private var statusColor: Color {
    switch proximityManager.connectionStatus {
    case .connected: return .green
    case .advertising, .browsing, .advertisingAndBrowsing: return .blue
    case .disconnected: return .gray
    }
  }

  private var statusIcon: String {
    proximityManager.connectionStatus.systemImageName
  }

  private var statusTitle: String {
    switch proximityManager.connectionStatus {
    case .connected: return "Connected"
    case .advertising: return "Visible to others"
    case .browsing: return "Looking for peers"
    case .advertisingAndBrowsing: return "Matching..."
    case .disconnected: return "Offline"
    }
  }

  private var statusSubtitle: String {
    let count = proximityManager.nearbyPeers.count
    if count == 0 {
      return "No peers found yet"
    } else {
      return "\(count) peer\(count == 1 ? "" : "s") nearby"
    }
  }

  private var isAnimating: Bool {
    return proximityManager.isAdvertising || proximityManager.isBrowsing
  }
}

#Preview {
  ZStack {
    Color.gray.opacity(0.1).ignoresSafeArea()
    VStack {
      Spacer()
      MatchingBarView()
    }
  }
}
