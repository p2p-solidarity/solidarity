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
  case me = 0
  case people = 1
  case scan = 2
}

// MARK: - Custom Floating Tab Bar

struct CustomFloatingTabBar: View {
  @Binding var selectedTab: Int

  var body: some View {
    ZStack(alignment: .bottom) {
      FloatingTabBarBackdrop()
        .allowsHitTesting(false)

      HStack {
        TabBarButton(
          systemName: "person.text.rectangle",
          title: "Me",
          isSelected: selectedTab == MainAppTab.me.rawValue,
          action: { selectedTab = MainAppTab.me.rawValue }
        )
        Spacer(minLength: 24)
        TabBarButton(
          systemName: "person.2.fill",
          title: "People",
          isSelected: selectedTab == MainAppTab.people.rawValue,
          action: { selectedTab = MainAppTab.people.rawValue }
        )
        Spacer(minLength: 24)
        TabBarButton(
          systemName: "qrcode.viewfinder",
          title: "Scan",
          isSelected: selectedTab == MainAppTab.scan.rawValue,
          action: { selectedTab = MainAppTab.scan.rawValue }
        )
      }
      .frame(height: 64)
      .padding(.leading, 16)
      .padding(.trailing, 16)
      .padding(.bottom, 50)
      .padding(.top, 16)
    }
    .ignoresSafeArea(edges: .bottom)
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
