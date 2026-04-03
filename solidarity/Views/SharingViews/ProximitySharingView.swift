import SwiftUI

struct ProximitySharingView: View {

  @StateObject var proximityManager = ProximityManager.shared
  @StateObject var cardManager = CardManager.shared
  @Environment(\.dismiss) var dismiss

  @State var step: ExchangeStep = .discovery
  @State var selectedPeer: ProximityPeer?
  @State var selectedFields: Set<BusinessCardField> = [.name, .title, .company, .email]
  @State var myMessage = ""
  @State var incomingFields: Set<BusinessCardField> = [.name, .title, .company]
  @State var incomingMessage = ""
  @State var awaitingRequestID: UUID?
  @State var latestCompletion: ExchangeCompletionEvent?
  @State var showingCreateCard = false
  @State var isWorking = false
  @State var showingAlert = false
  @State var alertMessage = ""

  var selectedCard: BusinessCard? {
    cardManager.businessCards.first
  }

  var body: some View {
    NavigationStack {
      VStack(spacing: 24) {
        headerCard

        Group {
          switch step {
          case .discovery:
            discoveryStep
          case .scope:
            scopeStep
          case .awaiting:
            awaitingStep
          case .incoming:
            incomingStep
          case .saved:
            savedStep
          }
        }

        Spacer(minLength: 0)
      }
      .padding(24)
      .background(Color.Theme.pageBg.ignoresSafeArea())
      .navigationTitle("Radar")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarLeading) {
          Button {
            dismiss()
          } label: {
            Image(systemName: "xmark")
              .foregroundColor(Color.Theme.textPrimary)
          }
        }
      }
      .sheet(isPresented: $showingCreateCard) {
        BusinessCardFormView(forceCreate: true) { _ in
          showingCreateCard = false
        }
      }
      .alert("Error", isPresented: $showingAlert) {
        Button("Dismiss", role: .cancel) {}
      } message: {
        Text(alertMessage)
      }
      .onReceive(proximityManager.$pendingExchangeRequest) { request in
        guard let request else { return }
        incomingFields = Set(request.payload.selectedFields)
        incomingMessage = ""
        withAnimation { step = .incoming }
      }
      .onReceive(proximityManager.$latestExchangeCompletion) { completion in
        guard let completion else { return }
        if awaitingRequestID == completion.requestId || awaitingRequestID == nil {
          latestCompletion = completion
          withAnimation { step = .saved }
          awaitingRequestID = nil
        }
      }
      .onAppear {
        proximityManager.startMatching(with: nil)
      }
      .onDisappear {
        proximityManager.stopAdvertising()
        proximityManager.stopBrowsing()
      }
    }
  }

  // MARK: - Actions

  func sendExchangeRequest() {
    guard let selectedPeer, let selectedCard else { return }
    isWorking = true

    BiometricGatekeeper.shared.authorizeIfRequired(.issueCredential) { authResult in
      switch authResult {
      case .failure(let error):
        isWorking = false
        show(error.localizedDescription)
      case .success:
        let sendResult = proximityManager.sendExchangeRequest(
          card: selectedCard,
          to: selectedPeer.peerID,
          selectedFields: Array(selectedFields),
          myEphemeralMessage: myMessage
        )
        isWorking = false
        switch sendResult {
        case .success(let requestId):
          awaitingRequestID = requestId
          withAnimation { step = .awaiting }
        case .failure(let error):
          show(error.localizedDescription)
        }
      }
    }
  }

  func acceptExchange(_ request: PendingExchangeRequest) {
    guard let selectedCard else { return }
    isWorking = true
    BiometricGatekeeper.shared.authorizeIfRequired(.issueCredential) { authResult in
      switch authResult {
      case .failure(let error):
        isWorking = false
        show(error.localizedDescription)
      case .success:
        let result = proximityManager.respondToExchangeRequest(
          request,
          with: selectedCard,
          selectedFields: Array(incomingFields),
          myEphemeralMessage: incomingMessage
        )
        isWorking = false
        switch result {
        case .success:
          latestCompletion = ExchangeCompletionEvent(
            peerName: request.payload.senderID,
            card: request.payload.cardPreview,
            requestId: request.requestId,
            mySignature: "",
            theirSignature: request.payload.myExchangeSignature,
            myMessage: incomingMessage,
            theirMessage: request.payload.myEphemeralMessage
          )
          withAnimation { step = .saved }
        case .failure(let error):
          show(error.localizedDescription)
        }
      }
    }
  }

  func show(_ message: String) {
    alertMessage = message
    showingAlert = true
  }
}
