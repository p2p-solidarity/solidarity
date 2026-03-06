import SwiftUI

// MARK: - App Tabs

enum MainAppTab: Int, CaseIterable {
  case people = 0
  case sharing = 1
  case me = 2

  var title: String {
    switch self {
    case .people: "People"
    case .sharing: "Sharing"
    case .me: "Me"
    }
  }

  var systemImage: String {
    switch self {
    case .people: "hexagon"
    case .sharing: "dot.radiowaves.up.forward"
    case .me: "diamond"
    }
  }
}

// MARK: - Peaceful Floating Tab Bar (1.1.1 Era)

struct CustomFloatingTabBar: View {
  @Binding var selectedTab: Int
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    HStack(spacing: 0) {
      ForEach(MainAppTab.allCases, id: \.rawValue) { tab in
        PeacefulTabButton(
          systemName: tab.systemImage,
          title: tab.title,
          isSelected: selectedTab == tab.rawValue,
          action: { selectedTab = tab.rawValue }
        )
      }
    }
    .padding(.horizontal, 24)
    .padding(.vertical, 12)
    .background(
      Capsule()
        .fill(Color.Theme.cardSurface(for: colorScheme))
        .overlay(
          Capsule()
            .stroke(Color.Theme.cardBorder(for: colorScheme), lineWidth: 1)
        )
        .shadow(color: Color.Theme.dustyMauve.opacity(0.12), radius: 16, x: 0, y: 6)
    )
    .padding(.horizontal, 32)
  }
}

// MARK: - Peaceful Tab Button

struct PeacefulTabButton: View {
  let systemName: String
  let title: String
  let isSelected: Bool
  let action: () -> Void

  var body: some View {
    Button(action: {
      if !isSelected {
        HapticFeedbackManager.shared.softImpact()
        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
          action()
        }
      }
    }) {
      VStack(spacing: 4) {
        Image(systemName: isSelected ? systemName : systemName.replacingOccurrences(of: ".fill", with: ""))
          .font(.system(size: 22, weight: .medium))
          .foregroundColor(isSelected ? Color.Theme.primaryBlue : Color.Theme.textTertiary)
          .frame(height: 24)

        Text(title)
          .font(.system(size: 11, weight: isSelected ? .semibold : .medium))
          .foregroundColor(isSelected ? Color.Theme.textPrimary : Color.Theme.textTertiary)
      }
      .frame(maxWidth: .infinity)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }
}

// MARK: - Tab Bar Button (Legacy)

struct TabBarButton: View {
  let systemName: String
  let title: String
  let isSelected: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      VStack(spacing: 4) {
        Image(systemName: systemName)
          .font(.system(size: 18, weight: .medium))
          .foregroundColor(Color.Theme.textPrimary.opacity(isSelected ? 1.0 : 0.5))

        Text(title)
          .font(.system(size: 11, weight: .medium))
          .foregroundColor(Color.Theme.textPrimary.opacity(isSelected ? 1.0 : 0.5))
      }
    }
    .buttonStyle(.plain)
  }
}
