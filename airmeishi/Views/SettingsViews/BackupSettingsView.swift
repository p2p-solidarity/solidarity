//
//  BackupSettingsView.swift
//  airmeishi
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
        Form {
            Section("iCloud Backup") {
                Toggle("Enable iCloud Backup", isOn: Binding(
                    get: { backup.settings.enabled },
                    set: { newVal in _ = backup.update { $0.enabled = newVal } }
                ))
                
                if backup.settings.enabled {
                    Toggle("Auto-backup", isOn: Binding(
                        get: { backup.settings.autoBackup },
                        set: { newVal in _ = backup.update { $0.autoBackup = newVal } }
                    ))
                    .help("Automatically backup when cards are changed")
                }
            }
            
            Section("Actions") {
                Button(action: performBackup) {
                    HStack {
                        Text("Back Up Now")
                        Spacer()
                        if backup.isBackingUp {
                            ProgressView()
                                .scaleEffect(0.8)
                        }
                    }
                }
                .disabled(!backup.settings.enabled || backup.isBackingUp)
                
                Button("Restore from Backup") {
                    showRestoreAlert = true
                }
                .foregroundColor(.blue)
                
                if let last = backup.settings.lastBackupAt {
                    Label(
                        "Last: \(last.formatted(date: .abbreviated, time: .shortened))",
                        systemImage: "checkmark.circle.fill"
                    )
                    .font(.footnote)
                    .foregroundColor(.secondary)
                }
            }
            
            Section(footer: Text("Backups are stored in your iCloud Drive and synced across all your devices.")) {
                EmptyView()
            }
        }
        .navigationTitle("Backup")
        .onAppear { backup.loadSettings() }
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Done") { dismiss() }
            }
        }
        .alert("Restore from Backup?", isPresented: $showRestoreAlert) {
            Button("Cancel", role: .cancel) { }
            Button("Restore", role: .destructive) {
                performRestore()
            }
        } message: {
            Text("This will replace your current cards and contacts with the backed up data.")
        }
        .alert("Error", isPresented: $showError) {
            Button("OK") { }
        } message: {
            Text(errorMessage)
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
            case .success:
                await MainActor.run {
                    dismiss()
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

