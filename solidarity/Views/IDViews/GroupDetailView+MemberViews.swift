//
//  GroupDetailView+MemberViews.swift
//  solidarity
//
//  Member and invite subviews for GroupDetailView
//

import SwiftUI
import CloudKit

// MARK: - Invite Section

struct InviteSection: View {
  let group: GroupModel
  @State private var inviteLink: String?
  @State private var qrImage: UIImage?
  @State private var isLoading = false
  @State private var errorMessage: String?
  @State private var showQRCode = false

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Text("Invite Members")
          .font(.system(size: 12, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textSecondary)
        Spacer()
      }

      if isLoading {
        HStack {
          Spacer()
          ProgressView()
          Spacer()
        }
        .padding()
      } else if let link = inviteLink {
        VStack(spacing: 16) {
          // Link Display
          HStack {
            Text(link)
              .font(.system(.subheadline, design: .monospaced))
              .lineLimit(1)
              .truncationMode(.middle)
              .foregroundColor(Color.Theme.textPrimary)
              .padding(8)
              .background(Color.Theme.searchBg)
              .cornerRadius(8)

            Button(action: {
              UIPasteboard.general.string = link
            }) {
              Image(systemName: "doc.on.doc")
                .font(.system(size: 12, weight: .bold, design: .monospaced))
                .foregroundColor(Color.Theme.primaryBlue)
                .padding(8)
                .background(Color.Theme.primaryBlue.opacity(0.1))
                .clipShape(Circle())
            }
          }

          // QR Code Toggle
          Button(action: {
            withAnimation {
              showQRCode.toggle()
            }
          }) {
            HStack {
              Image(systemName: "qrcode")
              Text(showQRCode ? String(localized: "Hide QR Code") : String(localized: "Show QR Code"))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
          }
          .buttonStyle(ThemedSecondaryButtonStyle())

          if showQRCode, let image = qrImage {
            Image(uiImage: image)
              .resizable()
              .interpolation(.none)
              .scaledToFit()
              .frame(width: 180, height: 180)
              .padding()
              .background(Color.Theme.cardBg)
              .cornerRadius(12)
              .shadow(radius: 4)
              .transition(.scale.combined(with: .opacity))
          }
        }
      } else {
        Button(action: {
          loadInviteLink()
        }) {
          Text("Generate Invite Link")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(ThemedPrimaryButtonStyle())
      }

      if let error = errorMessage {
        Text(error)
          .font(.caption)
          .foregroundColor(Color.Theme.destructive)
      }
    }
    .padding(16)
    .background(Color.Theme.searchBg)
    .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    .cornerRadius(12)
    .onAppear {
      if inviteLink == nil {
        loadInviteLink()
      }
    }
  }

  private func loadInviteLink() {
    guard !isLoading else { return }
    isLoading = true
    errorMessage = nil

    Task {
      do {
        // This will now reuse existing token if available
        let link = try await CloudKitGroupSyncManager.shared.createInviteLink(for: group)

        // Generate QR Image
        var image: UIImage?
        if let filter = CIFilter(name: "CIQRCodeGenerator") {
          filter.setValue(link.data(using: .ascii), forKey: "inputMessage")
          if let output = filter.outputImage {
            let transform = CGAffineTransform(scaleX: 10, y: 10)
            let scaled = output.transformed(by: transform)
            let context = CIContext()
            if let cgImage = context.createCGImage(scaled, from: scaled.extent) {
              image = UIImage(cgImage: cgImage)
            }
          }
        }

        await MainActor.run {
          self.inviteLink = link
          self.qrImage = image
          self.isLoading = false
        }
      } catch {
        await MainActor.run {
          self.errorMessage = error.localizedDescription
          self.isLoading = false
        }
      }
    }
  }
}

// MARK: - Members Section

struct MembersSection: View {
  let members: [GroupMemberModel]
  let isLoading: Bool
  let isOwner: Bool
  let onKick: (GroupMemberModel) -> Void
  let onApprove: (GroupMemberModel) -> Void
  let onReject: (GroupMemberModel) -> Void

  var pendingMembers: [GroupMemberModel] {
    members.filter { $0.status == .pending }
  }

