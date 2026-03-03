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
          Menu {
            Button {
              showingExchangeFlow = true
            } label: {
              Label("Radar Exchange", systemImage: "antenna.radiowaves.left.and.right")
            }
            
            Button {
              importPhoneContacts()
            } label: {
              Label("Import from Phone", systemImage: "person.crop.circle.badge.down")
            }
          } label: {
            Image(systemName: "plus.circle")
              .font(.system(size: 20))
              .foregroundColor(Color.Theme.textPrimary)
          }
        }
      }
      .searchable(text: $searchQuery, prompt: "Search")
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

  // MARK: - Sharing Entry Card (Radar Match)

  private var sharingEntryCard: some View {
    Button {
      showingExchangeFlow = true
    } label: {
      HStack(spacing: 14) {
        
        // Animated Radar Icon Placeholder
        ZStack {
          Circle()
            .stroke(Color.Theme.terminalGreen.opacity(0.3), lineWidth: 1)
            .frame(width: 44, height: 44)
          Circle()
            .fill(Color.Theme.terminalGreen)
            .frame(width: 8, height: 8)
          // Simplified radar line
          Rectangle()
            .fill(Color.Theme.terminalGreen)
            .frame(width: 22, height: 1)
            .offset(x: 11)
            .rotationEffect(.degrees(-45))
        }

        VStack(alignment: .leading, spacing: 4) {
          Text("[ SCAN RADAR ]")
            .font(.system(size: 14, weight: .bold, design: .monospaced))
            .foregroundColor(Color.Theme.terminalGreen)
          Text("Initiate proximity handshake protocol")
            .font(.system(size: 12, weight: .regular))
            .foregroundColor(Color.Theme.textSecondary)
        }

        Spacer(minLength: 0)

        Image(systemName: "circle.dashed")
          .font(.system(size: 18, weight: .bold))
          .foregroundColor(Color.Theme.primaryBlue)
      }
      .padding(16)
      .background(Color.Theme.searchBg)
      .overlay(
        Rectangle()
          .stroke(Color.Theme.terminalGreen, lineWidth: 1)
      )
    }
    .buttonStyle(.plain)
    .padding(.horizontal, 16)
    .padding(.bottom, 16)
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

        Text("No contacts yet")
          .font(.system(size: 16, weight: .semibold))
          .foregroundColor(Color.Theme.textPrimary)

        Text("Add via proximity exchange or contact import")
          .font(.system(size: 14))
          .foregroundColor(Color.Theme.textSecondary)
          .multilineTextAlignment(.center)
      }
      .padding(.top, 20)

      VStack(spacing: 10) {
        Button("Radar Exchange") {
          showingExchangeFlow = true
        }
        .buttonStyle(ThemedPrimaryButtonStyle())

        Button("Import Phone Contacts") {
          importPhoneContacts()
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
          sectionTitle(String(localized: "Verified"))
          ForEach(verifiedContacts, id: \.id) { contact in
            contactRow(contact)
          }
        }

        if !others.isEmpty {
          sectionTitle(String(localized: "Pending / Unverified"))
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
    Text("— " + value.uppercased())
      .font(.system(size: 12, weight: .bold, design: .monospaced))
      .foregroundColor(Color.Theme.textSecondary)
      .padding(.horizontal, 16)
      .padding(.top, 8)
  }

  private func contactRow(_ contact: ContactEntity) -> some View {
    TrustGraphContactRow(contact: contact)
  }

  private func formatDate(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
  }

  // MARK: - Actions

  private func importPhoneContacts() {
    Task {
      // 1. Request permission
      let permissionResult = await ContactImportService.shared.requestPermission()
      
      switch permissionResult {
      case .success(let granted):
        guard granted else {
          await MainActor.run {
            ToastManager.shared.show(
              title: String(localized: "Access Denied"),
              message: String(localized: "Please enable Contacts permission in iOS Settings."),
              type: .error,
              duration: 3.0
            )
          }
          return
        }

        // 2. Perform import
        let importResult = ContactImportService.shared.importContacts()
        
        await MainActor.run {
          switch importResult {
          case .success(let count):
            identityDataStore.refreshAll()
            ToastManager.shared.show(
              title: String(localized: "Import Complete"),
              message: String(localized: "Successfully imported \(count) local contacts."),
              type: .success,
              duration: 3.0
            )
          case .failure(let error):
            ToastManager.shared.show(
              title: String(localized: "Import Failed"),
              message: error.localizedDescription,
              type: .error,
              duration: 4.0
            )
          }
        }

      case .failure(let error):
        await MainActor.run {
          ToastManager.shared.show(
            title: String(localized: "Error"),
            message: error.localizedDescription,
            type: .error,
            duration: 4.0
          )
        }
      }
    }
  }
}
