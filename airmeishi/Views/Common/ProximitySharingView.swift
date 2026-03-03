import SwiftUI

struct ProximitySharingView: View {
  private enum ExchangeStep {
    case discovery
    case scope
    case awaiting
    case incoming
    case saved
  }

  @StateObject private var proximityManager = ProximityManager.shared
  @StateObject private var cardManager = CardManager.shared
  @Environment(\.dismiss) private var dismiss

  @State private var step: ExchangeStep = .discovery
  @State private var selectedPeer: ProximityPeer?
  @State private var selectedFields: Set<BusinessCardField> = [.name, .title, .company, .email]
  @State private var myMessage = ""
  @State private var incomingFields: Set<BusinessCardField> = [.name, .title, .company]
  @State private var incomingMessage = ""
  @State private var awaitingRequestID: UUID?
  @State private var latestCompletion: ExchangeCompletionEvent?
  @State private var showingCreateCard = false
  @State private var isWorking = false
  @State private var showingAlert = false
  @State private var alertMessage = ""

  private var selectedCard: BusinessCard? {
    cardManager.businessCards.first
  }

  var body: some View {
    NavigationStack {
      VStack(spacing: 12) {
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
      .padding(16)
      .background(Color.Theme.pageBg.ignoresSafeArea())
      .navigationTitle("Sharing")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarLeading) {
          Button("Close") { dismiss() }
        }
      }
      .sheet(isPresented: $showingCreateCard) {
        BusinessCardFormView(forceCreate: true) { _ in
          showingCreateCard = false
        }
      }
      .alert("Exchange", isPresented: $showingAlert) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(alertMessage)
      }
      .onReceive(proximityManager.$pendingExchangeRequest) { request in
        guard let request else { return }
        incomingFields = Set(request.payload.selectedFields)
        incomingMessage = ""
        step = .incoming
      }
      .onReceive(proximityManager.$latestExchangeCompletion) { completion in
        guard let completion else { return }
        if awaitingRequestID == completion.requestId || awaitingRequestID == nil {
          latestCompletion = completion
          step = .saved
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

  private var headerCard: some View {
    SolidarityPlaceholderCard(
      screenID: currentScreenID,
      title: currentTitle,
      subtitle: currentSubtitle
    )
  }

  private var discoveryStep: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text("Match")
          .font(.subheadline.weight(.semibold))
          .foregroundColor(Color.Theme.textPrimary)
        Spacer()
        Button(isMatchingActive ? "Stop" : "Start") {
          if isMatchingActive {
            proximityManager.stopAdvertising()
            proximityManager.stopBrowsing()
          } else {
            proximityManager.startMatching(with: nil)
          }
        }
        .font(.caption.weight(.semibold))
        .foregroundColor(Color.Theme.primaryBlue)
      }

      if selectedCard == nil {
        Button("Create Identity Card First") {
          showingCreateCard = true
        }
        .buttonStyle(ThemedPrimaryButtonStyle())
      }

      if proximityManager.nearbyPeers.isEmpty {
        VStack(spacing: 10) {
          ProgressView()
          Text("正在搜尋附近的裝置⋯")
            .font(.caption)
            .foregroundColor(Color.Theme.textSecondary)
          Text("請確保兩台裝置都開啟此畫面")
            .font(.caption)
            .foregroundColor(Color.Theme.textTertiary)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, 24)
      } else {
        ScrollView {
          VStack(spacing: 8) {
            ForEach(proximityManager.nearbyPeers) { peer in
              Button {
                selectedPeer = peer
                proximityManager.connectToPeer(peer)
                step = .scope
              } label: {
                HStack(spacing: 12) {
                  Circle()
                    .fill(
                      LinearGradient(
                        colors: [Color.Theme.primaryBlue, Color.Theme.dustyMauve],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                      )
                    )
                    .frame(width: 36, height: 36)
                    .overlay(
                      Text(String(peer.name.prefix(1)).uppercased())
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white)
                    )

                  VStack(alignment: .leading, spacing: 2) {
                    Text(peer.name)
                      .font(.subheadline.weight(.semibold))
                      .foregroundColor(Color.Theme.textPrimary)
                    Text(peer.cardTitle ?? "Ready for exchange")
                      .font(.caption)
                      .foregroundColor(Color.Theme.textSecondary)
                  }
                  Spacer()
                  Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(Color.Theme.textPlaceholder)
                }
                .padding(12)
                .background(
                  RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.Theme.cardBg)
                    .overlay(
                      RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Color.Theme.divider, lineWidth: 0.5)
                    )
                )
              }
              .buttonStyle(.plain)
            }
          }
        }
      }
    }
  }

  private var scopeStep: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Select fields to share with \(selectedPeer?.name ?? "peer")")
        .font(.subheadline)
        .foregroundColor(Color.Theme.textSecondary)

      fieldPicker(selection: $selectedFields)

      VStack(alignment: .leading, spacing: 4) {
        Text("One-time message (\(myMessage.count)/140)")
          .font(.caption.weight(.semibold))
          .foregroundColor(Color.Theme.textSecondary)
        TextEditor(text: Binding(
          get: { myMessage },
          set: { myMessage = String($0.prefix(140)) }
        ))
        .frame(height: 72)
        .padding(6)
        .background(Color.Theme.searchBg)
        .cornerRadius(12)
      }

      Button {
        sendExchangeRequest()
      } label: {
        Text("Send Exchange Request")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(ThemedRoseButtonStyle())
      .disabled(selectedPeer == nil || selectedCard == nil || selectedFields.isEmpty || isWorking)

      Button("Back to Discovery") {
        step = .discovery
      }
      .buttonStyle(ThemedSecondaryButtonStyle())
    }
  }

  private var awaitingStep: some View {
    VStack(spacing: 16) {
      Spacer()

      ProgressView()
        .scaleEffect(1.5)

      Text("等待 \(selectedPeer?.name ?? "peer") 回應中⋯")
        .font(.subheadline)
        .foregroundColor(Color.Theme.textSecondary)

      Spacer()

      Button("Cancel Request") {
        awaitingRequestID = nil
        step = .discovery
      }
      .buttonStyle(ThemedSecondaryButtonStyle())
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 24)
  }

  private var incomingStep: some View {
    Group {
      if let request = proximityManager.pendingExchangeRequest {
        VStack(alignment: .leading, spacing: 12) {
          Text("Incoming request from \(request.payload.senderID)")
            .font(.subheadline)
            .foregroundColor(Color.Theme.textSecondary)

          fieldPicker(selection: $incomingFields)

          VStack(alignment: .leading, spacing: 4) {
            Text("Reply message (\(incomingMessage.count)/140)")
              .font(.caption.weight(.semibold))
              .foregroundColor(Color.Theme.textSecondary)
            TextEditor(text: Binding(
              get: { incomingMessage },
              set: { incomingMessage = String($0.prefix(140)) }
            ))
            .frame(height: 72)
            .padding(6)
            .background(Color.Theme.searchBg)
            .cornerRadius(12)
          }

          HStack(spacing: 12) {
            Button("Decline") {
              proximityManager.declinePendingExchangeRequest()
              step = .discovery
            }
            .buttonStyle(ThemedSecondaryButtonStyle())

            Button("Accept & Sign") {
              acceptExchange(request)
            }
            .buttonStyle(ThemedPrimaryButtonStyle())
            .disabled(selectedCard == nil || incomingFields.isEmpty || isWorking)
          }
        }
      } else {
        Text("No pending exchange request.")
          .font(.caption)
          .foregroundColor(Color.Theme.textSecondary)
      }
    }
  }

  private var savedStep: some View {
    VStack(spacing: 16) {
      Spacer()

      Image(systemName: "checkmark.circle.fill")
        .font(.system(size: 48))
        .foregroundColor(.green)

      Text("交換完成")
        .font(.title3.weight(.semibold))
        .foregroundColor(Color.Theme.textPrimary)

      Text("雙方簽章與訊息已儲存")
        .font(.subheadline)
        .foregroundColor(Color.Theme.textSecondary)

      if let completion = latestCompletion {
        VStack(alignment: .leading, spacing: 6) {
          infoRow(label: "Peer", value: completion.peerName)
          infoRow(label: "My message", value: completion.myMessage ?? "—")
          infoRow(label: "Their message", value: completion.theirMessage ?? "—")
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
          RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(Color.Theme.cardBg)
            .overlay(
              RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.Theme.divider, lineWidth: 0.5)
            )
        )
      }

      Spacer()

      Button("Done") {
        dismiss()
      }
      .buttonStyle(ThemedPrimaryButtonStyle())
    }
  }

  private func infoRow(label: String, value: String) -> some View {
    HStack(alignment: .top, spacing: 8) {
      Text(label)
        .font(.caption.weight(.semibold))
        .foregroundColor(Color.Theme.textTertiary)
        .frame(width: 80, alignment: .leading)
      Text(value)
        .font(.caption)
        .foregroundColor(Color.Theme.textPrimary)
    }
  }

  private func fieldPicker(selection: Binding<Set<BusinessCardField>>) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(BusinessCardField.allCases) { field in
        Toggle(isOn: Binding(
          get: { selection.wrappedValue.contains(field) },
          set: { isOn in
            if isOn {
              selection.wrappedValue.insert(field)
            } else {
              selection.wrappedValue.remove(field)
            }
            selection.wrappedValue.insert(.name)
          }
        )) {
          Text(field.displayName)
            .font(.caption)
        }
      }
    }
    .padding(12)
    .background(
      RoundedRectangle(cornerRadius: 12, style: .continuous)
        .fill(Color.Theme.cardBg)
        .overlay(
          RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(Color.Theme.divider, lineWidth: 0.5)
        )
    )
  }

  private var currentScreenID: SolidarityScreenID {
    switch step {
    case .discovery: return .exchangeDiscovery
    case .scope: return .exchangeScope
    case .awaiting: return .exchangeAwaiting
    case .incoming: return .exchangeIncoming
    case .saved: return .exchangeSaved
    }
  }

  private var currentTitle: String {
    switch step {
    case .discovery: return "Ready to Match"
    case .scope: return "Confirm Sharing Scope"
    case .awaiting: return "Awaiting Response"
    case .incoming: return "Incoming Request"
    case .saved: return "Exchange Complete"
    }
  }

  private var currentSubtitle: String {
    switch step {
    case .discovery: return "保持畫面開啟，我們會在配對成功時通知你"
    case .scope: return "選擇要分享的欄位並附上一則訊息"
    case .awaiting: return "正在等待對方確認"
    case .incoming: return "審核並接受交換請求"
    case .saved: return "雙方簽章已儲存至聯絡人"
    }
  }

  private func sendExchangeRequest() {
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
          step = .awaiting
        case .failure(let error):
          show(error.localizedDescription)
        }
      }
    }
  }

  private func acceptExchange(_ request: PendingExchangeRequest) {
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
          step = .saved
        case .failure(let error):
          show(error.localizedDescription)
        }
      }
    }
  }

  private func show(_ message: String) {
    alertMessage = message
    showingAlert = true
  }

  private var isMatchingActive: Bool {
    proximityManager.isAdvertising || proximityManager.isBrowsing
  }
}
