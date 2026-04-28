import Contacts
import SwiftUI

struct PeopleListView: View {
  @EnvironmentObject private var identityDataStore: IdentityDataStore
  @ObservedObject private var devMode = DeveloperModeManager.shared
  @StateObject private var contactRepository = ContactRepository.shared

  @State private var searchQuery = ""
  @State private var showingExchangeFlow = false
  @State private var showingVCFPicker = false
  @State private var contactToDelete: ContactEntity?
  @State private var showingDeleteConfirm = false
  @State private var showingMergeConfirm = false
  @State private var showingContactPicker = false
  @State private var contactToEditNote: ContactEntity?

  private var filteredContacts: [ContactEntity] {
    let all = identityDataStore.contacts.sorted { $0.receivedAt > $1.receivedAt }
    let trimmed = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return all }
    let q = trimmed.lowercased()
    return all.filter {
      $0.name.lowercased().contains(q)
        || ($0.company?.lowercased().contains(q) ?? false)
        || ($0.title?.lowercased().contains(q) ?? false)
    }
  }

  var body: some View {
    NavigationStack {
      ZStack {
        Color.Theme.pageBg.ignoresSafeArea()

        VStack(spacing: 0) {
          header

          if identityDataStore.contacts.isEmpty {
            emptyState
          } else if filteredContacts.isEmpty {
            searchField
              .padding(.horizontal, 16)
              .padding(.bottom, 12)
            emptySearchState
          } else {
            searchField
              .padding(.horizontal, 16)
              .padding(.bottom, 12)
            listContent
          }
        }
      }
      .navigationBarHidden(true)
    }
    .onAppear { identityDataStore.refreshAll() }
    .onReceive(contactRepository.$pendingMergeProposal) { proposal in
      showingMergeConfirm = proposal != nil
    }
    .sheet(isPresented: $showingContactPicker) {
      ContactPickerView { contacts in
        handlePickedContacts(contacts)
      }
    }
    .sheet(isPresented: $showingVCFPicker) {
      VCFDocumentPicker { url in
        importVCFFile(url: url)
      }
    }
    .sheet(
      isPresented: Binding(
        get: { contactToEditNote != nil },
        set: { if !$0 { contactToEditNote = nil } }
      )
    ) {
      if let contact = contactToEditNote {
        PersonDetailMoreSheet(
          contact: contact,
          onSave: { updated in
            contact.notes = updated
            identityDataStore.refreshAll()
          },
          onDelete: {
            identityDataStore.deleteContact(by: contact.id)
          }
        )
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
    .confirmationDialog(
      "Merge Contact",
      isPresented: $showingMergeConfirm,
      titleVisibility: .visible
    ) {
      Button("Merge") {
        switch contactRepository.resolvePendingMerge(accept: true) {
        case .success(let merged):
          if let merged {
            identityDataStore.upsertContact(ContactEntity.fromLegacy(merged))
          }
          identityDataStore.refreshAll()
        case .failure:
          break
        }
      }
      Button("Keep Existing", role: .cancel) {
        _ = contactRepository.resolvePendingMerge(accept: false)
      }
    } message: {
      if let proposal = contactRepository.pendingMergeProposal {
        Text("Duplicate detected for \(proposal.existing.businessCard.name). Merge new contact data?")
      } else {
        Text("Duplicate contact detected.")
      }
    }
  }

  // MARK: - Header

  private var header: some View {
    HStack {
      Text("People List")
        .font(.system(size: 18, weight: .semibold))
        .foregroundColor(Color.Theme.textPrimary)

      Spacer()

      Menu {
        if devMode.isDeveloperMode {
          Button {
            showingExchangeFlow = true
          } label: {
            Label("Radar Exchange", systemImage: "antenna.radiowaves.left.and.right")
          }
        }

        Button {
          showingContactPicker = true
        } label: {
          Label("Import from Phone", systemImage: "person.crop.circle.badge.plus")
        }

        Button {
          showingVCFPicker = true
        } label: {
          Label("Import VCF File", systemImage: "doc.badge.plus")
        }
      } label: {
        Image(systemName: "plus")
          .font(.system(size: 18))
          .foregroundColor(Color.Theme.textPrimary)
          .frame(width: 24, height: 24)
      }
    }
    .padding(.horizontal, 16)
    .frame(height: 56)
  }

  // MARK: - Search field

  private var searchField: some View {
    HStack(spacing: 8) {
      Image(systemName: "magnifyingglass")
        .font(.system(size: 14))
        .foregroundColor(Color.Theme.textSecondary)

      ZStack(alignment: .leading) {
        if searchQuery.isEmpty {
          Text("Search")
            .font(.system(size: 14))
            .foregroundColor(Color.Theme.textSecondary)
        }
        TextField("", text: $searchQuery)
          .font(.system(size: 14))
          .foregroundColor(Color.Theme.textPrimary)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
    .overlay(
      RoundedRectangle(cornerRadius: 2, style: .continuous)
        .stroke(Color.Theme.textPrimary, lineWidth: 0.5)
    )
  }

  // MARK: - Empty states

  private var emptyState: some View {
    VStack(spacing: 0) {
      PaperStackIllustration()
        .frame(width: 214, height: 214)

      Text("Your contact list is empty")
        .font(.system(size: 14))
        .foregroundColor(Color.Theme.textSecondary)
        .multilineTextAlignment(.center)
        .padding(.bottom, 32)

      VStack(spacing: 8) {
        Button {
          showingContactPicker = true
        } label: {
          Text("Import from Phone")
            .font(.system(size: 15))
            .foregroundColor(.white)
            .frame(width: 200, height: 44)
            .background(Color.Theme.textPrimary)
            .clipShape(RoundedRectangle(cornerRadius: 2, style: .continuous))
        }

        // TODO: wire up a dedicated manual-add flow when available.
        Button {
          showingContactPicker = true
        } label: {
          Text("Add Manually")
            .font(.system(size: 15))
            .foregroundColor(Color.Theme.textPrimary)
            .frame(width: 200, height: 44)
        }
      }
      .padding(.vertical, 16)

      Spacer()
    }
    .padding(.top, 12)
    .frame(maxWidth: .infinity)
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
    .frame(maxWidth: .infinity)
  }

  // MARK: - List

  private var listContent: some View {
    ScrollView {
      LazyVStack(spacing: 0) {
        ForEach(filteredContacts, id: \.id) { contact in
          contactRow(contact)
        }
      }
      .padding(.horizontal, 16)
      .padding(.bottom, 90)
    }
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
      Button {
        contactToEditNote = contact
      } label: {
        Label("Note", systemImage: "square.and.pencil")
      }

      Button(role: .destructive) {
        contactToDelete = contact
        showingDeleteConfirm = true
      } label: {
        Label("Delete", systemImage: "trash")
      }
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

  private func handlePickedContacts(_ contacts: [CNContact]) {
    let result = ContactImportService.shared.importPickedContacts(contacts)
    switch result {
    case .success(let count):
      identityDataStore.refreshAll()
      ToastManager.shared.show(
        title: String(localized: "Import Complete"),
        message: String(localized: "Successfully imported \(count) contacts."),
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
}
