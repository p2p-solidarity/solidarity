//
//  ZKSettingsView.swift
//  solidarity
//
//  Zero-Knowledge settings view for managing identity
//

import SwiftUI

struct ZKSettingsView: View {
  @Environment(\.dismiss) private var dismiss
  @StateObject private var idm = SemaphoreIdentityManager.shared
  @State private var identityCommitment: String?
  @State private var showingDeleteConfirm = false
  @State private var deleteErrorMessage: String?
  @State private var showingDeleteError = false
  @State private var isDeleting = false

  var body: some View {
    NavigationStack {
      List {
        Section("Identity Status") {
          if let commitment = identityCommitment {
            LabeledContent("Commitment", value: commitment)
              .font(.footnote.monospaced())
          } else {
            Text("No identity created")
              .foregroundColor(.secondary)
          }

          LabeledContent("Proofs Supported", value: SemaphoreIdentityManager.proofsSupported ? "Yes" : "No")
        }

        Section("Actions") {
          Button(role: .destructive, action: { showingDeleteConfirm = true }) {
            Label("Delete Identity", systemImage: "trash")
          }
          .disabled(identityCommitment == nil || isDeleting)
        }
      }
      .navigationTitle("ZK Settings")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button("Done") {
            dismiss()
          }
        }
      }
      .onAppear {
        identityCommitment = idm.getIdentity()?.commitment
      }
      .alert(
        "Delete Identity?",
        isPresented: $showingDeleteConfirm,
        actions: {
          Button("Delete", role: .destructive) {
            performDelete()
          }
          Button("Cancel", role: .cancel) {}
        },
        message: {
          Text("This will permanently delete your ZK identity. This action cannot be undone.")
        }
      )
      .alert(
        "Delete Failed",
        isPresented: $showingDeleteError,
        actions: {
          Button("OK", role: .cancel) {}
        },
        message: {
          Text(deleteErrorMessage ?? "Unknown error.")
        }
      )
    }
  }

  private func performDelete() {
    isDeleting = true
    Task {
      let result = await idm.deleteIdentity()
      await MainActor.run {
        isDeleting = false
        switch result {
        case .success:
          identityCommitment = nil
        case .failure(let error):
          deleteErrorMessage = error.localizedDescription
          showingDeleteError = true
        }
      }
    }
  }
}
