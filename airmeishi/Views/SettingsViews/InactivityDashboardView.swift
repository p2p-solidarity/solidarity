//
//  InactivityDashboardView.swift
//  airmeishi
//
//  Inactivity monitoring dashboard for digital will feature
//

import SwiftUI

struct InactivityDashboardView: View {
    @StateObject private var monitor = InactivityMonitorService.shared
    @StateObject private var vault = SovereignVaultService.shared
    @State private var showingConfigSheet = false

    var body: some View {
        Form {
            Section {
                ActivityStatusCard(status: monitor.statusSummary)
            }

            Section("Activity") {
                HStack {
                    Label("Last Activity", systemImage: "hand.tap")
                    Spacer()
                    Text(monitor.lastActivityDate, style: .relative)
                        .foregroundColor(.secondary)
                }

                HStack {
                    Label("Days Inactive", systemImage: "calendar")
                    Spacer()
                    Text("\(monitor.daysSinceActivity)")
                        .font(.headline)
                        .foregroundColor(daysColor)
                }

                Button {
                    monitor.recordActivity()
                } label: {
                    Label("Record Activity Now", systemImage: "checkmark.circle")
                }
            }

            if !monitor.pendingUnlocks.isEmpty {
                Section("Upcoming Unlocks") {
                    ForEach(monitor.pendingUnlocks) { pending in
                        PendingUnlockRow(pending: pending)
                    }
                }
            }

            Section("Monitored Items") {
                let monitoredItems = vault.items.filter { $0.timeLockConfig?.inactivityDays != nil }

                if monitoredItems.isEmpty {
                    ContentUnavailableView(
                        "No Monitored Items",
                        systemImage: "clock.badge.questionmark",
                        description: Text("Configure inactivity unlock on vault items")
                    )
                } else {
                    ForEach(monitoredItems) { item in
                        MonitoredItemRow(item: item)
                    }
                }
            }

            Section {
                Button {
                    showingConfigSheet = true
                } label: {
                    Label("Configure New Item", systemImage: "plus.circle")
                }
            }

            Section {
                Text("When you're inactive for the specified period, designated items will become accessible to your beneficiaries.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .navigationTitle("Inactivity Monitor")
        .sheet(isPresented: $showingConfigSheet) {
            NavigationStack {
                SelectItemForMonitoringView()
            }
        }
    }

    private var daysColor: Color {
        if monitor.daysSinceActivity == 0 {
            return .green
        } else if monitor.daysSinceActivity <= 7 {
            return .primary
        } else if monitor.daysSinceActivity <= 14 {
            return .orange
        } else {
            return .red
        }
    }
}

// MARK: - Activity Status Card

struct ActivityStatusCard: View {
    let status: ActivityStatus

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Image(systemName: statusIcon)
                    .font(.system(size: 40))
                    .foregroundColor(statusColor)

                VStack(alignment: .leading, spacing: 4) {
                    Text(status.statusMessage)
                        .font(.headline)
                    Text("Monitoring \(status.monitoredItemCount) item(s)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()
            }

            if status.pendingUnlockCount > 0 {
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(.orange)
                    Text("\(status.pendingUnlockCount) item(s) will unlock soon")
                        .font(.caption)
                        .foregroundColor(.orange)
                    Spacer()
                }
            }
        }
        .padding(.vertical, 8)
    }

    private var statusIcon: String {
        if status.daysSinceActivity == 0 {
            return "checkmark.shield.fill"
        } else if status.daysSinceActivity <= 7 {
            return "shield.fill"
        } else {
            return "exclamationmark.shield.fill"
        }
    }

    private var statusColor: Color {
        if status.daysSinceActivity == 0 {
            return .green
        } else if status.daysSinceActivity <= 7 {
            return .blue
        } else if status.daysSinceActivity <= 14 {
            return .orange
        } else {
            return .red
        }
    }
}

// MARK: - Pending Unlock Row

struct PendingUnlockRow: View {
    let pending: PendingUnlock

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(pending.itemName)
                    .font(.headline)
                Text(pending.unlockType.description)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            VStack(alignment: .trailing) {
                Text("\(pending.daysUntilUnlock)")
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(.orange)
                Text("days")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
    }
}

// MARK: - Monitored Item Row

struct MonitoredItemRow: View {
    let item: VaultItem

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(item.name)
                    .font(.body)

                if let config = item.timeLockConfig,
                   let days = config.inactivityDays {
                    Text("Unlocks after \(days) days of inactivity")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            Image(systemName: "clock.badge.checkmark")
                .foregroundColor(.blue)
        }
    }
}

// MARK: - Select Item For Monitoring

struct SelectItemForMonitoringView: View {
    @StateObject private var vault = SovereignVaultService.shared
    @Environment(\.dismiss) private var dismiss
    @State private var selectedItem: VaultItem?
    @State private var inactivityDays = 30
    @State private var showingBeneficiaryPicker = false

    var body: some View {
        Form {
            Section("Select Item") {
                let unmonitoredItems = vault.items.filter { $0.timeLockConfig?.inactivityDays == nil }

                if unmonitoredItems.isEmpty {
                    Text("All items are already being monitored")
                        .foregroundColor(.secondary)
                } else {
                    ForEach(unmonitoredItems) { item in
                        Button {
                            selectedItem = item
                        } label: {
                            HStack {
                                VaultItemRow(item: item)
                                Spacer()
                                if selectedItem?.id == item.id {
                                    Image(systemName: "checkmark")
                                        .foregroundColor(.blue)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            if selectedItem != nil {
                Section("Inactivity Period") {
                    Stepper("Unlock after \(inactivityDays) days", value: $inactivityDays, in: 7...365)

                    Text("If you don't open the app for \(inactivityDays) days, this item will become unlockable.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Section {
                    Button("Enable Monitoring") {
                        enableMonitoring()
                    }
                    .disabled(selectedItem == nil)
                }
            }
        }
        .navigationTitle("Add Monitored Item")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button("Cancel") { dismiss() }
            }
        }
    }

    private func enableMonitoring() {
        guard let item = selectedItem else { return }

        Task {
            try? await InactivityMonitorService.shared.configureMonitoring(
                for: item.id,
                inactivityDays: inactivityDays,
                beneficiaryContactId: nil
            )
            dismiss()
        }
    }
}

#Preview {
    NavigationStack {
        InactivityDashboardView()
    }
}
