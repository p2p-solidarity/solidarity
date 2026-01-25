import SwiftUI

struct MatchingBarView: View {
  @StateObject private var proximityManager = ProximityManager.shared
  @State private var showFullView = false
  @State private var isPulsing = false

  var body: some View {
    Button(action: { showFullView = true }) {
      indicator
    }
    .buttonStyle(.plain)
    .accessibilityLabel(statusTitle)
    .accessibilityValue(statusSubtitle)
    .accessibilityHint("Opens matching status")
    .onAppear { updatePulseState() }
    .onChange(of: isSearching) { _, _ in updatePulseState() }
    .opacity(shouldShowIndicator ? 1.0 : 0.4)
    .sheet(isPresented: $showFullView) { ProximitySharingView() }
    .animation(.easeInOut(duration: 0.2), value: shouldShowIndicator)
  }

  private var indicator: some View {
    ZStack {
      Circle()
        .fill(statusColor.opacity(0.18))
        .frame(width: 26, height: 26)

      if isSearching {
        Circle()
          .stroke(statusColor.opacity(0.55), lineWidth: 1.5)
          .frame(width: 26, height: 26)
          .scaleEffect(isPulsing ? 1.35 : 1.0)
          .opacity(isPulsing ? 0.0 : 0.65)
          .animation(.easeOut(duration: 1.4).repeatForever(autoreverses: false), value: isPulsing)
      }

      Image(systemName: statusIcon)
        .font(.system(size: 13, weight: .semibold))
        .foregroundColor(statusColor)
    }
    .contentShape(Rectangle())
    .padding(.vertical, 4)
  }

  private func updatePulseState() {
    if isSearching {
      // Trigger the repeating animation once when searching starts.
      if !isPulsing { isPulsing = true }
    } else {
      isPulsing = false
    }
  }

  private var shouldShowIndicator: Bool {
    // Show active state when matching is active or peers are present.
    // Always visible but dimmed when inactive.
    proximityManager.isAdvertising || proximityManager.isBrowsing || !proximityManager.nearbyPeers.isEmpty
  }

  private var isSearching: Bool {
    proximityManager.isAdvertising || proximityManager.isBrowsing
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
}

#Preview {
  NavigationStack {
    Text("Preview")
      .navigationTitle("Home")
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          MatchingBarView()
        }
      }
  }
}
