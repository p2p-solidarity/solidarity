//
//  ShoutoutDetailView.swift
//  airmeishi
//
//  Lightening-themed detailed view for a specific user in the shoutout system
//

import SwiftUI

struct ShoutoutDetailView: View {
  let user: ShoutoutUser
  @Environment(\.dismiss) private var dismiss
  @State private var showingCreateShoutout = false
  @State private var isSakuraAnimating = false
  @State private var showingDeleteConfirm = false
  @State private var isLoading = true
  @State private var showingProfile = false
  @State private var selectedContact: Contact?
  @State private var showingShareSheet = false
  @State private var latestSakuraMessage: String?

  init(user: ShoutoutUser) {
    self.user = user
  }

  var body: some View {
    // Removed debug print to reduce body re-evaluation overhead
    bodyContent
  }

  private var bodyContent: some View {
    NavigationView {
      ZStack {
        // Dark gradient background with lightning effect
        LinearGradient(
          colors: [
            Color.black,
            Color.blue.opacity(0.1),
            Color.purple.opacity(0.05),
            Color.black,
          ],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )
        .ignoresSafeArea()

        if isLoading {
          VStack(spacing: 20) {
            ProgressView()
              .progressViewStyle(CircularProgressViewStyle(tint: .white))
              .scaleEffect(1.5)

            Text("Loading profile...")
              .font(.subheadline)
              .foregroundColor(.white.opacity(0.8))
          }
        } else {
          ScrollView {
            VStack(spacing: 24) {
              // Lightening header with profile
              lightningHeader

              // User Information
              informationSection

              // Tags and Skills
              tagsSection

              // Message History
              messageHistorySection

              // Lightening Action Buttons
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
          .foregroundColor(.white)
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
        // Simulate loading completion
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
    .preferredColorScheme(.dark)
    .onAppear {
      print("[ShoutoutDetailView] View appeared for user: \(user)")
      // Load cached message
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

      // Check if message is from this user
      if senderName == user.name {
        withAnimation {
          latestSakuraMessage = text
        }

        // Save to local cache
        SecureMessageStorage.shared.saveLastMessage(text, from: senderName)

        // Show Toast only if enabled in settings
        if NotificationSettingsManager.shared.enableInAppToast {
          ToastManager.shared.show(
            title: "Sakura from \(senderName)",
            message: text,
            type: .success,
            duration: 4.0
          )
        }
      }
    }
  }

  // MARK: - Sakura Header

  private var lightningHeader: some View {
    VStack(spacing: 20) {
      // Sakura and title
      HStack {
        SakuraIconView(size: 32, color: .pink, isAnimating: isSakuraAnimating)

        Text("Sakura Profile")
          .font(.title2)
          .fontWeight(.bold)
          .foregroundColor(.white)

        Spacer()
      }

      // Profile Image with sakura effects
      ZStack {
        // Sakura ring
        Circle()
          .stroke(
            LinearGradient(
              colors: [.pink.opacity(0.8), .purple.opacity(0.6), .pink.opacity(0.8)],
              startPoint: .topLeading,
              endPoint: .bottomTrailing
            ),
            lineWidth: 3
          )
          .frame(width: 120, height: 120)
          .scaleEffect(isSakuraAnimating ? 1.1 : 1.0)
          .animation(
            .easeInOut(duration: 0.8).repeatForever(autoreverses: true),
            value: isSakuraAnimating
          )

        AsyncImage(url: user.profileImageURL) { image in
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
              Text(user.initials)
                .font(.title)
                .fontWeight(.bold)
                .foregroundColor(.white)
            }
        }
        .frame(width: 100, height: 100)
        .clipShape(Circle())
        .overlay(
          Circle()
            .stroke(verificationColor, lineWidth: 3)
            .scaleEffect(isSakuraAnimating ? 1.05 : 1.0)
            .animation(
              .easeInOut(duration: 0.6).repeatForever(autoreverses: true),
              value: isSakuraAnimating
            )
        )
        .shadow(
          color: isSakuraAnimating ? .pink.opacity(0.6) : verificationColor.opacity(0.5),
          radius: isSakuraAnimating ? 15 : 8,
          x: 0,
          y: 4
        )
      }

      // Name and Title
      VStack(spacing: 4) {
        Text(user.name)
          .font(.title)
          .fontWeight(.bold)
          .foregroundColor(.white)

        if !user.title.isEmpty {
          Text(user.title)
            .font(.headline)
            .foregroundColor(.pink)
        }

        if !user.company.isEmpty {
          Text(user.company)
            .font(.subheadline)
            .foregroundColor(.gray)
        }
      }

      // Verification Status with sakura
      HStack(spacing: 8) {
        Image(systemName: user.verificationStatus.systemImageName)
          .foregroundColor(verificationColor)
          .font(.title3)

        Text(user.verificationStatus.displayName)
          .font(.headline)
          .foregroundColor(.white)

        SakuraIconView(size: 16, color: .pink, isAnimating: isSakuraAnimating)
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 8)
      .background(
        RoundedRectangle(cornerRadius: 16)
          .fill(verificationColor.opacity(0.1))
          .overlay(
            RoundedRectangle(cornerRadius: 16)
              .stroke(verificationColor, lineWidth: 1)
          )
      )
    }
  }

  // MARK: - Information Section

  private var informationSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Contact")
        .font(.headline)
        .foregroundColor(.white)

      VStack(spacing: 8) {
        if !user.email.isEmpty {
          ShoutoutInfoRow(
            icon: "envelope",
            title: "Email",
            value: user.email
          )
        }

        ShoutoutInfoRow(
          icon: "calendar",
          title: "Last Interaction",
          value: DateFormatter.relativeDate.string(from: user.lastInteraction)
        )

        // Sakura Message Display
        if let message = latestSakuraMessage {
          Divider()
            .background(Color.white.opacity(0.1))

          HStack(alignment: .top, spacing: 12) {
            SakuraIconView(size: 20, color: .pink, isAnimating: true)
              .padding(.top, 2)

            VStack(alignment: .leading, spacing: 4) {
              Text("Latest Sakura")
                .font(.subheadline)
                .foregroundColor(.pink)

              Text(message)
                .font(.body)
                .foregroundColor(.white)
                .fixedSize(horizontal: false, vertical: true)
            }
          }
        }
      }
    }
    .padding()
    .background(Color.white.opacity(0.05))
    .cornerRadius(12)
  }

  // MARK: - Tags Section

  private var tagsSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Tags")
        .font(.headline)
        .foregroundColor(.white)

      if user.tags.isEmpty {
        Text("No tags available")
          .font(.body)
          .foregroundColor(.gray)
          .frame(maxWidth: .infinity, alignment: .leading)
      } else {
        LazyVGrid(
          columns: [
            GridItem(.adaptive(minimum: 100))
          ],
          spacing: 8
        ) {
          ForEach(user.tags, id: \.self) { tag in
            Text("#\(tag)")
              .font(.caption)
              .padding(.horizontal, 8)
              .padding(.vertical, 4)
              .background(Color.white.opacity(0.06))
              .foregroundColor(.white)
              .cornerRadius(8)
          }
        }
      }
    }
    .padding()
    .background(Color.white.opacity(0.05))
    .cornerRadius(12)
  }

