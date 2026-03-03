//
//  PersonDetailView.swift
//  airmeishi
//
//  Contact detail view — profile, messaging, actions
//

import SwiftUI

struct PersonDetailView: View {
  let user: ShoutoutUser
  @Environment(\.dismiss) private var dismiss
  @Environment(\.colorScheme) private var colorScheme
  @State private var showingCreateShoutout = false
  @State private var isSakuraAnimating = false
  @State private var showingDeleteConfirm = false
  @State private var isLoading = true
  @State private var selectedContact: Contact?
  @State private var showingShareSheet = false
  @State private var latestSakuraMessage: String?

  var body: some View {
    NavigationView {
      ZStack {
        Color.Theme.pageBg
          .ignoresSafeArea()

        if isLoading {
          VStack(spacing: 16) {
            ProgressView()
              .progressViewStyle(CircularProgressViewStyle(tint: .secondary))
            Text("Loading profile...")
              .font(.subheadline)
              .foregroundColor(.secondary)
          }
        } else {
          ScrollView {
            VStack(spacing: 20) {
              profileHeader
              contactInfoSection
              tagsSection
              messageHistorySection

              // Actions with proper spacing
              VStack(spacing: 12) {
                sendSakuraButton
                secondaryActions
                deleteButton
              }
              .padding(.top, 8)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
          }
        }
      }
      .navigationTitle("Profile")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarLeading) {
          Button("Close") { dismiss() }
            .foregroundColor(Color.Theme.darkUI)
        }
      }
      .sheet(isPresented: $showingCreateShoutout) {
        CreateShoutoutView(selectedUser: user)
      }
      .alert("Delete Contact?", isPresented: $showingDeleteConfirm) {
        Button("Delete", role: .destructive) { deleteContact() }
        Button("Cancel", role: .cancel) {}
      } message: {
        Text("Are you sure you want to delete \(user.name)? This action cannot be undone.")
      }
      .sheet(item: $selectedContact) { contact in
        ReceivedCardView(card: contact.businessCard)
      }
    }
    .onAppear {
      isSakuraAnimating = true
      if let cached = SecureMessageStorage.shared.getLastMessage(from: user.name) {
        latestSakuraMessage = cached
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
        isLoading = false
      }
    }
    .onReceive(NotificationCenter.default.publisher(for: .secureMessageReceived)) { notification in
      guard let userInfo = notification.userInfo,
        let senderName = userInfo[MessageEventKey.senderName] as? String,
        let text = userInfo[MessageEventKey.text] as? String,
        senderName == user.name
      else { return }

      withAnimation { latestSakuraMessage = text }
      SecureMessageStorage.shared.saveLastMessage(text, from: senderName)

      if NotificationSettingsManager.shared.enableInAppToast {
        ToastManager.shared.show(
          title: String(format: String(localized: "Sakura from %@"), senderName),
          message: text,
          type: .success,
          duration: 4.0
        )
      }
    }
  }

  // MARK: - Profile Header

  private var profileHeader: some View {
    VStack(spacing: 16) {
      // Profile image
      ZStack {
        Circle()
          .stroke(
            LinearGradient(
              colors: [Color.Theme.accentRose.opacity(0.4), Color.Theme.dustyMauve.opacity(0.3)],
              startPoint: .topLeading,
              endPoint: .bottomTrailing
            ),
            lineWidth: 2
          )
          .frame(width: 110, height: 110)

        AsyncImage(url: user.profileImageURL) { image in
          image.resizable().aspectRatio(contentMode: .fill)
        } placeholder: {
          Circle()
            .fill(
              LinearGradient(
                colors: [Color(red: 0.7, green: 0.65, blue: 0.85), Color(red: 0.6, green: 0.55, blue: 0.78)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
              )
            )
            .overlay {
              Text(user.initials)
                .font(.title2.weight(.semibold))
                .foregroundColor(.white)
            }
        }
        .frame(width: 96, height: 96)
        .clipShape(Circle())
        .shadow(color: .black.opacity(0.08), radius: 8, y: 4)
      }

      VStack(spacing: 6) {
        Text(user.name)
          .font(.title2.weight(.bold))
          .foregroundColor(.primary)

        if !user.title.isEmpty {
          Text(user.title)
            .font(.subheadline.weight(.medium))
            .foregroundColor(.secondary)
        }

        if !user.company.isEmpty {
          Text(user.company)
            .font(.caption)
            .foregroundColor(.secondary.opacity(0.7))
        }
      }

      // Verification badge
      HStack(spacing: 6) {
        Image(systemName: user.verificationStatus.systemImageName)
          .font(.caption)
          .foregroundColor(verificationColor)

        Text(user.verificationStatus.displayName)
          .font(.caption.weight(.medium))
          .foregroundColor(.primary.opacity(0.7))
      }
      .padding(.horizontal, 14)
      .padding(.vertical, 6)
      .background(
        Capsule()
          .fill(verificationColor.opacity(0.08))
          .overlay(
            Capsule().stroke(verificationColor.opacity(0.2), lineWidth: 1)
          )
      )
    }
    .padding(.vertical, 8)
  }

  // MARK: - Contact Info

  private var contactInfoSection: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Contact")
        .font(.subheadline.weight(.semibold))
        .foregroundColor(.primary.opacity(0.6))

      VStack(spacing: 8) {
        if !user.email.isEmpty {
          infoRow(icon: "envelope", title: String(localized: "Email"), value: user.email)
        }

        infoRow(
          icon: "calendar",
          title: String(localized: "Last Interaction"),
          value: DateFormatter.relativeDate.string(from: user.lastInteraction)
        )

        if let message = latestSakuraMessage {
          Divider().padding(.vertical, 2)

          HStack(alignment: .top, spacing: 10) {
            SakuraIconView(size: 16, color: Color.Theme.accentRose.opacity(0.7), isAnimating: true)
              .padding(.top, 2)

            VStack(alignment: .leading, spacing: 3) {
              Text("Latest Sakura")
                .font(.caption.weight(.medium))
                .foregroundColor(Color.Theme.accentRose.opacity(0.8))

              Text(message)
                .font(.subheadline)
                .foregroundColor(.primary.opacity(0.8))
                .fixedSize(horizontal: false, vertical: true)
            }
          }
        }
      }
    }
    .padding(16)
    .background(
      RoundedRectangle(cornerRadius: 14, style: .continuous)
        .fill(Color.Theme.cardSurface(for: colorScheme))
    )
  }

  // MARK: - Tags

  private var tagsSection: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Tags")
        .font(.subheadline.weight(.semibold))
        .foregroundColor(.primary.opacity(0.6))

      if user.tags.isEmpty {
        Text("No tags available")
          .font(.subheadline)
          .foregroundColor(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
      } else {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 80))], spacing: 8) {
          ForEach(user.tags, id: \.self) { tag in
            Text("#\(tag)")
              .font(.caption.weight(.medium))
              .padding(.horizontal, 10)
              .padding(.vertical, 5)
              .background(Color.primary.opacity(0.05))
              .foregroundColor(.primary.opacity(0.6))
              .cornerRadius(8)
          }
        }
      }
    }
    .padding(16)
    .background(
      RoundedRectangle(cornerRadius: 14, style: .continuous)
        .fill(Color.Theme.cardSurface(for: colorScheme))
    )
  }

  // MARK: - Message History

  private var messageHistorySection: some View {
    let messages = SecureMessageStorage.shared.getMessageHistory(from: user.name)

    return VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text("Message History")
          .font(.subheadline.weight(.semibold))
          .foregroundColor(.primary.opacity(0.6))

        Spacer()

        if !messages.isEmpty {
          Text("\(messages.count)")
            .font(.caption2.weight(.semibold))
            .foregroundColor(.secondary)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Color.primary.opacity(0.06))
            .cornerRadius(6)
        }
      }

      if messages.isEmpty {
        HStack(spacing: 6) {
          Image(systemName: "bubble.left.and.bubble.right")
            .font(.caption)
            .foregroundColor(.secondary.opacity(0.5))
          Text("No message history yet")
            .font(.subheadline)
            .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, 12)
      } else {
        VStack(spacing: 10) {
          ForEach(messages.prefix(5)) { message in
            HStack(alignment: .top, spacing: 10) {
              Circle()
                .fill(Color.Theme.accentRose.opacity(0.3))
                .frame(width: 6, height: 6)
                .padding(.top, 6)

              VStack(alignment: .leading, spacing: 3) {
                Text(message.text)
                  .font(.subheadline)
                  .foregroundColor(.primary.opacity(0.8))
                  .fixedSize(horizontal: false, vertical: true)

                Text(message.timestamp, style: .relative)
                  .font(.caption2)
                  .foregroundColor(.secondary)
              }
            }
          }

          if messages.count > 5 {
            Text("+ \(messages.count - 5) more")
              .font(.caption)
              .foregroundColor(Color.Theme.accentRose.opacity(0.7))
              .frame(maxWidth: .infinity, alignment: .center)
          }
        }
      }
    }
    .padding(16)
    .background(
      RoundedRectangle(cornerRadius: 14, style: .continuous)
        .fill(Color.Theme.cardSurface(for: colorScheme))
    )
  }

  // MARK: - Action Buttons (separated with proper spacing)

  private var sendSakuraButton: some View {
    Button(action: { showingCreateShoutout = true }) {
      Text("Send Sakura")
        .font(.body.weight(.semibold))
        .foregroundColor(.white)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(
          RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(Color.Theme.accentRose)
        )
    }
  }

  private var secondaryActions: some View {
    HStack(spacing: 10) {
      Button(action: {
        if case .success(let contact) = ContactRepository.shared.getContact(id: user.id) {
          selectedContact = contact
        }
      }) {
        HStack(spacing: 6) {
          Image(systemName: "person.circle")
            .font(.subheadline)
          Text("View Card")
            .font(.subheadline.weight(.medium))
        }
        .foregroundColor(.primary.opacity(0.7))
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(
          RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(Color.Theme.cardSurface(for: colorScheme))
            .overlay(
              RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.Theme.cardBorder(for: colorScheme), lineWidth: 1)
            )
        )
      }

      Button(action: { showingShareSheet = true }) {
        HStack(spacing: 6) {
          Image(systemName: "square.and.arrow.up")
            .font(.subheadline)
          Text("Share")
            .font(.subheadline.weight(.medium))
        }
        .foregroundColor(.primary.opacity(0.7))
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(
          RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(Color.Theme.cardSurface(for: colorScheme))
            .overlay(
              RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.Theme.cardBorder(for: colorScheme), lineWidth: 1)
            )
        )
      }
      .sheet(isPresented: $showingShareSheet) {
        ActivityViewController(activityItems: [String(format: String(localized: "Check out %@ on AirMeishi!"), user.name)])
      }
    }
  }

  private var deleteButton: some View {
    Button(action: { showingDeleteConfirm = true }) {
      Text("Delete Contact")
        .font(.subheadline.weight(.medium))
        .foregroundColor(Color.Theme.accentRose.opacity(0.8))
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(
          RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(Color.red.opacity(0.04))
            .overlay(
              RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.red.opacity(0.12), lineWidth: 1)
            )
        )
    }
  }

  // MARK: - Helpers

  private func infoRow(icon: String, title: String, value: String) -> some View {
    HStack(spacing: 10) {
      Image(systemName: icon)
        .font(.caption)
        .foregroundColor(.secondary)
        .frame(width: 18)

      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.caption)
          .foregroundColor(.secondary)
        Text(value)
          .font(.subheadline)
          .foregroundColor(.primary.opacity(0.8))
      }
    }
  }

  private func deleteContact() {
    let result = ContactRepository.shared.deleteContact(id: user.id)
    switch result {
    case .success:
      dismiss()
    case .failure(let error):
      print("Failed to delete contact: \(error.localizedDescription)")
    }
  }

  private var verificationColor: Color {
    switch user.verificationStatus {
    case .verified: return .green
    case .pending: return .orange
    case .unverified: return Color.Theme.primaryBlue
    case .failed: return .red
    }
  }
}
