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
      .searchable(text: $searchQuery, prompt: "Search contacts")
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
      SolidarityPlaceholderCard(
        screenID: .exchangeDiscovery,
        title: "No contact edges yet",
        subtitle: "Start face-to-face exchange to create verified contacts."
      )

      Button("Start Exchange") {
        showingExchangeFlow = true
      }
      .buttonStyle(ThemedPrimaryButtonStyle())
      .frame(maxWidth: 260)
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
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text(contact.name)
          .font(.subheadline.weight(.semibold))
          .foregroundColor(Color.Theme.textPrimary)
        Spacer()
        Text(statusBadge(for: contact.verificationStatus))
          .font(.caption.weight(.semibold))
          .foregroundColor(Color.Theme.textSecondary)
      }

      Text([contact.title, contact.company].compactMap { $0 }.joined(separator: " · "))
        .font(.caption)
        .foregroundColor(Color.Theme.textSecondary)

      if let message = contact.theirEphemeralMessage, !message.isEmpty {
        Text("One-time message: \(message)")
          .font(.caption)
          .foregroundColor(Color.Theme.textTertiary)
      }
    }
    .padding(12)
    .background(Color.Theme.cardBg)
    .cornerRadius(10)
  }

  private func statusBadge(for status: String) -> String {
    switch status {
    case VerificationStatus.verified.rawValue:
      return "Verified"
    case VerificationStatus.pending.rawValue:
      return "Pending"
    case VerificationStatus.failed.rawValue:
      return "Failed"
    default:
      return "Unverified"
    }
  }
}
