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
      .navigationTitle("people list")
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

  private var emptyState: some View {
    VStack(spacing: 14) {
      Spacer()
      Image(systemName: "doc.text.fill")
        .font(.system(size: 80))
        .foregroundColor(Color.Theme.textTertiary)

      Text("你的聯絡人通訊錄是空的")
        .font(.system(size: 16, weight: .semibold))
        .foregroundColor(Color.Theme.textPrimary)

      Button {
        showingExchangeFlow = true
      } label: {
        Text("匯入手機通訊錄")
          .font(.system(size: 14, weight: .semibold))
          .foregroundColor(.white)
          .frame(width: 200)
          .padding(.vertical, 14)
          .background(Color.Theme.darkUI)
          .cornerRadius(2)
      }

      Button {
        showingExchangeFlow = true
      } label: {
        Text("手動新增")
          .font(.system(size: 14, weight: .medium))
          .foregroundColor(Color.Theme.darkUI)
      }

      Spacer()
    }
    .padding(16)
  }

  private var listContent: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
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
