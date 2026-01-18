//
//  VaultCloudSyncView.swift
//  airmeishi
//
//  iCloud sync status and controls for Sovereign Vault
//

import SwiftUI

struct VaultCloudSyncView: View {
    @StateObject private var syncService = VaultCloudSyncService.shared
    @State private var isManualSyncing = false
    @State private var showingConflicts = false
    @State private var cloudInfo: CloudStorageInfo?

    var body: some View {
        Form {
            Section {
                HStack {
                    Image(systemName: syncService.isCloudAvailable ? "icloud.fill" : "icloud.slash")
                        .foregroundColor(syncService.isCloudAvailable ? .blue : .gray)
                        .font(.title2)

                    VStack(alignment: .leading, spacing: 4) {
                        Text(syncService.isCloudAvailable ? "iCloud Connected" : "iCloud Unavailable")
                            .font(.headline)
                        Text(statusMessage)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    Spacer()

                    if syncService.isSyncing {
                        ProgressView()
                    }
                }
                .padding(.vertical, 4)
            }

            if syncService.isCloudAvailable {
                Section("Sync Status") {
                    HStack {
                        Label("Status", systemImage: statusIcon)
                        Spacer()
                        Text(syncService.syncStatus.displayName)
                            .foregroundColor(statusColor)
                    }

                    if let lastSync = syncService.lastSyncDate {
                        HStack {
                            Label("Last Synced", systemImage: "clock")
                            Spacer()
                            Text(lastSync, style: .relative)
                                .foregroundColor(.secondary)
                        }
                    }

                    if syncService.isSyncing {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Syncing...")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            ProgressView(value: syncService.syncProgress)
                                .progressViewStyle(.linear)
                        }
                    }
                }

                Section {
                    Button {
                        Task {
                            isManualSyncing = true
                            try? await syncService.performSync()
                            await loadCloudInfo()
                            isManualSyncing = false
                        }
                    } label: {
                        HStack {
                            Label("Sync Now", systemImage: "arrow.triangle.2.circlepath")
                            Spacer()
                            if isManualSyncing {
                                ProgressView()
                            }
                        }
                    }
                    .disabled(syncService.isSyncing)
                }

                if let info = cloudInfo {
                    Section("Cloud Storage") {
                        LabeledContent("Items in Cloud", value: "\(info.itemCount)")
                        LabeledContent("Cloud Usage", value: info.formattedSize)
                    }
                }

                if !syncService.pendingConflicts.isEmpty {
                    Section {
                        Button {
                            showingConflicts = true
                        } label: {
                            HStack {
                                Label("Resolve Conflicts", systemImage: "exclamationmark.triangle.fill")
                                    .foregroundColor(.orange)
                                Spacer()
                                Text("\(syncService.pendingConflicts.count)")
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                }
            } else {
                Section {
                    VStack(spacing: 12) {
                        Image(systemName: "icloud.slash")
                            .font(.system(size: 40))
                            .foregroundColor(.gray)
                        Text("iCloud Not Available")
                            .font(.headline)
                        Text("Sign in to iCloud in Settings to enable vault sync across your devices.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical)
                }
            }

            Section {
                Text("Your vault data is encrypted before being synced to iCloud. Only you can decrypt it.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .navigationTitle("Cloud Sync")
        .task {
            await loadCloudInfo()
        }
        .sheet(isPresented: $showingConflicts) {
            NavigationStack {
                ConflictResolutionView()
            }
        }
    }

    private var statusMessage: String {
        switch syncService.syncStatus {
        case .idle: return "Not synced yet"
        case .syncing: return "Syncing..."
        case .synced: return "Up to date"
        case .conflictsExist: return "Conflicts need resolution"
        case .error(let msg): return msg
        }
    }

    private var statusIcon: String {
        switch syncService.syncStatus {
        case .idle: return "circle.dashed"
        case .syncing: return "arrow.triangle.2.circlepath"
        case .synced: return "checkmark.circle.fill"
        case .conflictsExist: return "exclamationmark.triangle.fill"
        case .error: return "xmark.circle.fill"
        }
    }

    private var statusColor: Color {
        switch syncService.syncStatus {
        case .idle: return .secondary
        case .syncing: return .blue
        case .synced: return .green
        case .conflictsExist: return .orange
        case .error: return .red
        }
    }

    private func loadCloudInfo() async {
        cloudInfo = try? await syncService.getCloudStorageInfo()
    }
}

// MARK: - Conflict Resolution View

struct ConflictResolutionView: View {
    @StateObject private var syncService = VaultCloudSyncService.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            ForEach(syncService.pendingConflicts) { conflict in
                ConflictRow(conflict: conflict) { resolution in
                    Task {
                        try? await syncService.resolveConflict(conflict, resolution: resolution)
                    }
                }
            }
        }
        .navigationTitle("Resolve Conflicts")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Done") { dismiss() }
            }
        }
        .overlay {
            if syncService.pendingConflicts.isEmpty {
                ContentUnavailableView(
                    "No Conflicts",
                    systemImage: "checkmark.circle",
                    description: Text("All conflicts have been resolved")
                )
            }
        }
    }
}

struct ConflictRow: View {
    let conflict: VaultConflict
    let onResolve: (ConflictResolution) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Item ID: \(conflict.itemId.uuidString.prefix(8))...")
                .font(.headline)

            HStack {
                VStack(alignment: .leading) {
                    Text("Local")
                        .font(.caption)
                        .foregroundColor(.blue)
                    Text(conflict.localModified, style: .relative)
                        .font(.caption2)
                }

                Spacer()

                VStack(alignment: .trailing) {
                    Text("Cloud")
                        .font(.caption)
                        .foregroundColor(.purple)
                    Text(conflict.cloudModified, style: .relative)
                        .font(.caption2)
                }
            }

            if conflict.isIdentical {
                Text("Files are identical (timestamps differ)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            HStack(spacing: 12) {
                Button("Keep Local") {
                    onResolve(.keepLocal)
                }
                .buttonStyle(.bordered)
                .tint(.blue)

                Button("Keep Cloud") {
                    onResolve(.keepCloud)
                }
                .buttonStyle(.bordered)
                .tint(.purple)

                Button("Keep Both") {
                    onResolve(.keepBoth)
                }
                .buttonStyle(.bordered)
            }
            .font(.caption)
        }
        .padding(.vertical, 4)
    }
}
