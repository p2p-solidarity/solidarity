import SwiftUI

struct PeopleListView: View {
  @EnvironmentObject private var identityDataStore: IdentityDataStore
  @State private var searchQuery = ""
  @State private var showingExchangeFlow = false
  @State private var showingVCFPicker = false
  @State private var contactToDelete: ContactEntity?
  @State private var showingDeleteConfirm = false

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

  private var importedContacts: [ContactEntity] {
    filteredContacts.filter {
      $0.verificationStatus != VerificationStatus.verified.rawValue && $0.source == "imported"
    }
  }

  private var others: [ContactEntity] {
    filteredContacts.filter {
      $0.verificationStatus != VerificationStatus.verified.rawValue && $0.source != "imported"
    }
  }

  var body: some View {
    NavigationStack {
      ZStack {
        Color.Theme.pageBg.ignoresSafeArea()
        if filteredContacts.isEmpty {
          if identityDataStore.contacts.isEmpty {
            emptyState
          } else {
            emptySearchState
          }
        } else if verifiedContacts.isEmpty && !importedContacts.isEmpty {
          // [PL-1v] Has imported contacts but no verified
          listContent
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

            Button {
              showingVCFPicker = true
            } label: {
              Label("Import VCF File", systemImage: "doc.badge.plus")
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
    .sheet(isPresented: $showingVCFPicker) {
      VCFDocumentPicker { url in
        importVCFFile(url: url)
      }
    }
    .fullScreenCover(isPresented: $showingExchangeFlow, onDismiss: {
      identityDataStore.refreshAll()
    }) {
      ProximitySharingView()
    }
    .confirmationDialog(
      "Delete \(contactToDelete?.name ?? "contact")?",
      isPresented: $showingDeleteConfirm,
      titleVisibility: .visible
    ) {
      Button("Delete", role: .destructive) {
        if let contact = contactToDelete {
          identityDataStore.deleteContact(by: contact.id)
        }
        contactToDelete = nil
      }
      Button("Cancel", role: .cancel) {
        contactToDelete = nil
      }
    } message: {
      Text("This contact will be permanently removed.")
    }
  }

  // MARK: - Empty State

  private var emptyState: some View {
    VStack(spacing: 16) {
      Spacer()

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
        if !verifiedContacts.isEmpty {
          sectionTitle(String(localized: "Verified"))
          ForEach(verifiedContacts, id: \.id) { contact in
            contactRow(contact)
          }
        }

        if !importedContacts.isEmpty {
          sectionTitle(String(localized: "Contacts"))
          ForEach(importedContacts, id: \.id) { contact in
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
    NavigationLink {
      PersonDetailView(contact: contact)
        .environmentObject(identityDataStore)
    } label: {
      TrustGraphContactRow(contact: contact)
    }
    .buttonStyle(.plain)
    .contextMenu {
      Button(role: .destructive) {
        contactToDelete = contact
        showingDeleteConfirm = true
      } label: {
        Label("Delete", systemImage: "trash")
      }
    }
  }

  private var emptySearchState: some View {
    VStack(spacing: 12) {
      Spacer()
      Image(systemName: "magnifyingglass")
        .font(.system(size: 36))
        .foregroundColor(Color.Theme.textTertiary)
      Text("No results for \"\(searchQuery)\"")
        .font(.system(size: 14))
        .foregroundColor(Color.Theme.textSecondary)
      Spacer()
    }
  }

  // MARK: - Actions

  private func importVCFFile(url: URL) {
    let result = ContactImportService.shared.importFromVCF(url: url)
    switch result {
    case .success(let count):
      identityDataStore.refreshAll()
      ToastManager.shared.show(
        title: String(localized: "Import Complete"),
        message: String(localized: "Imported \(count) contacts from VCF file."),
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
