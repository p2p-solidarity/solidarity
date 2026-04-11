//
//  ShoutoutDetailView.swift
//  solidarity
//
//  Lightening-themed detailed view for a specific user in the shoutout system
//

import SwiftUI

struct ShoutoutDetailView: View {
  let user: ShoutoutUser
  @Environment(\.dismiss) var dismiss
  @Environment(\.colorScheme) var colorScheme
  @State var showingCreateShoutout = false
  @State var isSakuraAnimating = false
  @State var showingDeleteConfirm = false
  @State var isLoading = true
  @State var showingProfile = false
  @State var selectedContact: Contact?
  @State var showingShareSheet = false
  @State var latestSakuraMessage: String?

  init(user: ShoutoutUser) {
    self.user = user
  }

  var body: some View {
    bodyContent
  }

  private var bodyContent: some View {
    NavigationStack {
      ZStack {
        Color.Theme.pageBg.ignoresSafeArea()

        DecorativeBlobs()
          .offset(x: 100, y: -80)

        if isLoading {
          VStack(spacing: 20) {
            ProgressView()
              .progressViewStyle(CircularProgressViewStyle(tint: Color.Theme.textSecondary))
              .scaleEffect(1.5)

            Text("Loading profile...")
              .font(.subheadline)
              .foregroundColor(Color.Theme.textSecondary)
          }
        } else {
          ScrollView {
            VStack(spacing: 24) {
              lightningHeader
              informationSection
              tagsSection
              messageHistorySection
              lightningActionButtons
            }
            .padding()
          }
        }
      }
      .navigationTitle("Sakura Profile")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarLeading) {
          Button("Close") {
            dismiss()
          }
        }
      }
      .sheet(isPresented: $showingCreateShoutout) {
        CreateShoutoutView(selectedUser: user)
      }
      .alert("Delete Contact?", isPresented: $showingDeleteConfirm) {
        Button("Delete", role: .destructive) {
          deleteContact()
        }
        Button("Cancel", role: .cancel) {}
      } message: {
        Text("Are you sure you want to delete \(user.name)? This action cannot be undone.")
      }
      .onAppear {
        startSakuraAnimation()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
          isLoading = false
        }
      }
      .onDisappear {
      }
      .sheet(item: $selectedContact) { contact in
        ReceivedCardView(card: contact.businessCard)
      }
    }
    .onAppear {
      print("[ShoutoutDetailView] View appeared for user: \(user)")
      if let cached = SecureMessageStorage.shared.getLastMessage(from: user.name) {
        latestSakuraMessage = cached
      }
    }
    .onReceive(NotificationCenter.default.publisher(for: .secureMessageReceived)) { notification in
      guard let userInfo = notification.userInfo,
        let senderName = userInfo[MessageEventKey.senderName] as? String,
        let text = userInfo[MessageEventKey.text] as? String
      else {
        return
      }

      if senderName == user.name {
        withAnimation {
          latestSakuraMessage = text
        }

        SecureMessageStorage.shared.saveLastMessage(text, from: senderName)

        if NotificationSettingsManager.shared.enableInAppToast {
          ToastManager.shared.show(
            title: String(localized: "Sakura from \(senderName)"),
            message: text,
            type: .success,
            duration: 4.0
          )
        }
      }
    }
  }

  // MARK: - Animation Control

  private func startSakuraAnimation() {
    isSakuraAnimating = true
  }

  // MARK: - Actions

  func deleteContact() {
    let result = ContactRepository.shared.deleteContact(id: user.id)
    switch result {
    case .success:
      dismiss()
    case .failure(let error):
      print("Failed to delete contact: \(error.localizedDescription)")
    }
  }
}
