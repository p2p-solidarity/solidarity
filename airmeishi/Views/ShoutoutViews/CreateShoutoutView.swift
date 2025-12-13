//
//  CreateShoutoutView.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import SwiftUI

// MARK: - Create Shoutout View

struct CreateShoutoutView: View {
  @Environment(\.dismiss) private var dismiss
  @State private var recipient: ShoutoutUser?
  @State private var message = ""
  @State private var showingUserPicker = false
  @State private var isSakuraAnimating = false

  init(selectedUser: ShoutoutUser? = nil) {
    self._recipient = State(initialValue: selectedUser)
  }

  var body: some View {
    NavigationView {
      ZStack {
        // Dark background with lightning effect
        LinearGradient(
          colors: [
            Color.black,
            Color.purple.opacity(0.1),
            Color.blue.opacity(0.05),
            Color.black,
          ],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )
        .ignoresSafeArea()

        VStack(spacing: 24) {
          // Sakura header
          sakuraHeader

          // Recipient Selection
          recipientSelection

          // Message Input
          messageInput

          Spacer()

          // Send Button with sakura effect
          sakuraSendButton
        }
        .padding()
      }
      .navigationTitle("Sakura Ichigoichie")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarLeading) {
          Button("Cancel") {
            dismiss()
          }
        }
      }
      .sheet(isPresented: $showingUserPicker) {
        UserPickerView(selectedUser: $recipient)
      }
      .toastOverlay()
      .onAppear {
        startSakuraAnimation()
      }
    }
    .preferredColorScheme(.dark)
  }

  // MARK: - Sakura Header

  private var sakuraHeader: some View {
    HStack {
      SakuraIconView(size: 32, color: .pink, isAnimating: isSakuraAnimating)

      VStack(alignment: .leading, spacing: 2) {
        Text("Send Sakura")
          .font(.title2)
          .fontWeight(.bold)
          .foregroundColor(.white)

        Text("A once-in-a-lifetime encounter 🌸")
          .font(.caption)
          .foregroundColor(.gray)
      }

      Spacer()
    }
  }

  // MARK: - Recipient Selection

  private var recipientSelection: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text("Recipient")
          .font(.headline)
          .foregroundColor(.white)

        Spacer()

        Image(systemName: "person.circle.fill")
          .foregroundColor(.pink)
          .font(.title3)
      }

      Button(action: { showingUserPicker = true }) {
        HStack {
          if let recipient = recipient {
            AsyncImage(url: recipient.profileImageURL) { image in
              image
                .resizable()
                .aspectRatio(contentMode: .fill)
            } placeholder: {
              Circle()
                .fill(
                  LinearGradient(
                    colors: [.blue, .purple],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                  )
                )
                .overlay {
                  Text(recipient.initials)
                    .font(.headline)
                    .foregroundColor(.white)
                }
            }
            .frame(width: 50, height: 50)
            .clipShape(Circle())
            .overlay(
              Circle()
                .stroke(Color.pink, lineWidth: 2)
                .scaleEffect(isSakuraAnimating ? 1.1 : 1.0)
                .animation(
                  .easeInOut(duration: 0.5).repeatForever(autoreverses: true),
                  value: isSakuraAnimating
                )
            )

            VStack(alignment: .leading) {
              Text(recipient.name)
                .font(.headline)
                .foregroundColor(.white)

              Text(recipient.company)
                .font(.subheadline)
                .foregroundColor(.gray)
            }
          } else {
            Image(systemName: "person.circle.dashed")
              .font(.title)
              .foregroundColor(.gray)

            Text("Select Recipient")
              .font(.headline)
              .foregroundColor(.white)
          }

          Spacer()

          Image(systemName: "chevron.right")
            .foregroundColor(.gray)
        }
        .padding()
        .background(
          RoundedRectangle(cornerRadius: 12)
            .fill(Color.white.opacity(0.05))
            .overlay(
              RoundedRectangle(cornerRadius: 12)
                .stroke(Color.pink.opacity(0.3), lineWidth: 1)
            )
        )
      }
      .buttonStyle(PlainButtonStyle())
    }
  }

  // MARK: - Message Input

  private var messageInput: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text("Sakura Message")
          .font(.headline)
          .foregroundColor(.white)

        Spacer()

        SakuraIconView(size: 24, color: .pink, isAnimating: isSakuraAnimating)
      }

      VStack(alignment: .leading, spacing: 8) {
        TextField("A beautiful encounter worth cherishing 🌸", text: $message, axis: .vertical)
          .textFieldStyle(PlainTextFieldStyle())
          .foregroundColor(.white)
          .padding()
          .background(
            RoundedRectangle(cornerRadius: 12)
              .fill(Color.white.opacity(0.05))
              .overlay(
                RoundedRectangle(cornerRadius: 12)
                  .stroke(
                    isSakuraAnimating ? Color.pink.opacity(0.5) : Color.white.opacity(0.1),
                    lineWidth: 1
                  )
              )
          )
          .lineLimit(3...6)

        Text("\(message.count)/200 characters")
          .font(.caption)
          .foregroundColor(.gray)
          .frame(maxWidth: .infinity, alignment: .trailing)
      }
    }
  }

  // MARK: - Sakura Send Button

  private var sakuraSendButton: some View {
    VStack(spacing: 0) {
      Button(action: sendIchigoichie) {
        HStack(spacing: 12) {
          SakuraIconView(size: 24, color: .white, isAnimating: isSakuraAnimating)

          Text("Send Sakura")
            .font(.headline)
            .fontWeight(.bold)
        }
        .foregroundColor(.white)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(
          RoundedRectangle(cornerRadius: 16)
            .fill(
              LinearGradient(
                colors: [.pink.opacity(0.8), .purple.opacity(0.6), .pink.opacity(0.8)],
                startPoint: .leading,
                endPoint: .trailing
              )
            )
            .shadow(color: .pink.opacity(0.5), radius: 10, x: 0, y: 0)
        )
      }
      .disabled(recipient == nil || message.isEmpty || message.count > 200 || !(recipient?.canReceiveSakura ?? false))
      .opacity(
        (recipient == nil || message.isEmpty || message.count > 200 || !(recipient?.canReceiveSakura ?? false))
          ? 0.5 : 1.0
      )

      if let recipient = recipient, !recipient.canReceiveSakura {
        Text("This user hasn't enabled Secure Messaging yet.")
          .font(.caption)
          .foregroundColor(.gray)
          .padding(.top, 4)
      }
    }
  }

  // MARK: - Actions

  private func sendIchigoichie() {
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
            title: "Error",
            message: "This user hasn't enabled Secure Messaging yet.",
            type: .error,
            duration: 2.0
          )
        }
      }
      return
    }

    // Use new async MessageService (no need for both users to be online)
    let messageService = MessageService.shared

    Task {
      do {
        // Create secure contact with the RECIPIENT's route and keys
        let secureContact = SecureContact(
          name: recipient.name,
          pubKey: recipientPubKey,
          signPubKey: recipientSignPubKey,
          sealedRoute: recipientSealedRoute  // Use RECIPIENT's route, not sender's!
        )

        // Send sakura message (async, works even if recipient is offline)
        try await messageService.sendMessage(to: secureContact, text: message.isEmpty ? "🌸" : message)

        await MainActor.run {
          // UI Feedback
          withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
            isSakuraAnimating = true
          }

          DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            ToastManager.shared.show(
              title: "Sakura Sent!",
              message: "Your Ichigoichie message will be delivered when \(recipient.name) is online! 🌸",
              type: .success,
              duration: 3.0
            )
            dismiss()
          }
        }
      } catch {
        print("[ShoutoutView] Error: \(error)")
        await MainActor.run {
          ToastManager.shared.show(
            title: "Error",
            message: "Failed to send: \(error.localizedDescription)",
            type: .error,
            duration: 2.0
          )
        }
      }
    }
  }

  private func startSakuraAnimation() {
    isSakuraAnimating = true
  }
}
