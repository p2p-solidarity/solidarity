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
  @State private var selectedFormat: SharingFormat = .didSigned

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

  private var trimmedName: String {
    name.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 24) {
          basicSection
          profileSection
          privacySection
          saveSection
          if isEditing {
            dangerSection
          }
        }
        .padding(.vertical, 24)
      }
      .background(Color.Theme.pageBg.ignoresSafeArea())
      .navigationTitle(isEditing ? "Edit Identity Card" : "Create Identity Card")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        SettingsBackToolbar("Cancel") { dismiss() }
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

  // MARK: - Sections

  private var basicSection: some View {
    SettingsBlockSection("Basic Info") {
      nameField
      formField(icon: "briefcase", placeholder: "Title", text: $title)
      formField(icon: "building.2", placeholder: "Company", text: $company)
    }
  }

  private var nameField: some View {
    HStack(spacing: 12) {
      Image(systemName: "person")
        .font(.system(size: 14, weight: .regular))
        .foregroundColor(Color.Theme.textPrimary)
        .frame(width: 20, height: 20)

      TextField("Name", text: $name)
        .font(.system(size: 15))
        .foregroundColor(Color.Theme.textPrimary)

      if trimmedName.isEmpty {
        Text("*")
          .font(.system(size: 15, weight: .semibold))
          .foregroundColor(Color.Theme.destructive)
      }
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 12)
    .background(
      RoundedRectangle(cornerRadius: 12)
        .fill(Color.Theme.mutedSurface)
    )
  }

  private var profileSection: some View {
    SettingsBlockSection("Contact and Skills") {
      formField(
        icon: "envelope",
        placeholder: "Email",
        text: $email,
        keyboardType: .emailAddress,
        autocapitalization: .never
      )
      formField(
        icon: "phone",
        placeholder: "Phone",
        text: $phone,
        keyboardType: .phonePad
      )
      formField(
        icon: "sparkles",
        placeholder: "Skills (comma separated)",
        text: $skillsText
      )
      formField(
        icon: "tag",
        placeholder: "Categories (comma separated)",
        text: $categoriesText
      )
      formField(
        icon: "link",
        placeholder: "LinkedIn username",
        text: $linkedInHandle
      )
      formField(
        icon: "chevron.left.forwardslash.chevron.right",
        placeholder: "GitHub username",
        text: $githubHandle,
        autocapitalization: .never
      )
    }
  }

  private var privacySection: some View {
    VStack(alignment: .leading, spacing: 8) {
      SettingsBlockSectionHeader(title: "Sharing Preferences")

      VStack(spacing: 8) {
        SettingsBlockToggleRow(
          icon: "shield",
          title: "Use ZK proof by default",
          isOn: $useZK
        )
        SettingsBlockToggleRow(
          icon: "arrowshape.turn.up.right",
          title: "Allow forwarding",
          isOn: $allowForwarding
        )

        Menu {
          Picker("Sharing format", selection: $selectedFormat) {
            ForEach(SharingFormat.allCases) { format in
              Text(format.displayName).tag(format)
            }
          }
        } label: {
          SettingsBlockRow(
            icon: "square.and.arrow.up.on.square",
            title: "Sharing format",
            trailingText: selectedFormat.displayName,
            showsChevron: false
          )
        }
      }
      .padding(.horizontal, 16)

      Text(selectedFormat.detail)
        .font(.system(size: 12))
        .foregroundColor(Color.Theme.textTertiary)
        .padding(.horizontal, 16)
    }
  }

  private var saveSection: some View {
    Button {
      persistCard()
    } label: {
      Text(isEditing ? "Save Changes" : "Create Card")
    }
    .buttonStyle(ThemedPrimaryButtonStyle())
    .disabled(trimmedName.isEmpty)
    .opacity(trimmedName.isEmpty ? 0.5 : 1)
    .padding(.horizontal, 16)
  }

  private var dangerSection: some View {
    VStack(alignment: .leading, spacing: 8) {
      SettingsBlockSectionHeader(title: "Danger Zone")

      Button {
        showingDeleteConfirm = true
      } label: {
        SettingsBlockDangerRow(icon: "trash", title: "Delete Card")
      }
      .buttonStyle(.plain)
      .padding(.horizontal, 16)
    }
  }

  // MARK: - Field Helpers

  private func formField(
    icon: String,
    placeholder: String,
    text: Binding<String>,
    keyboardType: UIKeyboardType = .default,
    autocapitalization: TextInputAutocapitalization = .sentences
  ) -> some View {
    HStack(spacing: 12) {
      Image(systemName: icon)
        .font(.system(size: 14, weight: .regular))
        .foregroundColor(Color.Theme.textPrimary)
        .frame(width: 20, height: 20)

      TextField(placeholder, text: text)
        .font(.system(size: 15))
        .foregroundColor(Color.Theme.textPrimary)
        .keyboardType(keyboardType)
        .textInputAutocapitalization(autocapitalization)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 12)
    .background(
      RoundedRectangle(cornerRadius: 12)
        .fill(Color.Theme.mutedSurface)
    )
  }

  // MARK: - Lifecycle / Persistence

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
    let trimmed = trimmedName
    guard !trimmed.isEmpty else {
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
      name: trimmed,
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
