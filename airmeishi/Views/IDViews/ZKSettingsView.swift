//
//  ZKSettingsView.swift
//  airmeishi
//
//  Zero-Knowledge settings view for managing identity
//

import SwiftUI

struct ZKSettingsView: View {
  @Environment(\.dismiss) private var dismiss
  @StateObject private var idm = SemaphoreIdentityManager.shared
  @State private var identityCommitment: String?
  @State private var showingDeleteConfirm = false

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
          .disabled(identityCommitment == nil)
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
            // TODO: Implement identity deletion
          }
          Button("Cancel", role: .cancel) {}
        },
        message: {
          Text("This will permanently delete your ZK identity. This action cannot be undone.")
        }
      )
    }
  }
}
