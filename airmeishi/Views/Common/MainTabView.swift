import SwiftUI

struct MainTabView: View {
  @EnvironmentObject var deepLinkManager: DeepLinkManager
  @State private var showingReceivedCard = false
  @State private var showingErrorAlert = false
  @State private var errorMessage = ""
  @State private var selectedTab = MainAppTab.people.rawValue
  @State private var showingShareFlow = false

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
      .padding(.bottom, 80)

      // Fixed Elements over the TabView
      VStack(spacing: 0) {
        Spacer()
        
        ZStack(alignment: .bottom) {
          // Retro Tab Bar (Softened Pill)
          CustomFloatingTabBar(selectedTab: $selectedTab)
            .padding(.bottom, 24)
          
          // Center Share Button overlapping the TabBar
          ShareFloatingActionButton {
            showingShareFlow = true
          }
          .padding(.bottom, 36)
        }
      }
    }
    .ignoresSafeArea(edges: .bottom)
    .fullScreenCover(isPresented: $showingShareFlow) {
      if let myEntity = IdentityDataStore.shared.identityCards.first,
         let myCard = try? myEntity.toBusinessCard() {
        NavigationView {
          // Wrap QRSharingView in a modal container to allow scanning or sharing
          QRSharingView(businessCard: myCard)
            .toolbar {
              ToolbarItem(placement: .navigationBarLeading) {
                Button(action: { showingShareFlow = false }) {
                  Image(systemName: "xmark")
                    .foregroundColor(Color.Theme.textPrimary)
                }
              }
            }
        }
      } else {
        // Fallback if no card exists
        NavigationView {
          VStack {
            Text("Create a profile first to share your card.")
              .foregroundColor(Color.Theme.textSecondary)
          }
          .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
              Button("Close") { showingShareFlow = false }
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
      selectedTab = MainAppTab.people.rawValue
      showingShareFlow = true

    case .navigateToContacts:
      selectedTab = MainAppTab.people.rawValue
    }

    deepLinkManager.clearPendingAction()
  }
}
