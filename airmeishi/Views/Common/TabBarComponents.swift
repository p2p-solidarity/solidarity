import SwiftUI

// MARK: - Tab Bar Icon with Glow

struct TabBarIcon: View {
    let systemName: String
    let title: String
    let isSelected: Bool
    let customIcon: String?
    
    init(systemName: String, title: String, isSelected: Bool, customIcon: String? = nil) {
        self.systemName = systemName
        self.title = title
        self.isSelected = isSelected
        self.customIcon = customIcon
    }
    
    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                if isSelected {
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [Color.white.opacity(0.25), Color.white.opacity(0.0)],
                                center: .center,
                                startRadius: 1,
                                endRadius: 14
                            )
                        )
                        .frame(width: 20, height: 20)
                }
                if let customIcon = customIcon, customIcon == "sakura-white", systemName.isEmpty {
                    // Use SakuraIconView for sakura icon
                    SakuraIconView(
                        size: 18,
                        color: isSelected ? .white : Color(white: 0.65),
                        isAnimating: false
                    )
                    .shadow(color: isSelected ? Color.white.opacity(0.45) : Color.clear, radius: isSelected ? 2 : 0)
                } else if let customIcon = customIcon, systemName.isEmpty {
                    Image(customIcon)
                        .resizable()
                        .renderingMode(.template)
                        .foregroundColor(isSelected ? .white : Color(white: 0.65))
                        .frame(width: 18, height: 18)
                        .shadow(color: isSelected ? Color.white.opacity(0.45) : Color.clear, radius: isSelected ? 2 : 0)
                } else if !systemName.isEmpty {
                    Image(systemName: systemName)
                        .symbolRenderingMode(.monochrome)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(isSelected ? .white : Color(white: 0.65))
                        .shadow(color: isSelected ? Color.white.opacity(0.45) : Color.clear, radius: isSelected ? 2 : 0)
                }
            }
            Text(title)
                .font(.footnote)
                .foregroundColor(isSelected ? .white : Color(white: 0.65))
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
        .padding(.top, 6)
        .padding(.bottom, 4)
    }
}

// MARK: - Floating Glossy Backdrop

struct FloatingTabBarBackdrop: View {
    var body: some View {
        ZStack {
            // Flat, semi-transparent surface for Material-like feel
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(.ultraThinMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(Color.white.opacity(0.08), lineWidth: 0.5)
                )
        }
        .frame(height: 64)
        .shadow(color: Color.black.opacity(0.25), radius: 6, y: 3)
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
        .background(Color.clear)
        .accessibilityHidden(true)
    }
}


// MARK: - App Tabs (for custom bar)

enum MainAppTab: Int, CaseIterable {
    case glossary = 0
    case sharing = 1
    case shoutout = 2
    case id = 3
    case settings = 4
}

// MARK: - Custom Floating Tab Bar

struct CustomFloatingTabBar: View {
    @Binding var selectedTab: Int
    var onIdTabTapped: (() -> Void)? = nil
    
    var body: some View {
        ZStack(alignment: .bottom) {
            FloatingTabBarBackdrop()
                .allowsHitTesting(false)
                .padding(.bottom, -6)
            
            HStack {
                TabBarButton(systemName: "list.bullet.rectangle", title: "Glossary", isSelected: selectedTab == MainAppTab.glossary.rawValue, action: {
                    selectedTab = MainAppTab.glossary.rawValue
                })
                Spacer(minLength: 16)
                TabBarButton(systemName: "circle.grid.2x2", title: "Sharing", isSelected: selectedTab == MainAppTab.sharing.rawValue, action: {
                    selectedTab = MainAppTab.sharing.rawValue
                })
                Spacer(minLength: 16)
                TabBarButton(systemName: "", title: "Sakura", isSelected: selectedTab == MainAppTab.shoutout.rawValue, customIcon: "sakura-white", action: {
                    selectedTab = MainAppTab.shoutout.rawValue
                })
                Spacer(minLength: 16)
                TabBarButton(systemName: "target", title: "ID", isSelected: selectedTab == MainAppTab.id.rawValue, action: {
                    selectedTab = MainAppTab.id.rawValue
                    onIdTabTapped?()
                })
                Spacer(minLength: 16)
                TabBarButton(systemName: "gearshape.fill", title: "Settings", isSelected: selectedTab == MainAppTab.settings.rawValue, action: {
                    selectedTab = MainAppTab.settings.rawValue
                })
            }
            .frame(height: 64)
            .padding(.horizontal, 28)
            .padding(.bottom, 6)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .ignoresSafeArea(edges: .bottom)
    }
}

// MARK: - Tab Bar Button (uses TabBarIcon)

struct TabBarButton: View {
    let systemName: String
    let title: String
    let isSelected: Bool
    let customIcon: String?
    let action: () -> Void
    
    init(systemName: String, title: String, isSelected: Bool, customIcon: String? = nil, action: @escaping () -> Void) {
        self.systemName = systemName
        self.title = title
        self.isSelected = isSelected
        self.customIcon = customIcon
        self.action = action
    }
    
    var body: some View {
        Button(action: action) {
            TabBarIcon(systemName: systemName, title: title, isSelected: isSelected, customIcon: customIcon)
        }
        .buttonStyle(.plain)
    }
}


