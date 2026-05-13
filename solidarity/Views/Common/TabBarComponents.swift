import SwiftUI

// MARK: - App Tabs

enum MainAppTab: Int, CaseIterable {
  case people = 0
  case share = 1
  case me = 2

  var title: String {
    switch self {
    case .people: "People"
    case .share: "Share"
    case .me: "Me"
    }
  }

  var systemImage: String {
    switch self {
    case .people: "person.2"
    case .share: "dot.radiowaves.left.and.right"
    case .me: "person.crop.circle"
    }
  }
}

// MARK: - Flat bottom tab bar (matches Pencil design nh8OZ)

struct CustomFloatingTabBar: View {
  @Binding var selectedTab: Int

  var body: some View {
    VStack(spacing: 0) {
      Rectangle()
        .fill(Color.Theme.divider)
        .frame(height: 0.5)

      HStack(alignment: .center, spacing: 0) {
        ForEach(MainAppTab.allCases, id: \.rawValue) { tab in
          FlatTabButton(
            tab: tab,
            isSelected: selectedTab == tab.rawValue,
            action: { selectedTab = tab.rawValue }
          )
        }
      }
      .padding(.horizontal, 16)
      .padding(.top, 16)
      .padding(.bottom, 50)
      .background(Color.Theme.pageBg)
    }
  }
}

// MARK: - Flat Tab Button

private struct FlatTabButton: View {
  let tab: MainAppTab
  let isSelected: Bool
  let action: () -> Void

  var body: some View {
    Button {
      if !isSelected {
        HapticFeedbackManager.shared.softImpact()
        action()
      }
    } label: {
      VStack(spacing: 3) {
        Image(systemName: tab.systemImage)
          .font(.system(size: 20, weight: .regular))
          .frame(height: 24)

        Text(tab.title)
          .font(.system(size: 11, weight: .medium))
      }
      .foregroundColor(isSelected ? Color.Theme.textPrimary : Color.Theme.textTertiary)
      .frame(maxWidth: .infinity)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }
}
