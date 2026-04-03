import SwiftUI

extension ProximitySharingView {

  var headerCard: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text(currentStepTitle.uppercased())
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.terminalGreen)
        Spacer()
        Image(systemName: "dot.radiowaves.left.and.right")
          .foregroundColor(isMatchingActive ? Color.Theme.primaryBlue : Color.Theme.textTertiary)
      }
      Text(currentSubtitle)
        .font(.system(size: 14))
        .foregroundColor(Color.Theme.textSecondary)
    }
    .padding(16)
    .background(Color.Theme.searchBg)
    .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
  }

  // MARK: - Discovery

  var discoveryStep: some View {
    VStack(alignment: .leading, spacing: 24) {
      if selectedCard == nil {
        Button("Create Identity Card First") {
          showingCreateCard = true
        }
        .buttonStyle(ThemedPrimaryButtonStyle())
      }

      if proximityManager.nearbyPeers.isEmpty {
        VStack(spacing: 16) {
          ProgressView()
            .progressViewStyle(CircularProgressViewStyle(tint: Color.Theme.primaryBlue))
            .scaleEffect(1.5)

          Text("SCANNING...")
            .font(.system(size: 16, weight: .bold, design: .monospaced))
            .foregroundColor(Color.Theme.primaryBlue)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, 48)
      } else {
        ScrollView {
          VStack(spacing: 12) {
            ForEach(proximityManager.nearbyPeers) { peer in
              Button {
                HapticFeedbackManager.shared.rigidImpact()
                selectedPeer = peer
                proximityManager.connectToPeer(peer)
                withAnimation { step = .scope }
              } label: {
                HStack(spacing: 16) {
                  ZStack {
                    Rectangle()
                      .fill(Color.Theme.primaryBlue)
                      .frame(width: 48, height: 48)
                    Text(String(peer.name.prefix(1)).uppercased())
                      .font(.system(size: 20, weight: .bold, design: .monospaced))
                      .foregroundColor(.white)
                  }

                  VStack(alignment: .leading, spacing: 4) {
                    Text(peer.name)
                      .font(.system(size: 16, weight: .bold))
                      .foregroundColor(Color.Theme.textPrimary)
                    Text(peer.cardTitle ?? "Peer Node")
                      .font(.system(size: 12, weight: .regular, design: .monospaced))
                      .foregroundColor(Color.Theme.textSecondary)
                  }
                  Spacer()
                  Text("[ CONNECT ]")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundColor(Color.Theme.terminalGreen)
                }
                .padding(16)
                .background(Color.Theme.cardBg)
                .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
              }
              .buttonStyle(.plain)
            }
          }
        }
      }

      Spacer()

      Button(isMatchingActive ? "Stop Scan" : "Start Scan") {
        if isMatchingActive {
          proximityManager.stopAdvertising()
          proximityManager.stopBrowsing()
        } else {
          proximityManager.startMatching(with: nil)
        }
      }
      .buttonStyle(ThemedSecondaryButtonStyle())
    }
  }

  // MARK: - Scope (Selective Disclosure)

  var scopeStep: some View {
    VStack(alignment: .leading, spacing: 24) {
      VStack(alignment: .leading, spacing: 8) {
        Text("SELECTIVE DISCLOSURE")
          .font(.system(size: 12, weight: .bold, design: .monospaced))
          .foregroundColor(.white)

        Text("Select the claims you wish to reveal to \(selectedPeer?.name ?? "peer").")
          .font(.system(size: 14))
          .foregroundColor(Color.Theme.textSecondary)
      }

      ScrollView {
        VStack(spacing: 8) {
          ForEach(BusinessCardField.allCases) { field in
            RedactionSwitcherView(
              label: field.displayName,
              value: extractValue(from: selectedCard, field: field),
              isDisclosed: Binding(
                get: { selectedFields.contains(field) },
                set: { isOn in
                  if isOn { selectedFields.insert(field) } else { selectedFields.remove(field) }
                  selectedFields.insert(.name) // Always required
                }
              )
            )
          }
        }
      }
      .frame(maxHeight: 280)

      VStack(alignment: .leading, spacing: 4) {
        Text("Ephemeral Message (\(myMessage.count)/140)")
          .font(.system(size: 12, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textSecondary)

        TextEditor(text: Binding(
          get: { myMessage },
          set: { myMessage = String($0.prefix(140)) }
        ))
        .font(.system(size: 14, design: .monospaced))
        .foregroundColor(Color.Theme.textPrimary)
        .frame(height: 80)
        .padding(12)
        .background(Color.Theme.searchBg)
        .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
      }

      VStack(spacing: 12) {
        Button(action: sendExchangeRequest) {
          Text("Generate & Transmit ZK Proof")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(ThemedPrimaryButtonStyle())
        .disabled(selectedPeer == nil || selectedCard == nil || selectedFields.isEmpty || isWorking)

        Button("Abort Connection") {
          withAnimation { step = .discovery }
        }
        .buttonStyle(ThemedSecondaryButtonStyle())
      }
    }
  }

  // MARK: - Awaiting

  var awaitingStep: some View {
    VStack(spacing: 24) {
      Spacer()

      ZStack {
        Circle()
          .stroke(Color.Theme.terminalGreen.opacity(0.3), lineWidth: 2)
          .frame(width: 80, height: 80)
        Circle()
          .fill(Color.Theme.terminalGreen)
          .frame(width: 16, height: 16)
      }

      VStack(spacing: 8) {
        Text("AWAITING PEER")
          .font(.system(size: 16, weight: .bold, design: .monospaced))
          .foregroundColor(.white)
        Text("Handshake initiated with \(selectedPeer?.name ?? "peer").")
          .font(.system(size: 14))
          .foregroundColor(Color.Theme.textSecondary)
      }

      Spacer()

      Button("Terminate") {
        awaitingRequestID = nil
        withAnimation { step = .discovery }
      }
      .buttonStyle(ThemedSecondaryButtonStyle())
    }
    .frame(maxWidth: .infinity)
  }

  // MARK: - Incoming

  var incomingStep: some View {
    Group {
      if let request = proximityManager.pendingExchangeRequest {
        VStack(alignment: .leading, spacing: 24) {
          VStack(alignment: .leading, spacing: 8) {
            Text("INBOUND CONNECTION")
              .font(.system(size: 12, weight: .bold, design: .monospaced))
              .foregroundColor(Color.Theme.primaryBlue)

            Text("Connection request from \(request.payload.senderID)")
              .font(.system(size: 16, weight: .bold))
              .foregroundColor(.white)
          }

          fieldPicker(selection: $incomingFields)

          VStack(alignment: .leading, spacing: 4) {
            Text("Reply Message (\(incomingMessage.count)/140)")
              .font(.system(size: 12, weight: .bold, design: .monospaced))
              .foregroundColor(Color.Theme.textSecondary)

            TextEditor(text: Binding(
              get: { incomingMessage },
              set: { incomingMessage = String($0.prefix(140)) }
            ))
            .font(.system(size: 14, design: .monospaced))
            .foregroundColor(Color.Theme.textPrimary)
            .frame(height: 80)
            .padding(12)
            .background(Color.Theme.searchBg)
            .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
          }

          HStack(spacing: 16) {
            Button("Reject") {
              proximityManager.declinePendingExchangeRequest()
              withAnimation { step = .discovery }
            }
            .buttonStyle(ThemedSecondaryButtonStyle())

            Button("Sign & Accept") {
              acceptExchange(request)
            }
            .buttonStyle(ThemedPrimaryButtonStyle())
            .disabled(selectedCard == nil || incomingFields.isEmpty || isWorking)
          }
        }
      } else {
        Text("No pending stream.")
          .foregroundColor(Color.Theme.textSecondary)
      }
    }
  }

  // MARK: - Saved

  var savedStep: some View {
    VStack(spacing: 24) {
      Spacer()

      Image(systemName: "checkmark.seal.fill")
        .font(.system(size: 64))
        .foregroundColor(Color.Theme.terminalGreen)
        .shadow(color: Color.Theme.terminalGreen.opacity(0.5), radius: 10)

      VStack(spacing: 8) {
        Text("HANDSHAKE COMPLETE")
          .font(.system(size: 20, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textPrimary)

        Text("Cryptographic signatures successfully exchanged.")
          .font(.system(size: 14))
          .foregroundColor(Color.Theme.textSecondary)
          .multilineTextAlignment(.center)
      }

      if let completion = latestCompletion {
        VStack(alignment: .leading, spacing: 12) {
          infoRow(label: "NODE ID", value: completion.peerName)
          infoRow(label: "TX MSG", value: completion.myMessage ?? "—")
          infoRow(label: "RX MSG", value: completion.theirMessage ?? "—")
        }
        .padding(16)
        .background(Color.Theme.searchBg)
        .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
      }

      Spacer()

      Button("Acknowledge") {
        dismiss()
      }
      .buttonStyle(ThemedInvertedButtonStyle())
    }
  }
}
