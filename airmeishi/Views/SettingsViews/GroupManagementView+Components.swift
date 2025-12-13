//
//  GroupManagementView+Components.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import SwiftUI
import CloudKit

struct InviteLinkView: View {
  @Environment(\.dismiss) private var dismiss
  @StateObject private var groupManager = CloudKitGroupSyncManager.shared
  @State private var selectedGroup: GroupModel?
  @State private var inviteLink: String?
  @State private var isGenerating: Bool = false
  @State private var errorMessage: String?

  var onShare: ((CKShare, CKContainer) -> Void)?

  var body: some View {
    NavigationView {
      Form {
        Section(header: Text("Select Group")) {
          Picker("Group", selection: $selectedGroup) {
            Text("Select a group").tag(nil as GroupModel?)
            ForEach(groupManager.groups) { group in
              Text(group.name).tag(group as GroupModel?)
            }
          }
        }

        if let group = selectedGroup {
          Section {
            if group.isPrivate {
              Button(action: { manageShare(for: group) }) {
                if isGenerating {
                  ProgressView()
                } else {
                  Text("Share via iCloud")
                }
              }
              .disabled(isGenerating)

              Text("This is a private group. Use iCloud sharing to add or remove people.")
                .font(.caption)
                .foregroundColor(.secondary)
            } else {
              Button(action: { generateLink(for: group) }) {
                if isGenerating {
                  ProgressView()
                } else {
                  Text("Generate Invite Link")
                }
              }
              .disabled(isGenerating)

              if let link = inviteLink {
                VStack(alignment: .leading) {
                  Text("Invite Link")
                    .font(.caption)
                    .foregroundColor(.black)
                  Text(link)
                    .font(.monospaced(.body)())
                    .textSelection(.enabled)

                  Button(action: {
                    UIPasteboard.general.string = link
                  }) {
                    Label("Copy Link", systemImage: "doc.on.doc")
                  }
                  .padding(.top, 4)
                }
                .padding(.vertical, 8)
              }
            }
          }
        }

        if let error = errorMessage {
          Section {
            Text(error)
              .foregroundColor(.red)
          }
        }
      }
      .navigationTitle("Invite Members")
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button("Done") { dismiss() }
        }
      }
    }
  }

  private func generateLink(for group: GroupModel) {
    isGenerating = true
    errorMessage = nil

    Task {
      do {
        let link = try await groupManager.createInviteLink(for: group)
        await MainActor.run {
          self.inviteLink = link
          self.isGenerating = false
        }
      } catch {
        await MainActor.run {
          self.errorMessage = error.localizedDescription
          self.isGenerating = false
        }
      }
    }
  }

  private func manageShare(for group: GroupModel) {
    isGenerating = true
    errorMessage = nil

    Task {
      do {
        let (share, container) = try await groupManager.createShare(for: group)
        await MainActor.run {
          self.isGenerating = false
          self.onShare?(share, container)
        }
      } catch {
        await MainActor.run {
          self.errorMessage = error.localizedDescription
          self.isGenerating = false
        }
      }
    }
  }
}

// MARK: - Simple UI Components

struct SimpleNodeRow: View {
  let icon: String
  let title: String
  let subtitle: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(alignment: .center, spacing: 16) {
        ZStack {
          RoundedRectangle(cornerRadius: 12)
            .fill(Color.white.opacity(0.1))
            .frame(width: 44, height: 44)

          Image(systemName: icon)
            .font(.system(size: 20, weight: .medium))
            .foregroundColor(.white)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }

        VStack(alignment: .leading, spacing: 4) {
          Text(title)
            .font(.subheadline)
            .fontWeight(.medium)
            .foregroundColor(.white)

          Text(subtitle)
            .font(.caption)
            .foregroundColor(.white.opacity(0.5))
        }

        Spacer()

        Image(systemName: "chevron.right")
          .font(.system(size: 14))
          .foregroundColor(.white.opacity(0.4))
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
      .background(
        RoundedRectangle(cornerRadius: 12)
          .fill(Color.white.opacity(0.05))
      )
      .padding(.horizontal, 12)
      .padding(.vertical, 2)
    }
    .buttonStyle(.plain)
  }
}

struct SimplePremiumFeatureRow: View {
  let icon: String
  let title: String
  let subtitle: String
  let price: String
  let isEnabled: Bool

  var body: some View {
    HStack(alignment: .center, spacing: 16) {
      ZStack {
        RoundedRectangle(cornerRadius: 14)
          .fill(Color.white.opacity(0.12))
          .frame(width: 50, height: 50)

        Image(systemName: icon)
          .font(.system(size: 22, weight: .medium))
          .foregroundColor(.white)
          .frame(width: 50, height: 50)
          .contentShape(Rectangle())
      }

      VStack(alignment: .leading, spacing: 4) {
        Text(title)
          .font(.subheadline)
          .fontWeight(.medium)
          .foregroundColor(.white)

        Text(subtitle)
          .font(.caption)
          .foregroundColor(.white.opacity(0.5))
          .lineLimit(2)
      }

      Spacer()

      VStack(alignment: .trailing, spacing: 2) {
        Text(price)
          .font(.headline)
          .fontWeight(.semibold)
          .foregroundColor(.white)

        Text("Premium")
          .font(.caption2)
          .foregroundColor(.white.opacity(0.5))
      }
    }
    .padding(16)
    .background(
      RoundedRectangle(cornerRadius: 14)
        .fill(Color.white.opacity(0.08))
        .overlay(
          RoundedRectangle(cornerRadius: 14)
            .stroke(Color.white.opacity(0.15), lineWidth: 1)
        )
    )
    .padding(.horizontal, 12)
    .opacity(isEnabled ? 1.0 : 0.6)
  }
}

struct SimpleDangerNodeRow: View {
  let icon: String
  let title: String
  let subtitle: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(alignment: .center, spacing: 16) {
        ZStack {
          RoundedRectangle(cornerRadius: 12)
            .fill(Color.red.opacity(0.15))
            .frame(width: 44, height: 44)

          Image(systemName: icon)
            .font(.system(size: 20, weight: .medium))
            .foregroundColor(.red)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }

        VStack(alignment: .leading, spacing: 4) {
          Text(title)
            .font(.subheadline)
            .fontWeight(.medium)
            .foregroundColor(.red)

          Text(subtitle)
            .font(.caption)
            .foregroundColor(.white.opacity(0.5))
        }

        Spacer()

        Image(systemName: "chevron.right")
          .font(.system(size: 14))
          .foregroundColor(.red.opacity(0.6))
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
      .background(
        RoundedRectangle(cornerRadius: 12)
          .fill(Color.red.opacity(0.08))
          .overlay(
            RoundedRectangle(cornerRadius: 12)
              .stroke(Color.red.opacity(0.15), lineWidth: 1)
          )
      )
      .padding(.horizontal, 12)
      .padding(.vertical, 2)
    }
    .buttonStyle(.plain)
  }
}
