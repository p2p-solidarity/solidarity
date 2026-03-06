import SwiftUI

struct MainTabView: View {
  @EnvironmentObject var deepLinkManager: DeepLinkManager
  @Environment(\.scenePhase) private var scenePhase
  @State private var showingReceivedCard = false
  @State private var showingErrorAlert = false
  @State private var errorMessage = ""
  @State private var selectedTab = MainAppTab.people.rawValue

  var body: some View {
    tabContent
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
      .onChange(of: scenePhase) { _, newPhase in
        if newPhase == .background {
          BackupManager.shared.triggerAutoBackupIfNeeded()
        }
      }
      .onReceive(NotificationCenter.default.publisher(for: .matchingReceivedCard)) { notification in
        if let card = notification.userInfo?[ProximityEventKey.card] as? BusinessCard {
          ToastManager.shared.show(
            title: String(localized: "Card Received"),
            message: String(localized: "Received business card from \(card.name)"),
            type: .success
          )
          // Trigger auto backup after card exchange
          BackupManager.shared.triggerAutoBackupIfNeeded()
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

  // MARK: - Tab Content

  @ViewBuilder
  private var tabContent: some View {
    if #available(iOS 26, *) {
      TabView(selection: $selectedTab) {
        Tab(MainAppTab.people.title, systemImage: MainAppTab.people.systemImage, value: MainAppTab.people.rawValue) {
          PeopleListView()
        }
        Tab(MainAppTab.scan.title, systemImage: MainAppTab.scan.systemImage, value: MainAppTab.scan.rawValue) {
          ScanTabView()
        }
        Tab(MainAppTab.me.title, systemImage: MainAppTab.me.systemImage, value: MainAppTab.me.rawValue) {
          MeTabView()
        }
      }
      .tint(Color.Theme.primaryBlue)
      .toolbarColorScheme(.dark, for: .tabBar)
    } else {
      ZStack(alignment: .bottom) {
        TabView(selection: $selectedTab) {
          PeopleListView()
            .tag(MainAppTab.people.rawValue)

          ScanTabView()
            .tag(MainAppTab.scan.rawValue)

          MeTabView()
            .tag(MainAppTab.me.rawValue)
        }
        .tabViewStyle(DefaultTabViewStyle())
        .toolbarBackground(.hidden, for: .tabBar)
        .toolbar(.hidden, for: .tabBar)
        .padding(.bottom, 80)

        VStack(spacing: 0) {
          Spacer()

          CustomFloatingTabBar(selectedTab: $selectedTab)
            .padding(.bottom, 24)
        }
      }
      .ignoresSafeArea(edges: .bottom)
    }
  }

  // MARK: - Handlers

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
      selectedTab = MainAppTab.scan.rawValue

    case .navigateToContacts:
      selectedTab = MainAppTab.people.rawValue
    }

    deepLinkManager.clearPendingAction()
  }
}
