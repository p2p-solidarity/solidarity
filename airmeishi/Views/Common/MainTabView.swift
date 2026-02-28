import SwiftUI

struct MainTabView: View {
  @EnvironmentObject var deepLinkManager: DeepLinkManager
  @State private var showingReceivedCard = false
  @State private var showingErrorAlert = false
  @State private var errorMessage = ""
  @State private var selectedTab = 0

  var body: some View {
    Group {
      if #available(iOS 26.0, *) {
        nativeTabView
      } else {
        customTabView
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
          action: {}
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
    .onReceive(NotificationCenter.default.publisher(for: .secureMessageReceived)) { notification in
      guard NotificationSettingsManager.shared.enableInAppToast else { return }

      #if canImport(UIKit)
      guard UIApplication.shared.applicationState == .active else { return }
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
    TabView(selection: $selectedTab) {
      MeTabView()
        .tabItem {
          Label("Me", systemImage: "person.text.rectangle")
        }
        .tag(0)

      PeopleListView()
        .tabItem {
          Label("People", systemImage: "person.2.fill")
        }
        .tag(1)

      ScanTabView()
        .tabItem {
          Label("Scan", systemImage: "qrcode.viewfinder")
        }
        .tag(2)
    }
    .toolbarBackground(Color.Theme.pageBg, for: .tabBar)
    .toolbarBackground(.visible, for: .tabBar)
  }

  // MARK: - Custom Tab View (iOS < 26)
  private var customTabView: some View {
    ZStack(alignment: .bottom) {
      TabView(selection: $selectedTab) {
        MeTabView()
          .tag(0)

        PeopleListView()
          .tag(1)

        ScanTabView()
          .tag(2)
      }
      .tabViewStyle(DefaultTabViewStyle())
      .toolbarBackground(.hidden, for: .tabBar)
      .toolbar(.hidden, for: .tabBar)

      CustomFloatingTabBar(selectedTab: $selectedTab)
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
      selectedTab = MainAppTab.people.rawValue

    case .navigateToContacts:
      selectedTab = MainAppTab.people.rawValue
    }

    deepLinkManager.clearPendingAction()
  }
}