  // MARK: - Message History Section

  private var messageHistorySection: some View {
    let messages = SecureMessageStorage.shared.getMessageHistory(from: user.name)

    return VStack(alignment: .leading, spacing: 12) {
      HStack {
        SakuraIconView(size: 20, color: .pink, isAnimating: isSakuraAnimating)

        Text("Message History")
          .font(.headline)
          .foregroundColor(.white)

        Spacer()

        if !messages.isEmpty {
          Text("\(messages.count)")
            .font(.caption)
            .foregroundColor(.gray)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.white.opacity(0.1))
            .cornerRadius(8)
        }
      }

      if messages.isEmpty {
        HStack(spacing: 8) {
          Image(systemName: "bubble.left.and.bubble.right")
            .foregroundColor(.gray)
          Text("No message history yet")
            .font(.body)
            .foregroundColor(.gray)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, 16)
      } else {
        VStack(spacing: 12) {
          ForEach(messages.prefix(5)) { message in
            messageRow(message)
          }

          if messages.count > 5 {
            Text("+ \(messages.count - 5) more messages")
              .font(.caption)
              .foregroundColor(.pink)
              .frame(maxWidth: .infinity, alignment: .center)
              .padding(.top, 4)
          }
        }
      }
    }
    .padding()
    .background(Color.white.opacity(0.05))
    .cornerRadius(12)
  }

  private func messageRow(_ message: StoredMessage) -> some View {
    HStack(alignment: .top, spacing: 12) {
      Circle()
        .fill(
          LinearGradient(
            colors: [.pink.opacity(0.6), .purple.opacity(0.4)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          )
        )
        .frame(width: 8, height: 8)
        .padding(.top, 6)

      VStack(alignment: .leading, spacing: 4) {
        Text(message.text)
          .font(.body)
          .foregroundColor(.white)
          .fixedSize(horizontal: false, vertical: true)

        Text(message.timestamp, style: .relative)
          .font(.caption2)
          .foregroundColor(.gray)
      }
    }
    .padding(.vertical, 4)
  }

  // MARK: - Sakura Action Buttons

  private var lightningActionButtons: some View {
    VStack(spacing: 16) {
      // Primary Ichigoichie Button
      Button(action: {
        print("[ShoutoutDetailView] Send Sakura tapped for user: \(user)")
        showingCreateShoutout = true
      }) {
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

      // Secondary Actions
      HStack(spacing: 12) {
        Button(action: {
          if case .success(let contact) = ContactRepository.shared.getContact(id: user.id) {
            selectedContact = contact
            showingProfile = true
          } else {
            // If contact not found (e.g. cloud only), maybe show error or handle gracefully
            print("Contact not found for user: \(user.id)")
          }
        }) {
          HStack(spacing: 8) {
            Image(systemName: "person.circle")
              .font(.title3)
            Text("View Profile")
              .font(.subheadline)
              .fontWeight(.medium)
          }
          .foregroundColor(.white)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 12)
          .background(
            RoundedRectangle(cornerRadius: 12)
              .fill(Color.white.opacity(0.1))
              .overlay(
                RoundedRectangle(cornerRadius: 12)
                  .stroke(Color.white.opacity(0.2), lineWidth: 1)
              )
          )
        }

        Button(action: {
          showingShareSheet = true
        }) {
          HStack(spacing: 8) {
            Image(systemName: "square.and.arrow.up")
              .font(.title3)
            Text("Share")
              .font(.subheadline)
              .fontWeight(.medium)
          }
          .foregroundColor(.white)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 12)
          .background(
            RoundedRectangle(cornerRadius: 12)
              .fill(Color.white.opacity(0.1))
              .overlay(
                RoundedRectangle(cornerRadius: 12)
                  .stroke(Color.white.opacity(0.2), lineWidth: 1)
              )
          )
        }
        .sheet(isPresented: $showingShareSheet) {
          ActivityViewController(activityItems: ["Check out \(user.name) on Sakura!"])
        }
      }

      // Delete Button
      Button(action: {
        showingDeleteConfirm = true
      }) {
        HStack(spacing: 8) {
          Image(systemName: "trash")
            .font(.title3)
          Text("Delete Contact")
            .font(.subheadline)
            .fontWeight(.medium)
        }
        .foregroundColor(.red)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(
          RoundedRectangle(cornerRadius: 12)
            .fill(Color.red.opacity(0.1))
            .overlay(
              RoundedRectangle(cornerRadius: 12)
                .stroke(Color.red.opacity(0.3), lineWidth: 1)
            )
        )
      }
    }
  }

  // MARK: - Animation Control

  private func startSakuraAnimation() {
    isSakuraAnimating = true
  }

  // MARK: - Actions

  private func deleteContact() {
    let result = ContactRepository.shared.deleteContact(id: user.id)
    switch result {
    case .success:
      dismiss()
    case .failure(let error):
      print("Failed to delete contact: \(error.localizedDescription)")
    }
  }

  // MARK: - Computed Properties

  private var verificationColor: Color {
    switch user.verificationStatus {
    case .verified: return .green
    case .pending: return .orange
    case .unverified: return .blue
    case .failed: return .red
    }
  }
}

