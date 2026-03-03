import SwiftUI

// MARK: - Create Shoutout View

struct CreateShoutoutView: View {
  @Environment(\.dismiss) private var dismiss
  @State private var recipient: ShoutoutUser?
  @State private var message = ""
  @State private var showingUserPicker = false
  @State private var isTransmitting = false

  init(selectedUser: ShoutoutUser? = nil) {
    self._recipient = State(initialValue: selectedUser)
  }

  var body: some View {
    NavigationStack {
      ZStack {
        Color.Theme.pageBg.ignoresSafeArea()

        VStack(spacing: 24) {
          // Terminal Header
          terminalHeader

          // Target Node Selection
          recipientSelection

          // Payload Input
          messageInput

          Spacer()

          // Transmit Button
          transmitButton
        }
        .padding(24)
      }
      .navigationTitle("P2P Message")
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
      .sheet(isPresented: $showingUserPicker) {
        UserPickerView(selectedUser: $recipient)
      }
      .toastOverlay()
    }
  }

  // MARK: - Terminal Header

  private var terminalHeader: some View {
    HStack {
      Image(systemName: "envelope.badge.shield.half.filled")
        .font(.system(size: 32))
        .foregroundColor(Color.Theme.terminalGreen)
        .opacity(isTransmitting ? 0.3 : 1.0)
        .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: isTransmitting)

      VStack(alignment: .leading, spacing: 4) {
        Text("SECURE TRANSMISSION")
          .font(.system(size: 16, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textPrimary)

        Text("End-to-End Encrypted Payload")
          .font(.system(size: 12, design: .monospaced))
          .foregroundColor(Color.Theme.textSecondary)
      }

      Spacer()
    }
    .padding(16)
    .background(Color.Theme.searchBg)
    .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
  }

  // MARK: - Recipient Selection

  private var recipientSelection: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("TARGET NODE")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textPrimary)

      Button(action: { showingUserPicker = true }) {
        HStack(spacing: 16) {
          if let recipient = recipient {
            ZStack {
              Rectangle()
                .fill(Color.Theme.primaryBlue)
                .frame(width: 48, height: 48)
                .overlay(Rectangle().stroke(Color.Theme.primaryBlue, lineWidth: 1))
              
              Text(recipient.initials)
                .font(.system(size: 16, weight: .bold, design: .monospaced))
                .foregroundColor(.white)
            }

            VStack(alignment: .leading, spacing: 4) {
              Text(recipient.name)
                .font(.system(size: 16, weight: .bold, design: .monospaced))
                .foregroundColor(Color.Theme.textPrimary)

              Text(recipient.company)
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(Color.Theme.textSecondary)
            }
          } else {
            ZStack {
              Rectangle()
                .stroke(Color.Theme.divider, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                .frame(width: 48, height: 48)
              Image(systemName: "person.badge.plus")
                .foregroundColor(Color.Theme.textSecondary)
            }

            Text("Select Target Node")
              .font(.system(size: 14, weight: .bold, design: .monospaced))
              .foregroundColor(Color.Theme.textSecondary)
          }

          Spacer()

          Image(systemName: "chevron.right")
            .font(.system(size: 10, weight: .bold))
            .foregroundColor(Color.Theme.textSecondary)
        }
        .padding(16)
        .background(Color.Theme.cardBg)
        .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
      }
      .buttonStyle(PlainButtonStyle())
    }
  }

  // MARK: - Message Input

  private var messageInput: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("PAYLOAD (MAX 200 BYTES)")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textPrimary)

      VStack(alignment: .trailing, spacing: 8) {
        TextEditor(text: Binding(
          get: { message },
          set: { message = String($0.prefix(200)) }
        ))
        .font(.system(size: 14, design: .monospaced))
        .foregroundColor(Color.Theme.textPrimary)
        .frame(height: 120)
        .padding(12)
        .background(Color.Theme.searchBg)
        .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))

        Text("[\(message.count)/200]")
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .foregroundColor(message.count >= 200 ? Color.Theme.destructive : Color.Theme.textSecondary)
      }
    }
  }

  // MARK: - Transmit Button

  private var transmitButton: some View {
    VStack(spacing: 8) {
      Button(action: sendTransmission) {
        HStack(spacing: 12) {
          Image(systemName: "paperplane.fill")
            .font(.system(size: 14))
          Text(isTransmitting ? "ENCRYPTING & SENDING..." : "TRANSMIT")
            .font(.system(size: 14, weight: .bold, design: .monospaced))
        }
        .frame(maxWidth: .infinity)
      }
      .buttonStyle(ThemedPrimaryButtonStyle())
      .disabled(recipient == nil || message.isEmpty || message.count > 200 || !(recipient?.canReceiveSakura ?? false) || isTransmitting)
      
      if let recipient = recipient, !recipient.canReceiveSakura {
        Text("ERR: Target node has not enabled Secure Messaging.")
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.destructive)
      }
    }
  }

  // MARK: - Actions

  private func sendTransmission() {
    guard let recipient = recipient else { return }

    // Validate that recipient has secure messaging enabled
    guard recipient.canReceiveSakura,
      let recipientSealedRoute = recipient.sealedRoute,
      let recipientPubKey = recipient.pubKey,
      let recipientSignPubKey = recipient.signPubKey
    else {
      Task {
        await MainActor.run {
          ToastManager.shared.show(
            title: "Transmission Failed",
            message: "Node is not configured for encrypted receive protocol.",
            type: .error,
            duration: 3.0
          )
        }
      }
      return
    }

    isTransmitting = true
    HapticFeedbackManager.shared.rigidImpact()

    let messageService = MessageService.shared

    Task {
      do {
        // Create secure contact with the RECIPIENT's route and keys
        let secureContact = SecureContact(
          name: recipient.name,
          pubKey: recipientPubKey,
          signPubKey: recipientSignPubKey,
          sealedRoute: recipientSealedRoute // Use RECIPIENT's route
        )

        // Send P2P message
        try await messageService.sendMessage(to: secureContact, text: message.isEmpty ? "[Empty Payload]" : message)

        await MainActor.run {
          isTransmitting = false
          HapticFeedbackManager.shared.successNotification()
          ToastManager.shared.show(
            title: "SUCCESS",
            message: "Payload encrypted and enqueued for \(recipient.name).",
            type: .success,
            duration: 3.0
          )
          dismiss()
        }
      } catch {
        print("[ShoutoutView] Encrypt/Transmit Error: \(error)")
        await MainActor.run {
          isTransmitting = false
          HapticFeedbackManager.shared.errorNotification()
          ToastManager.shared.show(
            title: "CRITICAL ERR",
            message: "Protocol failure: \(error.localizedDescription)",
            type: .error,
            duration: 4.0
          )
        }
      }
    }
  }
}
