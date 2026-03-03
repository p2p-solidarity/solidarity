import SwiftUI

struct MainTabView: View {
  @EnvironmentObject var deepLinkManager: DeepLinkManager
  @State private var showingReceivedCard = false
  @State private var showingErrorAlert = false
  @State private var errorMessage = ""
  @State private var selectedTab = MainAppTab.people.rawValue

  @State private var showingScanFlow = false

  var body: some View {
    ZStack(alignment: .bottom) {
      // Main Content Views
      TabView(selection: $selectedTab) {
        PeopleListView()
          .tag(MainAppTab.people.rawValue)

        MeTabView()
          .tag(MainAppTab.me.rawValue)
      }
      .tabViewStyle(DefaultTabViewStyle())
      .toolbarBackground(.hidden, for: .tabBar)
      .toolbar(.hidden, for: .tabBar)
      // Padding for the bottom tab bar to prevent overlap
      .padding(.bottom, 56)

      // Fixed Elements over the TabView
      VStack(spacing: 0) {
        Spacer()
        
        // Center Scan Button over the TabBar
        ScanFloatingActionButton {
          showingScanFlow = true
        }
        
        // Retro Tab Bar
        CustomFloatingTabBar(selectedTab: $selectedTab)
      }
    }
    .ignoresSafeArea(edges: .bottom)
    .fullScreenCover(isPresented: $showingScanFlow) {
      // Embed ScanTabView in a NavigationView for proper rendering, or adapt as needed
      NavigationView {
        ScanTabView()
          // Inject a close button for the floating flow
          .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
              Button(action: { showingScanFlow = false }) {
                Image(systemName: "xmark")
                  .foregroundColor(.white)
              }
            }
          }
      }
    }
    .sheet(isPresented: $showingReceivedCard) {
      if let card = deepLinkManager.lastReceivedCard {
        ReceivedCardView(card: card)
      }
    }
    .alert("Error", isPresented: $showingErrorAlert) {
      Button("OK") {}
    } message: {
      Text(errorMessage)
    }
    .onReceive(deepLinkManager.$pendingAction) { action in
      handleDeepLinkAction(action)
    }
    .toastOverlay()
    .onReceive(NotificationCenter.default.publisher(for: .matchingReceivedCard)) { notification in
      if let card = notification.userInfo?[ProximityEventKey.card] as? BusinessCard {
        ToastManager.shared.show(
          title: String(localized: "Card Received"),
          message: String(localized: "Received business card from \(card.name)"),
          type: .success
        )
      }
    }
    .onReceive(NotificationCenter.default.publisher(for: .groupInviteReceived)) { notification in
      if let invite = notification.userInfo?[ProximityEventKey.invite] as? GroupInvitePayload {
        ToastManager.shared.show(
          title: String(localized: "Group Invite"),
          message: String(localized: "Invited to join group: \(invite.groupName)"),
          type: .info,
          duration: 5.0,
          action: {}
        )
      }
    }
    .onReceive(NotificationCenter.default.publisher(for: .matchingError)) { notification in
      if let error = notification.userInfo?[ProximityEventKey.error] as? CardError {
        ToastManager.shared.show(
          title: String(localized: "Connection Error"),
          message: error.localizedDescription,
          type: .error
        )
      }
    }
    .onReceive(NotificationCenter.default.publisher(for: .secureMessageReceived)) { notification in
      guard NotificationSettingsManager.shared.enableInAppToast else { return }

      #if canImport(UIKit)
      guard UIApplication.shared.applicationState == .active else { return }
      #endif

      let sender = notification.userInfo?[MessageEventKey.senderName] as? String
      let text = notification.userInfo?[MessageEventKey.text] as? String

      if let sender = sender {
        ToastManager.shared.show(
          title: String(localized: "New Sakura from \(sender)"),
          message: text,
          type: .info,
          duration: 4.0
        )
      } else {
        ToastManager.shared.show(
          title: String(localized: "New Sakura message"),
          message: text,
          type: .info,
          duration: 4.0
        )
      }
    }
  }

  // MARK: - Native/Custom tab views removed in favor of unified Retro layout

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
        title: String(localized: "Success"),
        message: message,
        type: .success
      )

    case .navigateToSharing:
      selectedTab = MainAppTab.people.rawValue

    case .navigateToContacts:
      selectedTab = MainAppTab.people.rawValue
    }

    deepLinkManager.clearPendingAction()
  }
}
