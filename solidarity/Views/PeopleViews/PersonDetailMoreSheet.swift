//
//  PersonDetailMoreSheet.swift
//  solidarity
//
//  "More" sheet presented from the Person detail top-bar ellipsis.
//  Contains a Note editor row and a Delete Contact row. Design:
//  Pencil refs 7eXj1.png (full) / HQrI9.png (inner block).
//

import SwiftUI

struct PersonDetailMoreSheet: View {
  let contact: ContactEntity
  /// Persist the updated note body. Called when the user taps "Done".
  let onSave: (String) -> Void
  /// Delete the contact. Called after the user confirms.
  let onDelete: () -> Void

  @Environment(\.dismiss) private var dismiss
  @State private var noteDraft: String
  @State private var showingDeleteConfirm = false

  init(
    contact: ContactEntity,
    onSave: @escaping (String) -> Void,
    onDelete: @escaping () -> Void
  ) {
    self.contact = contact
    self.onSave = onSave
    self.onDelete = onDelete
    _noteDraft = State(initialValue: contact.notes ?? "")
  }

  var body: some View {
    VStack(spacing: 0) {
      topBar

      VStack(alignment: .leading, spacing: 32) {
        cardWrapper
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 16)
      .padding(.top, 12)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .background(Color.Theme.pageBg.ignoresSafeArea())
    .confirmationDialog(
      "Delete \(contact.name)?",
      isPresented: $showingDeleteConfirm,
      titleVisibility: .visible
    ) {
      Button("Delete", role: .destructive) {
        onDelete()
        dismiss()
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This contact will be permanently removed.")
    }
  }

  // MARK: - Top bar

  private var topBar: some View {
    HStack {
      Button {
        dismiss()
      } label: {
        Image(systemName: "chevron.left")
          .font(.system(size: 24, weight: .regular))
          .foregroundStyle(Color.Theme.textPrimary)
      }
      .buttonStyle(.plain)

      Spacer()

      Button {
        onSave(noteDraft)
        dismiss()
      } label: {
        Text("Done")
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(Color.white)
          .padding(.horizontal, 16)
          .padding(.vertical, 4)
          .background(
            RoundedRectangle(cornerRadius: 2)
              .fill(Color.Theme.textPrimary)
          )
      }
      .buttonStyle(.plain)
    }
    .padding(.horizontal, 16)
    .frame(height: 56)
  }

  // MARK: - Card wrapper

  private var cardWrapper: some View {
    VStack(alignment: .leading, spacing: 32) {
      noteBlock
      deleteButton
    }
  }

  // MARK: - Note block

  private var noteBlock: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Note")
        .font(.system(size: 14))
        .foregroundStyle(Color.Theme.textPrimary)

      ZStack(alignment: .leading) {
        if noteDraft.isEmpty {
          Text("Add text")
            .font(.system(size: 15))
            .foregroundStyle(Color.Theme.textTertiary)
            .padding(.horizontal, 12)
            .allowsHitTesting(false)
        }
        TextField("", text: $noteDraft)
          .font(.system(size: 15))
          .foregroundStyle(Color.Theme.textPrimary)
          .padding(.horizontal, 12)
          .textFieldStyle(.plain)
      }
      .frame(height: 48)
      .background(
        RoundedRectangle(cornerRadius: 2)
          .fill(Color(hex: 0xEEEEEE).opacity(0.8))
      )
      .overlay(
        RoundedRectangle(cornerRadius: 2)
          .stroke(Color.Theme.textSecondary.opacity(0.5), lineWidth: 0.5)
      )
    }
  }

  // MARK: - Delete button

  private var deleteButton: some View {
    Button {
      showingDeleteConfirm = true
    } label: {
      Text("Delete Contact")
        .font(.system(size: 15))
        .foregroundStyle(Color.Theme.destructive)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .frame(height: 48)
        .background(
          RoundedRectangle(cornerRadius: 2)
            .fill(Color.Theme.destructive.opacity(0.1))
        )
    }
    .buttonStyle(.plain)
  }
}

#if DEBUG
  #Preview {
    PersonDetailMoreSheet(
      contact: ContactEntity(name: "Mary", source: "exchanged"),
      onSave: { _ in },
      onDelete: {}
    )
  }
#endif
