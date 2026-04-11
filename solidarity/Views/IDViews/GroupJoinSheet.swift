//
//  GroupJoinSheet.swift
//  solidarity
//
//  Created by Solidarity Team.
//

import SwiftUI

struct GroupJoinSheet: View {
  @Environment(\.dismiss) private var dismiss
  @ObservedObject private var groupManager = CloudKitGroupSyncManager.shared

  @State private var inviteToken: String = ""
  @State private var isJoining = false
  @State private var errorMessage: String?
  @State private var successMessage: String?

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 16) {
          // Invite Token Section
          VStack(alignment: .leading, spacing: 0) {
            Text("INVITE TOKEN")
              .font(.system(size: 12, weight: .bold, design: .monospaced))
              .foregroundColor(Color.Theme.textTertiary)
              .padding(.bottom, 8)

            TextField("Enter Invite Token", text: $inviteToken)
              .autocorrectionDisabled()
              .textInputAutocapitalization(.never)
              .font(.system(size: 14))
              .foregroundColor(Color.Theme.textPrimary)
              .padding(16)
              .background(Color.Theme.searchBg)
              .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))

            Text("Enter the token shared with you to join a private or public group.")
              .font(.system(size: 12, design: .monospaced))
              .foregroundColor(Color.Theme.textTertiary)
              .padding(.top, 6)
          }

          // Error Message
          if let error = errorMessage {
            Text(error)
              .font(.system(size: 14))
              .foregroundColor(Color.Theme.destructive)
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(16)
              .background(Color.Theme.searchBg)
              .overlay(Rectangle().stroke(Color.Theme.destructive.opacity(0.3), lineWidth: 1))
          }

          // Success Message
          if let success = successMessage {
            Text(success)
              .font(.system(size: 14))
              .foregroundColor(Color.Theme.terminalGreen)
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(16)
              .background(Color.Theme.searchBg)
              .overlay(Rectangle().stroke(Color.Theme.terminalGreen.opacity(0.3), lineWidth: 1))
          }

          // Join Button
          Button(
            action: {
              joinGroup()
            },
            label: {
              if isJoining {
                HStack {
                  Text("Joining...")
                  Spacer()
                  ProgressView()
                }
                .frame(maxWidth: .infinity)
              } else {
                Text("Join Group")
                  .frame(maxWidth: .infinity)
              }
            }
          )
          .buttonStyle(ThemedPrimaryButtonStyle())
          .disabled(inviteToken.isEmpty || isJoining)

          // Scan QR Code Button
          Button(
            action: {
              showingScanner = true
            },
            label: {
              Label("Scan QR Code", systemImage: "qrcode.viewfinder")
                .frame(maxWidth: .infinity)
            }
          )
          .buttonStyle(ThemedSecondaryButtonStyle())
        }
        .padding(16)
      }
      .background(Color.Theme.pageBg.ignoresSafeArea())
      .navigationTitle("Join Group")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") {
            dismiss()
          }
          .foregroundColor(Color.Theme.textPrimary)
        }
      }
      .sheet(isPresented: $showingScanner) {
        SimpleQRScannerView(
          onScan: { code in
            showingScanner = false
            handleScannedCode(code)
          },
          onCancel: {
            showingScanner = false
          }
        )
      }
    }
  }

  @State private var showingScanner = false

  private func handleScannedCode(_ code: String) {
    // Expected format: solidarity://group/join?token=XYZ (legacy airmeishi:// links also work)
    if let url = URL(string: code),
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      let queryItems = components.queryItems,
      let token = queryItems.first(where: { $0.name == "token" })?.value
    {

      inviteToken = token
      // Auto-join? Or just fill? Let's fill for safety.
      // joinGroup()
    } else {
      errorMessage = String(localized: "Invalid QR Code format")
    }
  }

  private func joinGroup() {
    guard !inviteToken.isEmpty else { return }

    isJoining = true
    errorMessage = nil
    successMessage = nil

    Task {
      do {
        let group = try await groupManager.joinGroup(withInviteToken: inviteToken)
        await MainActor.run {
          isJoining = false
          let successFormat = String(localized: "Successfully joined %@!")
          successMessage = String(format: successFormat, locale: Locale.current, group.name)
          // Delay dismissal to show success message
          DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            dismiss()
          }
        }
      } catch {
        await MainActor.run {
          isJoining = false
          let errorFormat = String(localized: "Failed to join: %@")
          errorMessage = String(format: errorFormat, locale: Locale.current, error.localizedDescription)
        }
      }
    }
  }
}

#Preview {
  GroupJoinSheet()
}
