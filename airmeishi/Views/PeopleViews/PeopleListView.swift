import SwiftUI

struct PeopleListView: View {
  @EnvironmentObject private var identityDataStore: IdentityDataStore
  @State private var searchQuery = ""
  @State private var showingExchangeFlow = false

  private var filteredContacts: [ContactEntity] {
    let all = identityDataStore.contacts.sorted { $0.receivedAt > $1.receivedAt }
    guard !searchQuery.isEmpty else { return all }
    let q = searchQuery.lowercased()
    return all.filter {
      $0.name.lowercased().contains(q)
        || ($0.company?.lowercased().contains(q) ?? false)
        || ($0.title?.lowercased().contains(q) ?? false)
    }
  }

  private var verifiedContacts: [ContactEntity] {
    filteredContacts.filter { $0.verificationStatus == VerificationStatus.verified.rawValue }
  }

  private var others: [ContactEntity] {
    filteredContacts.filter { $0.verificationStatus != VerificationStatus.verified.rawValue }
  }

  var body: some View {
    NavigationStack {
      ZStack {
        Color.Theme.pageBg.ignoresSafeArea()
        if filteredContacts.isEmpty {
          emptyState
        } else {
          listContent
        }
      }
      .navigationTitle("People")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button {
            showingExchangeFlow = true
          } label: {
            Image(systemName: "plus")
              .foregroundColor(Color.Theme.darkUI)
          }
        }
      }
      .searchable(text: $searchQuery, prompt: "搜索")
    }
    .onAppear {
      identityDataStore.refreshAll()
    }
    .fullScreenCover(isPresented: $showingExchangeFlow, onDismiss: {
      identityDataStore.refreshAll()
    }) {
      ProximitySharingView()
    }
  }

  // MARK: - Sharing Entry Card

  private var sharingEntryCard: some View {
    Button {
      showingExchangeFlow = true
    } label: {
      HStack(spacing: 14) {
        Circle()
          .fill(
            LinearGradient(
              colors: [Color.Theme.accentRose, Color.Theme.dustyMauve],
              startPoint: .topLeading,
              endPoint: .bottomTrailing
            )
          )
          .frame(width: 44, height: 44)
          .overlay(
            Image(systemName: "antenna.radiowaves.left.and.right")
              .font(.system(size: 20, weight: .semibold))
              .foregroundColor(.white)
          )

        VStack(alignment: .leading, spacing: 4) {
          Text("交換名片")
            .font(.subheadline.weight(.semibold))
            .foregroundColor(Color.Theme.textPrimary)
          Text("透過近距離分享與附近的人交換名片")
            .font(.caption)
            .foregroundColor(Color.Theme.textSecondary)
            .lineLimit(1)
        }

        Spacer(minLength: 0)

        Image(systemName: "chevron.right")
          .font(.caption.weight(.semibold))
          .foregroundColor(Color.Theme.textPlaceholder)
      }
      .padding(14)
      .background(
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .fill(Color.Theme.cardBg)
          .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
              .stroke(Color.Theme.accentRose.opacity(0.2), lineWidth: 1)
          )
      )
    }
    .buttonStyle(.plain)
  }

  // MARK: - Empty State

  private var emptyState: some View {
    VStack(spacing: 16) {
      Spacer()

      sharingEntryCard
        .padding(.horizontal, 16)

      VStack(spacing: 12) {
        Image(systemName: "person.2")
          .font(.system(size: 48))
          .foregroundColor(Color.Theme.textTertiary)

        Text("還沒有聯絡人")
          .font(.system(size: 16, weight: .semibold))
          .foregroundColor(Color.Theme.textPrimary)

        Text("透過近距離交換或匯入通訊錄來新增")
          .font(.system(size: 14))
          .foregroundColor(Color.Theme.textSecondary)
          .multilineTextAlignment(.center)
      }
      .padding(.top, 20)

      VStack(spacing: 10) {
        Button("交換名片") {
          showingExchangeFlow = true
        }
        .buttonStyle(ThemedRoseButtonStyle())

        Button("匯入手機通訊錄") {
          showingExchangeFlow = true
        }
        .buttonStyle(ThemedSecondaryButtonStyle())
      }
      .padding(.horizontal, 40)

      Spacer()
    }
    .padding(16)
  }

  // MARK: - List Content

  private var listContent: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        sharingEntryCard

        if !verifiedContacts.isEmpty {
          sectionTitle("Verified")
          ForEach(verifiedContacts, id: \.id) { contact in
            contactRow(contact)
          }
        }

        if !others.isEmpty {
          sectionTitle("Pending / Unverified")
          ForEach(others, id: \.id) { contact in
            contactRow(contact)
          }
        }
      }
      .padding(16)
      .padding(.bottom, 90)
    }
  }

  private func sectionTitle(_ value: String) -> some View {
    Text(value)
      .font(.subheadline.weight(.semibold))
      .foregroundColor(Color.Theme.textSecondary)
  }

  private func contactRow(_ contact: ContactEntity) -> some View {
    VStack(spacing: 0) {
      HStack(alignment: .top, spacing: 8) {
        Circle()
          .fill(Color.Theme.searchBg)
          .frame(width: 38, height: 38)
          .overlay(
            Text(String(contact.name.prefix(1)).uppercased())
              .font(.system(size: 14, weight: .semibold))
              .foregroundColor(Color.Theme.textPrimary)
          )

        VStack(alignment: .leading, spacing: 0) {
          HStack {
            VStack(alignment: .leading, spacing: 2) {
              Text(contact.name)
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(Color.Theme.textPrimary)
              Text([contact.title, contact.company].compactMap { $0 }.joined(separator: " • "))
                .font(.system(size: 14))
                .foregroundColor(Color.Theme.textSecondary)
            }
            Spacer()
            Text(formatDate(contact.receivedAt))
              .font(.system(size: 10))
              .foregroundColor(Color.Theme.textSecondary)
          }

          Rectangle()
            .fill(Color.Theme.divider)
            .frame(height: 0.5)
            .padding(.vertical, 8)

          if let notes = contact.notes, !notes.isEmpty {
            Text(notes)
              .font(.system(size: 11))
              .foregroundColor(Color.Theme.textSecondary)
              .padding(.bottom, 4)
          } else if let message = contact.theirEphemeralMessage, !message.isEmpty {
            Text(message)
              .font(.system(size: 11))
              .foregroundColor(Color.Theme.textSecondary)
              .padding(.bottom, 4)
          }

          if contact.source == "phone_contacts" || contact.verificationStatus == "phone" {
            Text("#手機通訊錄")
              .font(.system(size: 10))
              .foregroundColor(Color.Theme.textSecondary)
          }
        }
      }
    }
    .padding(.vertical, 12)
    .overlay(alignment: .top) {
      Rectangle()
        .fill(Color.Theme.divider)
        .frame(height: 0.5)
    }
  }

  private func formatDate(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
  }
}