struct ShoutoutInfoRow: View {
  let icon: String
  let title: String
  let value: String

  var body: some View {
    HStack {
      Image(systemName: icon)
        .foregroundColor(.white)
        .frame(width: 20)

      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.subheadline)
          .foregroundColor(.white)

        Text(value)
          .font(.caption)
          .foregroundColor(.gray)
      }

      Spacer()
    }
  }
}

// MARK: - Extensions

extension DateFormatter {
  static let relativeDate: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    formatter.doesRelativeDateFormatting = true
    return formatter
  }()
}

#Preview {
  ShoutoutDetailView(
    user: ShoutoutUser(
      id: UUID(),
      name: "John Doe",
      company: "Tech Corp",
      title: "Software Engineer",
      email: "john@techcorp.com",
      profileImageURL: nil,
      tags: ["developer", "swift", "ios"],
      eventScore: 0.8,
      typeScore: 0.7,
      characterScore: 0.6,
      lastInteraction: Date(),
      verificationStatus: .verified,
      canReceiveSakura: true,
      sealedRoute: nil,
      pubKey: nil,
      signPubKey: nil
    )
  )
}

struct ActivityViewController: UIViewControllerRepresentable {
  var activityItems: [Any]
  var applicationActivities: [UIActivity]?

  func makeUIViewController(
    context: UIViewControllerRepresentableContext<ActivityViewController>
  ) -> UIActivityViewController {
    let controller = UIActivityViewController(
      activityItems: activityItems,
      applicationActivities: applicationActivities
    )
    return controller
  }

  func updateUIViewController(
    _ uiViewController: UIActivityViewController,
    context: UIViewControllerRepresentableContext<ActivityViewController>
  ) {}
}
