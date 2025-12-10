import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var deepLinkManager: DeepLinkManager
    @State private var showingReceivedCard = false
    @State private var showingErrorAlert = false
    @State private var errorMessage = ""
    @State private var selectedTab = 0
    @State private var tabStatus: String?
    @State private var isTabWorking = false
    @State private var showingProximityFullscreen = false
    
    var body: some View {
        Group {
            if #available(iOS 26.0, *) {
                nativeTabView
            } else {
                customTabView
            }
        }
        .background(Color.black.ignoresSafeArea())
        .tint(.white)
        .sheet(isPresented: $showingReceivedCard) {
            if let card = deepLinkManager.lastReceivedCard {
                ReceivedCardView(card: card)
            }
        }
        .alert("Error", isPresented: $showingErrorAlert) {
            Button("OK") { }
        } message: {
            Text(errorMessage)
        }
        .onReceive(deepLinkManager.$pendingAction) { action in
            handleDeepLinkAction(action)
        }
        .fullScreenCover(isPresented: $showingProximityFullscreen) {
            ProximitySharingView()
        }
        .toastOverlay()
        .onReceive(NotificationCenter.default.publisher(for: .matchingReceivedCard)) { notification in
            if let card = notification.userInfo?[ProximityEventKey.card] as? BusinessCard {
                ToastManager.shared.show(
                    title: "Card Received",
                    message: "Received business card from \(card.name)",
                    type: .success
                )
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .groupInviteReceived)) { notification in
            if let invite = notification.userInfo?[ProximityEventKey.invite] as? GroupInvitePayload {
                ToastManager.shared.show(
                    title: "Group Invite",
                    message: "Invited to join group: \(invite.groupName)",
                    type: .info,
                    duration: 5.0,
                    action: {
                        // Action handled by ProximityManager popup usually, 
                        // but we could add a "View" action here if needed.
                        // For now, the popup handles it.
                    }
                )
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .matchingError)) { notification in
            if let error = notification.userInfo?[ProximityEventKey.error] as? CardError {
                ToastManager.shared.show(
                    title: "Connection Error",
                    message: error.localizedDescription,
                    type: .error
                )
            }
        }
        // New: Sakura secure message toast (only shown when App is active)
        .onReceive(NotificationCenter.default.publisher(for: .secureMessageReceived)) { notification in
            #if canImport(UIKit)
            // Ensure toast is only shown in foreground to avoid conflict with APNs banner in background/lock screen
            guard UIApplication.shared.applicationState == .active else {
                return
            }
            #endif

            let sender = notification.userInfo?[MessageEventKey.senderName] as? String
            let text = notification.userInfo?[MessageEventKey.text] as? String
            
            if let sender = sender {
                ToastManager.shared.show(
                    title: "New Sakura from \(sender)",
                    message: text,
                    type: .info,
                    duration: 4.0
                )
            } else {
                ToastManager.shared.show(
                    title: "New Sakura message",
                    message: text,
                    type: .info,
                    duration: 4.0
                )
            }
        }
    }
    
    // MARK: - iOS 26+ Native Tab View
    @available(iOS 26.0, *)
    private var nativeTabView: some View {
        ZStack(alignment: .bottom) {
            TabView(selection: $selectedTab) {
                BusinessCardListView()
                    .tabItem {
                        nativeTabItem(systemName: "list.bullet.rectangle", title: "Glossary")
                    }
                    .tag(0)
                
                MatchingView()
                    .tabItem {
                        nativeTabItem(systemName: "circle.grid.2x2", title: "Sharing")
                    }
                    .tag(1)
                
                ShoutoutView()
                    .tabItem {
                        nativeTabItem(systemName: "", title: "Sakura", customIcon: "sakura-white")
                    }
                    .tag(2)
                
                IDView()
                    .tabItem {
                        nativeTabItem(systemName: "target", title: "ID")
                    }
                    .tag(3)
                
                SettingsView()
                    .tabItem {
                        nativeTabItem(systemName: "gearshape.fill", title: "Settings")
                    }
                    .tag(4)
            }
            .toolbarBackground(.black, for: .tabBar)
            .toolbarBackground(.visible, for: .tabBar)
            .onChange(of: selectedTab) { _, newTab in
                if newTab == 1 {
                    showingProximityFullscreen = true
                    selectedTab = 0 // Reset to first tab
                } else if newTab == 3 {
                    generateIdGroupProofTabAction()
                }
            }
            
            if let status = tabStatus {
                VStack {
                    Spacer()
                    Text(status)
                        .font(.footnote.weight(.semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(.black.opacity(0.6))
                        .clipShape(Capsule())
                        .padding(.bottom, 100)
                }
                .transition(.opacity)
                .animation(.easeInOut(duration: 0.2), value: tabStatus)
            }
            
            // Matching Bar
            VStack {
                Spacer()
                MatchingBarView()
                    .padding(.bottom, 90) // Above native tab bar
            }
        }
    }
    
    // MARK: - Custom Tab View (iOS < 16)
    private var customTabView: some View {
        ZStack(alignment: .bottom) {
            TabView(selection: $selectedTab) {
                BusinessCardListView()
                    .tag(0)
                
                MatchingView()
                    .tag(1)
                
                ShoutoutView()
                    .tag(2)
                
                IDView()
                    .tag(3)
                
                SettingsView()
                    .tag(4)
            }
            .tabViewStyle(DefaultTabViewStyle())
            .toolbarBackground(.hidden, for: .tabBar)
            .toolbar(.hidden, for: .tabBar)
            .onChange(of: selectedTab) { _, newTab in
                if newTab == 1 {
                    showingProximityFullscreen = true
                    selectedTab = 0 // Reset to first tab
                }
            }

            CustomFloatingTabBar(selectedTab: $selectedTab, onIdTabTapped: { generateIdGroupProofTabAction() })

            if let status = tabStatus {
                VStack {
                    Spacer()
                    Text(status)
                        .font(.footnote.weight(.semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(.black.opacity(0.6))
                        .clipShape(Capsule())
                        .padding(.bottom, 86)
                }
                .transition(.opacity)
                .animation(.easeInOut(duration: 0.2), value: tabStatus)
            }
            
            // Matching Bar
            VStack {
                Spacer()
                MatchingBarView()
                    .padding(.bottom, 80) // Above custom floating tab bar
            }
        }
    }
    
    private func generateIdGroupProofTabAction() {
        if isTabWorking { return }
        isTabWorking = true
        tabStatus = "Working..."
        DispatchQueue.global(qos: .userInitiated).async {
            let idm = SemaphoreIdentityManager.shared
            let groupMgr = SemaphoreGroupManager.shared
            do {
                // Ensure identity exists
                let bundle = try idm.loadOrCreateIdentity()
                // Ensure membership includes self at minimum
                if !groupMgr.members.contains(bundle.commitment) {
                    groupMgr.addMember(bundle.commitment)
                }
                if !SemaphoreIdentityManager.proofsSupported {
                    // Fallback: copy commitment
                    #if canImport(UIKit)
                    DispatchQueue.main.async {
                        UIPasteboard.general.string = bundle.commitment
                    }
                    #endif
                    DispatchQueue.main.async {
                        tabStatus = "Commitment copied"
                        isTabWorking = false
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) { tabStatus = nil }
                    }
                    return
                }
                // Build proof with lightweight inputs
                let message = UUID().uuidString
                let scope = "id_tab"
                let proof = try idm.generateProof(
                    groupCommitments: groupMgr.members.isEmpty ? [bundle.commitment] : groupMgr.members,
                    message: message,
                    scope: scope,
                    merkleDepth: 16
                )
                // Copy result to clipboard for convenience
                #if canImport(UIKit)
                DispatchQueue.main.async {
                    UIPasteboard.general.string = proof
                }
                #endif
                DispatchQueue.main.async {
                    tabStatus = "ID proof copied"
                    isTabWorking = false
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) { tabStatus = nil }
                }
            } catch {
                DispatchQueue.main.async {
                    tabStatus = "Error: \(error.localizedDescription)"
                    isTabWorking = false
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2.2) { tabStatus = nil }
                }
            }
        }
    }

    private func handleDeepLinkAction(_ action: DeepLinkAction?) {
        guard let action = action else { return }
        
        switch action {
        case .showReceivedCard:
            showingReceivedCard = true
            
        case .showError(let message):
            errorMessage = message
            showingErrorAlert = true
            
        case .showMessage(let message):
            ToastManager.shared.show(
                title: "Success",
                message: message,
                type: .success
            )
            
        case .navigateToSharing:
            break
            
        case .navigateToContacts:
            break
        }
        
        deepLinkManager.clearPendingAction()
    }
    
    // MARK: - Native Tab Item Helper
    @available(iOS 16.0, *)
    @ViewBuilder
    private func nativeTabItem(systemName: String, title: String, customIcon: String? = nil) -> some View {
        if let customIcon = customIcon, customIcon == "sakura-white", systemName.isEmpty {
            #if canImport(UIKit)
            if let sakuraImage = SakuraIconView.renderAsImage(size: 22, color: .white) {
                Label {
                    Text(title)
                } icon: {
                    Image(uiImage: sakuraImage)
                        .renderingMode(.template)
                        .foregroundColor(.white)
                }
            } else {
                Label(title, systemImage: "star")
            }
            #else
            Label(title, systemImage: "star")
            #endif
        } else {
            Label(title, systemImage: systemName)
        }
    }
}


