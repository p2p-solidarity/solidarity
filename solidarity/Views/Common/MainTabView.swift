import SwiftUI

struct MainTabView: View {
  @EnvironmentObject var deepLinkManager: DeepLinkManager
  @Environment(\.scenePhase) private var scenePhase
  @State private var showingReceivedCard = false
  @State private var showingErrorAlert = false
  @State private var errorMessage = ""
  @State private var selectedTab = MainAppTab.people.rawValue
  @State private var showingCredentialImport = false
  @State private var pendingCredentialOfferURL = ""
  @State private var pendingContactImport: BusinessCard?

  var body: some View {
    tabContent
      .sheet(isPresented: $showingReceivedCard) {
        if let card = deepLinkManager.lastReceivedCard {
          ReceivedCardView(card: card)
        }
      }
      .sheet(isPresented: $showingCredentialImport) {
        CredentialImportFlowSheet(offerURL: pendingCredentialOfferURL)
      }
      .alert(
        String(localized: "Add this contact?"),
        isPresented: Binding(
          get: { pendingContactImport != nil },
          set: { newValue in if !newValue { pendingContactImport = nil } }
        ),
        presenting: pendingContactImport
      ) { card in
        Button(String(localized: "Add")) {
          deepLinkManager.confirmPendingContactImport(card)
          pendingContactImport = nil
        }
        Button(String(localized: "Cancel"), role: .cancel) {
          pendingContactImport = nil
        }
      } message: { card in
        let detail = card.title.flatMap { $0.isEmpty ? nil : $0 }.map { " (\($0))" } ?? ""
        Text(String(localized: "A link is requesting to save \(card.name)\(detail) to your contacts."))
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
    ZStack(alignment: .bottom) {
      Color.Theme.pageBg.ignoresSafeArea()

      TabView(selection: $selectedTab) {
        PeopleListView()
          .tag(MainAppTab.people.rawValue)

        SharingTabView()
          .tag(MainAppTab.share.rawValue)

        MeTabView()
          .tag(MainAppTab.me.rawValue)
      }
      .tabViewStyle(DefaultTabViewStyle())
      .toolbarBackground(.hidden, for: .tabBar)
      .toolbar(.hidden, for: .tabBar)
      .ignoresSafeArea(.keyboard)

      CustomFloatingTabBar(selectedTab: $selectedTab)
    }
    .ignoresSafeArea(edges: .bottom)
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
      selectedTab = MainAppTab.share.rawValue

    case .navigateToContacts:
      selectedTab = MainAppTab.people.rawValue

    case .credentialOffer(let offerURL):
      pendingCredentialOfferURL = offerURL
      showingCredentialImport = true

    case .confirmContactImport(let card):
      pendingContactImport = card
    }

    deepLinkManager.clearPendingAction()
  }
}
