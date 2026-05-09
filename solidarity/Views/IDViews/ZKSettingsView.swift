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
      ScrollView {
        VStack(spacing: 24) {
          identityStatusSection
          actionsSection
        }
        .padding(.vertical, 24)
      }
      .background(Color.Theme.pageBg.ignoresSafeArea())
      .navigationTitle("ZK Settings")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        SettingsBackToolbar { dismiss() }
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

  // MARK: - Sections

  private var identityStatusSection: some View {
    SettingsBlockSection("Identity Status") {
      if let commitment = identityCommitment {
        commitmentRow(commitment)
      } else {
        SettingsBlockInfoRow(
          icon: "circle.dashed",
          title: "Identity",
          value: "Not initialized"
        )
      }

      SettingsBlockInfoRow(
        icon: "checkmark.seal",
        title: "Proofs Supported",
        value: SemaphoreIdentityManager.proofsSupported ? "Yes" : "No"
      )
    }
  }

  private var actionsSection: some View {
    SettingsBlockSection("Actions") {
      Button {
        showingDeleteConfirm = true
      } label: {
        SettingsBlockDangerRow(
          icon: "trash",
          title: "Delete Identity",
          subtitle: identityCommitment == nil ? "No identity to delete" : nil
        )
      }
      .buttonStyle(.plain)
      .disabled(identityCommitment == nil || isDeleting)
      .opacity(identityCommitment == nil || isDeleting ? 0.5 : 1)
    }
  }

  private func commitmentRow(_ commitment: String) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 12) {
        Image(systemName: "shield.checkered")
          .font(.system(size: 14, weight: .regular))
          .foregroundColor(Color.Theme.textPrimary)
          .frame(width: 20, height: 20)

        Text("Commitment")
          .font(.system(size: 15))
          .foregroundColor(Color.Theme.textPrimary)

        Spacer()
      }

      Text(commitment)
        .font(.system(size: 11, design: .monospaced))
        .foregroundColor(Color.Theme.textSecondary)
        .lineLimit(2)
        .truncationMode(.middle)
        .textSelection(.enabled)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      RoundedRectangle(cornerRadius: 12)
        .fill(Color.Theme.mutedSurface)
    )
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