  var activeMembers: [GroupMemberModel] {
    members.filter { $0.status == .active || $0.status == .kicked }  // Show kicked? Maybe not.
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text("Members")
          .font(.system(size: 12, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textSecondary)
        Spacer()

        // Syncing indicator removed as it was based on stale data

        if isLoading {
          ProgressView()
        }
      }

      if members.isEmpty && !isLoading {
        Text("No members found.")
          .foregroundColor(Color.Theme.textSecondary)
          .padding(16)
          .frame(maxWidth: .infinity, alignment: .center)
          .background(Color.Theme.searchBg)
          .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
      } else {
        LazyVStack(spacing: 16) {
          if !pendingMembers.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
              Text("Pending Requests")
                .font(.system(size: 12, weight: .bold, design: .monospaced))
                .foregroundColor(Color.Theme.accentRose)
                .padding(.leading, 4)

              VStack(spacing: 1) {
                ForEach(pendingMembers) { member in
                  PendingMemberRow(
                    member: member,
                    isOwner: isOwner,
                    onApprove: { onApprove(member) },
                    onReject: { onReject(member) }
                  )
                  if member.id != pendingMembers.last?.id {
                    Divider().padding(.leading, 16)
                  }
                }
              }
              .background(Color.Theme.searchBg)
              .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
            }
          }

          if !activeMembers.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
              if !pendingMembers.isEmpty {
                Text("Active Members")
                  .font(.system(size: 12, weight: .bold, design: .monospaced))
                  .foregroundColor(Color.Theme.textSecondary)
                  .padding(.leading, 4)
              }

              VStack(spacing: 1) {
                ForEach(activeMembers) { member in
                  MemberRow(member: member, isOwner: isOwner, onKick: { onKick(member) })
                  if member.id != activeMembers.last?.id {
                    Divider().padding(.leading, 16)
                  }
                }
              }
              .background(Color.Theme.searchBg)
              .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
            }
          }
        }
      }
    }
  }
}

// MARK: - Member Rows

struct PendingMemberRow: View {
  let member: GroupMemberModel
  let isOwner: Bool
  let onApprove: () -> Void
  let onReject: () -> Void

  var body: some View {
    HStack {
      VStack(alignment: .leading, spacing: 4) {
        Text(member.userRecordID)
          .font(.body)
          .lineLimit(1)
          .truncationMode(.middle)

        Text("Requesting to join")
          .font(.caption)
          .foregroundColor(Color.Theme.accentRose)
      }

      Spacer()

      if isOwner {
        HStack(spacing: 12) {
          Button(action: onReject) {
            Image(systemName: "xmark.circle.fill")
            .foregroundColor(Color.Theme.destructive)
            .font(.title2)
          }

          Button(action: onApprove) {
            Image(systemName: "checkmark.circle.fill")
            .foregroundColor(Color.Theme.terminalGreen)
            .font(.title2)
          }
        }
      }
    }
    .padding(16)
    .background(Color.Theme.searchBg)
  }
}

struct MemberRow: View {
  let member: GroupMemberModel
  let isOwner: Bool
  let onKick: () -> Void

  var body: some View {
    HStack {
      VStack(alignment: .leading, spacing: 4) {
        Text(member.userRecordID)  // Ideally replace with Name
          .font(.body)
          .lineLimit(1)
          .truncationMode(.middle)

        HStack(spacing: 6) {
          Text(member.role.rawValue.capitalized)
            .font(.caption)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(member.role == .owner ? Color.Theme.primaryBlue.opacity(0.1) : Color.Theme.textTertiary.opacity(0.1))
            .foregroundColor(member.role == .owner ? Color.Theme.primaryBlue : Color.Theme.textSecondary)
            .cornerRadius(4)

          if member.status == .kicked {
            Text("Kicked")
              .font(.caption)
              .foregroundColor(Color.Theme.destructive)
          }
        }
      }

      Spacer()

      if member.hasMessagingData {
        Image(systemName: "bubble.left.and.bubble.right.fill")
          .foregroundColor(Color.Theme.accentRose)
          .help("Can receive Sakura / Group VC")
      }

      if isOwner && member.role != .owner && member.status != .kicked {
        Button(role: .destructive, action: onKick) {
          Text("Kick")
            .foregroundColor(Color.Theme.destructive)
        }
        .buttonStyle(ThemedSecondaryButtonStyle())
        .controlSize(.small)
      }
    }
    .padding(16)
    .background(Color.Theme.searchBg)  // Ensure background for tap
  }
}
