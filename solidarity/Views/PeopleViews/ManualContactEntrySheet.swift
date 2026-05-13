//
//  ManualContactEntrySheet.swift
//  solidarity
//
//  Lightweight form for typing a contact directly into the People list
//  without bouncing through the system Contacts picker. Saved contacts are
//  marked source = .manual and remain unverified — they don't carry a
//  cryptographic signature, just user-entered fields.
//

import SwiftUI

struct ManualContactEntrySheet: View {
  /// Called after the contact is persisted. Receives the new entity so
  /// callers can refresh state or navigate to it.
  var onSaved: ((ContactEntity) -> Void)?

  @Environment(\.dismiss) private var dismiss

  @State private var name: String = ""
  @State private var title: String = ""
  @State private var company: String = ""
  @State private var email: String = ""
  @State private var phone: String = ""
  @State private var notes: String = ""
  @State private var validationMessage: String?

  var body: some View {
    NavigationStack {
      ZStack {
        Color.Theme.pageBg.ignoresSafeArea()

        ScrollView {
          let required = String(localized: "Required")
          let optional = String(localized: "Optional")
          VStack(alignment: .leading, spacing: 20) {
            field(label: String(localized: "Name"), placeholder: required, text: $name)
            field(label: String(localized: "Title"), placeholder: optional, text: $title)
            field(label: String(localized: "Company"), placeholder: optional, text: $company)
            field(
              label: String(localized: "Email"),
              placeholder: optional,
              text: $email,
              keyboard: .emailAddress,
              autocapitalization: .never
            )
            field(
              label: String(localized: "Phone"),
              placeholder: optional,
              text: $phone,
              keyboard: .phonePad,
              autocapitalization: .never
            )
            field(
              label: String(localized: "Note"),
              placeholder: optional,
              text: $notes,
              autocapitalization: .sentences
            )

            if let validationMessage {
              Text(validationMessage)
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(Color.Theme.destructive)
                .padding(.top, 4)
            }
          }
          .padding(.horizontal, 16)
          .padding(.top, 16)
          .padding(.bottom, 32)
        }
      }
      .navigationTitle("Add Contact")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarLeading) {
          Button("Cancel") { dismiss() }
            .foregroundColor(Color.Theme.textPrimary)
        }
        ToolbarItem(placement: .navigationBarTrailing) {
          Button("Save", action: save)
            .foregroundColor(canSave ? Color.Theme.textPrimary : Color.Theme.textTertiary)
            .disabled(!canSave)
        }
      }
    }
  }

  // MARK: - Field

  private func field(
    label: String,
    placeholder: String,
    text: Binding<String>,
    keyboard: UIKeyboardType = .default,
    autocapitalization: TextInputAutocapitalization = .words
  ) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(label)
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textTertiary)

      TextField(placeholder, text: text)
        .font(.system(size: 15))
        .foregroundColor(Color.Theme.textPrimary)
        .keyboardType(keyboard)
        .textInputAutocapitalization(autocapitalization)
        .autocorrectionDisabled()
        .padding(.horizontal, 12)
        .frame(height: 44)
        .background(
          RoundedRectangle(cornerRadius: 2)
            .fill(Color.Theme.searchBg)
        )
        .overlay(
          RoundedRectangle(cornerRadius: 2)
            .stroke(Color.Theme.divider, lineWidth: 0.5)
        )
    }
  }

  // MARK: - Save

  private var trimmedName: String {
    name.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private var canSave: Bool {
    !trimmedName.isEmpty
  }

  private func save() {
    let cleanName = trimmedName
    guard !cleanName.isEmpty else {
      validationMessage = String(localized: "Name is required.")
      return
    }

    let entity = ContactEntity(
      name: cleanName,
      title: title.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty(),
      company: company.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty(),
      email: email.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty(),
      phone: phone.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty(),
      source: ContactSource.manual.rawValue,
      verificationStatus: VerificationStatus.unverified.rawValue,
      notes: notes.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty()
    )

    IdentityDataStore.shared.upsertContact(entity)
    onSaved?(entity)
    dismiss()
  }
}

#if DEBUG
  #Preview {
    ManualContactEntrySheet()
  }
#endif
