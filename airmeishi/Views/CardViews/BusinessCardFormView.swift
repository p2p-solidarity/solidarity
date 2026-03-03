import SwiftUI

struct BusinessCardFormView: View {
  let businessCard: BusinessCard?
  let forceCreate: Bool
  let onSave: (BusinessCard) -> Void

  @Environment(\.dismiss) private var dismiss
  @StateObject private var cardManager = CardManager.shared

  @State private var name = ""
  @State private var title = ""
  @State private var company = ""
  @State private var email = ""
  @State private var phone = ""
  @State private var skillsText = ""
  @State private var categoriesText = ""
  @State private var linkedInHandle = ""
  @State private var githubHandle = ""
  @State private var useZK = true
  @State private var allowForwarding = false
  @State private var selectedFormat: SharingFormat = .plaintext

  @State private var showingDeleteConfirm = false
  @State private var showingErrorAlert = false
  @State private var errorMessage = ""

  init(
    businessCard: BusinessCard? = nil,
    forceCreate: Bool = false,
    onSave: @escaping (BusinessCard) -> Void = { _ in }
  ) {
    self.businessCard = businessCard
    self.forceCreate = forceCreate
    self.onSave = onSave
  }

  private var isEditing: Bool { businessCard != nil && !forceCreate }

  var body: some View {
    NavigationStack {
      Form {
        basicSection
        profileSection
        privacySection
        saveSection
        if isEditing {
          dangerSection
        }
      }
      .navigationTitle(isEditing ? "Edit Identity Card" : "Create Identity Card")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarLeading) {
          Button("Cancel") { dismiss() }
        }
      }
      .onAppear(perform: hydrate)
      .alert("Error", isPresented: $showingErrorAlert) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(errorMessage)
      }
      .confirmationDialog(
        "Delete this card?",
        isPresented: $showingDeleteConfirm,
        titleVisibility: .visible
      ) {
        Button("Delete", role: .destructive) {
          deleteCard()
        }
        Button("Cancel", role: .cancel) {}
      } message: {
        Text("This action cannot be undone.")
      }
    }
  }

  private var basicSection: some View {
    Section("Basic Info") {
      TextField("Name *", text: $name)
      TextField("Title", text: $title)
      TextField("Company", text: $company)
    }
  }

  private var profileSection: some View {
    Section("Contact and Skills") {
      TextField("Email", text: $email)
        .textInputAutocapitalization(.never)
        .keyboardType(.emailAddress)
      TextField("Phone", text: $phone)
        .keyboardType(.phonePad)
      TextField("Skills (comma separated)", text: $skillsText)
      TextField("Categories (comma separated)", text: $categoriesText)
      TextField("LinkedIn username", text: $linkedInHandle)
      TextField("GitHub username", text: $githubHandle)
        .textInputAutocapitalization(.never)
    }
  }

  private var privacySection: some View {
    Section("Sharing Preferences") {
      Toggle("Use ZK proof by default", isOn: $useZK)
      Toggle("Allow forwarding", isOn: $allowForwarding)

      Picker("Sharing format", selection: $selectedFormat) {
        ForEach(SharingFormat.allCases) { format in
          Text(format.displayName).tag(format)
        }
      }
      .pickerStyle(.menu)

      Text(selectedFormat.detail)
        .font(.caption)
        .foregroundColor(.secondary)
    }
  }

  private var saveSection: some View {
    Section {
      Button {
        persistCard()
      } label: {
        Text(isEditing ? "Save Changes" : "Create Card")
          .frame(maxWidth: .infinity)
      }
      .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }
  }

  private var dangerSection: some View {
    Section("Danger Zone") {
      Button(role: .destructive) {
        showingDeleteConfirm = true
      } label: {
        Text("Delete Card")
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }

  private func hydrate() {
    guard let businessCard else { return }
    name = businessCard.name
    title = businessCard.title ?? ""
    company = businessCard.company ?? ""
    email = businessCard.email ?? ""
    phone = businessCard.phone ?? ""
    skillsText = businessCard.skills.map(\.name).joined(separator: ", ")
    categoriesText = businessCard.categories.joined(separator: ", ")
    linkedInHandle =
      businessCard.socialNetworks.first(where: { $0.platform == .linkedin })?.username ?? ""
    githubHandle =
      businessCard.socialNetworks.first(where: { $0.platform == .github })?.username ?? ""
    useZK = businessCard.sharingPreferences.useZK
    allowForwarding = businessCard.sharingPreferences.allowForwarding
    selectedFormat = businessCard.sharingPreferences.sharingFormat
  }

  private func persistCard() {
    let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedName.isEmpty else {
      showError("Name is required.")
      return
    }

    let skills = parseSkills(from: skillsText)
    let categories = parseCSV(categoriesText)
    let socials = parseSocialNetworks()
    let existingCard = businessCard

    let preferences = SharingPreferences(
      allowForwarding: allowForwarding,
      useZK: useZK,
      sharingFormat: selectedFormat
    )

    let updatedCard = BusinessCard(
      id: existingCard?.id ?? UUID(),
      name: trimmedName,
      title: nilIfEmpty(title),
      company: nilIfEmpty(company),
      email: nilIfEmpty(email),
      phone: nilIfEmpty(phone),
      profileImage: existingCard?.profileImage,
      animal: existingCard?.animal,
      socialNetworks: socials,
      skills: skills,
      categories: categories,
      sharingPreferences: preferences,
      groupContext: existingCard?.groupContext,
      createdAt: existingCard?.createdAt ?? Date(),
      updatedAt: Date()
    )

    let result: CardResult<BusinessCard> =
      isEditing
      ? cardManager.updateCard(updatedCard)
      : cardManager.createCard(updatedCard)

    switch result {
    case .success(let savedCard):
      onSave(savedCard)
      dismiss()
    case .failure(let error):
      showError(error.localizedDescription)
    }
  }

  private func deleteCard() {
    guard let id = businessCard?.id else { return }
    let result = cardManager.deleteCard(id: id)
    switch result {
    case .success:
      dismiss()
    case .failure(let error):
      showError(error.localizedDescription)
    }
  }

  private func parseSkills(from value: String) -> [Skill] {
    parseCSV(value).map {
      Skill(name: $0, category: String(localized: "General"), proficiencyLevel: .intermediate)
    }
  }

  private func parseSocialNetworks() -> [SocialNetwork] {
    var socials: [SocialNetwork] = []

    let linkedIn = linkedInHandle.trimmingCharacters(in: .whitespacesAndNewlines)
    if !linkedIn.isEmpty {
      socials.append(
        SocialNetwork(
          platform: .linkedin,
          username: linkedIn,
          url: "https://linkedin.com/in/\(linkedIn)"
        )
      )
    }

    let github = githubHandle.trimmingCharacters(in: .whitespacesAndNewlines)
    if !github.isEmpty {
      socials.append(
        SocialNetwork(
          platform: .github,
          username: github,
          url: "https://github.com/\(github)"
        )
      )
    }

    return socials
  }

  private func parseCSV(_ rawValue: String) -> [String] {
    rawValue
      .split(separator: ",")
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
  }

  private func nilIfEmpty(_ value: String) -> String? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  private func showError(_ message: String) {
    errorMessage = message
    showingErrorAlert = true
  }
}
