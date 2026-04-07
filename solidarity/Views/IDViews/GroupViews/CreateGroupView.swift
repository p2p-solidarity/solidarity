//
//  CreateGroupView.swift
//  solidarity
//
//  Created by Solidarity Team.
//

import SwiftUI

struct CreateGroupView: View {
  @Environment(\.dismiss) private var dismiss
  @StateObject private var groupManager = CloudKitGroupSyncManager.shared
  @State private var groupName: String = ""
  @State private var groupDescription: String = ""
  @State private var isPrivate: Bool = false
  @State private var isCreating: Bool = false
  @State private var errorMessage: String?
  @State private var showingError: Bool = false

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 16) {
          // Group Info Section
          VStack(alignment: .leading, spacing: 0) {
            VStack(spacing: 1) {
              TextField("Group Name", text: $groupName)
                .textInputAutocapitalization(.words)
                .font(.system(size: 14))
                .foregroundColor(Color.Theme.textPrimary)
                .padding(16)
                .background(Color.Theme.searchBg)

              TextField("Description (Optional)", text: $groupDescription)
                .textInputAutocapitalization(.sentences)
                .font(.system(size: 14))
                .foregroundColor(Color.Theme.textPrimary)
                .padding(16)
                .background(Color.Theme.searchBg)
            }
            .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))

            Text("Give your group a recognizable name and description.")
              .font(.system(size: 12, design: .monospaced))
              .foregroundColor(Color.Theme.textTertiary)
              .padding(.top, 6)
          }

          // Group Type Section
          VStack(alignment: .leading, spacing: 0) {
            Text("GROUP TYPE")
              .font(.system(size: 12, weight: .bold, design: .monospaced))
              .foregroundColor(Color.Theme.textTertiary)
              .padding(.bottom, 8)

            Picker("Group Type", selection: $isPrivate) {
              Text("Public Group").tag(false)
              Text("Private Group").tag(true)
            }
            .pickerStyle(.segmented)
            .padding(16)
            .background(Color.Theme.searchBg)
            .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))

            Group {
              if isPrivate {
                Text("Private groups use native iCloud Sharing. Only invited people can join.")
              } else {
                Text("Public groups use simple link sharing. Anyone with the link can join.")
              }
            }
            .font(.system(size: 12, design: .monospaced))
            .foregroundColor(Color.Theme.textTertiary)
            .padding(.top, 6)
          }

          // Create Button
          Button(action: createGroup) {
            if isCreating {
              HStack {
                Text("Creating...")
                Spacer()
                ProgressView()
              }
              .frame(maxWidth: .infinity)
            } else {
              Text("Create Group")
                .frame(maxWidth: .infinity)
            }
          }
          .buttonStyle(ThemedPrimaryButtonStyle())
          .disabled(groupName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isCreating)
        }
        .padding(16)
      }
      .background(Color.Theme.pageBg.ignoresSafeArea())
      .navigationTitle("New Group")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarLeading) {
          Button("Cancel") {
            dismiss()
          }
          .foregroundColor(Color.Theme.textPrimary)
        }
      }
      .alert("Error", isPresented: $showingError) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(errorMessage ?? String(localized: "Unknown error"))
      }
    }
  }

  private func createGroup() {
    let name = groupName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { return }

    isCreating = true

    Task {
      do {
        _ = try await groupManager.createGroup(
          name: name,
          description: groupDescription,
          coverImage: nil,
          isPrivate: isPrivate
        )
        await MainActor.run {
          isCreating = false
          dismiss()
        }
      } catch {
        await MainActor.run {
          errorMessage = error.localizedDescription
          showingError = true
          isCreating = false
        }
      }
    }
  }
}
