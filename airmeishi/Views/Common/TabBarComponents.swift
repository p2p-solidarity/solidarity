import SwiftUI

// MARK: - Tab Bar Icon

struct TabBarIcon: View {
  let systemName: String
  let title: String
  let isSelected: Bool

  var body: some View {
    VStack(spacing: 4) {
      Image(systemName: systemName)
        .symbolRenderingMode(.monochrome)
        .font(.system(size: 18, weight: .medium))
        .foregroundColor(Color.Theme.darkUI.opacity(isSelected ? 1.0 : 0.5))

      Text(title)
        .font(.system(size: 11, weight: .medium))
        .foregroundColor(Color.Theme.darkUI.opacity(isSelected ? 1.0 : 0.5))
        .lineLimit(1)
        .minimumScaleFactor(0.85)
    }
    .padding(.top, 6)
    .padding(.bottom, 4)
  }
}

// MARK: - Floating Tab Bar Backdrop

struct FloatingTabBarBackdrop: View {
  var body: some View {
    Rectangle()
      .fill(Color.Theme.pageBg)
      .overlay(alignment: .top) {
        Rectangle()
          .fill(Color.Theme.divider)
          .frame(height: 0.5)
      }
      .frame(height: 64)
      .accessibilityHidden(true)
  }
}

// MARK: - App Tabs

enum MainAppTab: Int, CaseIterable {
  case people = 0
  case me = 1
}

// MARK: - Retro Bottom Tab Bar (Neo-Win98 Style)

struct CustomFloatingTabBar: View {
  @Binding var selectedTab: Int

  var body: some View {
    VStack(spacing: 0) {
      // Top 1px border separator
      Rectangle()
        .fill(Color.Theme.divider)
        .frame(height: 1)
      
      HStack(spacing: 0) {
        RetroTabButton(
          title: "people",
          isSelected: selectedTab == MainAppTab.people.rawValue,
          action: { selectedTab = MainAppTab.people.rawValue }
        )
        
        // Vertical 1px separator
        Rectangle()
          .fill(Color.Theme.divider)
          .frame(width: 1, height: 24)
        
        RetroTabButton(
          title: "me",
          isSelected: selectedTab == MainAppTab.me.rawValue,
          action: { selectedTab = MainAppTab.me.rawValue }
        )
      }
      .frame(height: 56)
      .background(Color.Theme.pageBg)
    }
  }
}

// MARK: - Retro Tab Button

struct RetroTabButton: View {
  let title: String
  let isSelected: Bool
  let action: () -> Void

  var body: some View {
    Button(action: {
      if !isSelected {
        HapticFeedbackManager.shared.rigidImpact()
        action()
      }
    }) {
      Text(title)
        .font(.system(size: 16, weight: isSelected ? .bold : .regular, design: .monospaced))
        .foregroundColor(isSelected ? .white : Color.Theme.textTertiary)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // Only show indicator if selected
        .overlay(
          Rectangle()
            .fill(isSelected ? Color.white : Color.clear)
            .frame(height: 2),
          alignment: .bottom
        )
    }
    .buttonStyle(.plain)
  }
}

// MARK: - Tab Bar Button

struct TabBarButton: View {
  let systemName: String
  let title: String
  let isSelected: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      TabBarIcon(systemName: systemName, title: title, isSelected: isSelected)
    }
    .buttonStyle(.plain)
  }
}
