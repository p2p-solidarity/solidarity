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
        .onChange(of: selectedTab) { _, newTab in
            if newTab == 1 {
                showingProximityFullscreen = true
                selectedTab = 0 // Reset to first tab
            }
        }
        .fullScreenCover(isPresented: $showingProximityFullscreen) {
            ProximitySharingView()
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
            
        case .navigateToSharing:
            break
            
        case .navigateToContacts:
            break
        }
        
        deepLinkManager.clearPendingAction()
    }
}


