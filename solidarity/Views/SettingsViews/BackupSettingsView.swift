//
//  BackupSettingsView.swift
//  solidarity
//
//  Settings UI for iCloud backup
//

import SwiftUI

struct BackupSettingsView: View {
  @StateObject private var backup = BackupManager.shared
  @Environment(\.dismiss) private var dismiss
  @State private var showRestoreAlert = false
  @State private var showError = false
  @State private var errorMessage = ""

  var body: some View {
    ScrollView {
      VStack(spacing: 24) {
        iCloudBackupSection
        actionsSection
        statusSection
      }
      .padding(.vertical, 24)
    }
    .background(Color.Theme.pageBg.ignoresSafeArea())
    .navigationTitle("Backup")
    .navigationBarTitleDisplayMode(.inline)
    .onAppear { backup.loadSettings() }
    .alert("Restore from Backup?", isPresented: $showRestoreAlert) {
      Button("Cancel", role: .cancel) {}
      Button("Restore", role: .destructive) {
        performRestore()
      }
    } message: {
      Text("This will replace your current cards and contacts with the backed up data.")
    }
    .alert("Error", isPresented: $showError) {
      Button("OK") {}
    } message: {
      Text(errorMessage)
    }
  }

  // MARK: - Sections

  private var iCloudBackupSection: some View {
    SettingsBlockSection("iCloud Backup") {
      SettingsBlockToggleRow(
        icon: "icloud",
        title: "Enable iCloud Backup",
        isOn: Binding(
          get: { backup.settings.enabled },
          set: { newVal in _ = backup.update { $0.enabled = newVal } }
        )
      )

      if backup.settings.enabled {
        SettingsBlockToggleRow(
          icon: "arrow.triangle.2.circlepath",
          title: "Auto-backup",
          subtitle: "Automatically backup when cards change",
          isOn: Binding(
            get: { backup.settings.autoBackup },
            set: { newVal in _ = backup.update { $0.autoBackup = newVal } }
          )
        )
      }
    }
  }

  private var actionsSection: some View {
    SettingsBlockSection("Actions", footer: actionsFooter) {
      let backupDisabled = !backup.settings.enabled || backup.isBackingUp

      Button(action: performBackup) {
        SettingsBlockRow(
          icon: "icloud.and.arrow.up",
          title: "Back Up Now",
          trailingText: backup.isBackingUp ? "Working…" : nil
        )
        .opacity(backupDisabled ? 0.5 : 1.0)
      }
      .buttonStyle(.plain)
      .disabled(backupDisabled)

      Button { showRestoreAlert = true } label: {
        SettingsBlockRow(
          icon: "arrow.counterclockwise.icloud",
          title: "Restore from Backup"
        )
      }
      .buttonStyle(.plain)
    }
  }

  private var statusSection: some View {
    SettingsBlockSection("Status", footer: statusFooter) {
      SettingsBlockInfoRow(
        icon: backup.isICloudAvailable ? "checkmark.icloud.fill" : "externaldrive.fill",
        title: backup.isICloudAvailable ? "iCloud connected" : "iCloud unavailable",
        value: ""
      )
    }
  }

  // MARK: - Helpers

  private var actionsFooter: String? {
    guard let last = backup.settings.lastBackupAt else { return nil }
    return "Last: \(last.formatted(date: .abbreviated, time: .shortened))"
  }

  private var statusFooter: String {
    if backup.isICloudAvailable {
      return "Backups are stored in your iCloud Drive and synced across all your devices."
    } else {
      return "Sign in to iCloud in Settings to sync backups across devices. Local backups are still available."
    }
  }

  private func performBackup() {
    Task {
      switch await backup.performBackupNow() {
      case .success:
        break
      case .failure(let error):
        await MainActor.run {
          errorMessage = error.localizedDescription
          showError = true
        }
      }
    }
  }

  private func performRestore() {
    Task {
      switch await backup.restoreFromBackup() {
      case .success(let result):
        await MainActor.run {
          if result.skippedDuplicates > 0 {
            errorMessage = String(
              localized: "Restored \(result.totalRestored) items. Skipped \(result.skippedDuplicates) duplicates."
            )
            showError = true
          } else {
            dismiss()
          }
        }
      case .failure(let error):
        await MainActor.run {
          errorMessage = error.localizedDescription
          showError = true
        }
      }
    }
  }
}

#Preview {
  NavigationView { BackupSettingsView() }
}
