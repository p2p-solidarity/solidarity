//
//  SovereignVaultView.swift
//  airmeishi
//
//  Settings UI for The Sovereign Vault
//

import SwiftUI
import UIKit

struct SovereignVaultView: View {
    @StateObject private var vault = SovereignVaultService.shared
    @State private var showingImportSheet = false
    @State private var showingNewItemSheet = false
    @State private var searchText = ""
    @State private var selectedItem: VaultItem?
    @State private var showingDeleteAlert = false
    @State private var itemToDelete: VaultItem?

    var body: some View {
        Form {
            Section("Storage") {
                HStack {
                    Label("Used", systemImage: "internaldrive")
                    Spacer()
                    Text(vault.formattedTotalSize)
                        .foregroundColor(.secondary)
                }

                HStack {
                    Label("Items", systemImage: "doc.fill")
                    Spacer()
                    Text("\(vault.itemCount)")
                        .foregroundColor(.secondary)
                }

                Button {
                    showingImportSheet = true
                } label: {
                    Label("Import File", systemImage: "square.and.arrow.down")
                }
            }

            Section {
                if vault.items.isEmpty {
                    ContentUnavailableView(
                        "No Items",
                        systemImage: "lock.open",
                        description: Text("Import files to get started")
                    )
                } else {
                    ForEach(filteredItems) { item in
                        VaultItemRow(item: item)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                selectedItem = item
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button(role: .destructive) {
                                    itemToDelete = item
                                    showingDeleteAlert = true
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                    }
                }
            } header: {
                Text("Vault Items")
            } footer: {
                if !vault.lockedItems().isEmpty {
                    Text("\(vault.lockedItems().count) locked item(s)")
                }
            }

            Section("Quick Access") {
                NavigationLink {
                    LockedItemsView()
                } label: {
                    Label("Locked Items", systemImage: "lock.fill")
                    if !vault.lockedItems().isEmpty {
                        Spacer()
                        Text("\(vault.lockedItems().count)")
                            .foregroundColor(.secondary)
                    }
                }

                NavigationLink {
                    RecentItemsView()
                } label: {
                    Label("Recent", systemImage: "clock")
                }
            }

            Section("Cloud & Backup") {
                NavigationLink {
                    VaultCloudSyncView()
                } label: {
                    Label("iCloud Sync", systemImage: "icloud")
                }

                NavigationLink {
                    TwitterImportWizardView()
                } label: {
                    Label("Import Twitter Archive", systemImage: "bird")
                }
            }

            Section("Advanced Features") {
                NavigationLink {
                    InactivityDashboardView()
                } label: {
                    Label("Digital Will", systemImage: "text.book.closed")
                }

                NavigationLink {
                    AgeVerificationSettingsView()
                } label: {
                    Label("Age Verification", systemImage: "person.text.rectangle")
                }

                NavigationLink {
                    ShardDistributionView()
                } label: {
                    Label("Key Shard Distribution", systemImage: "puzzlepiece.extension")
                }
            }
        }
        .navigationTitle("Sovereign Vault")
        .searchable(text: $searchText, prompt: "Search vault")
        .sheet(isPresented: $showingImportSheet) {
            DocumentPicker { url in
                Task {
                    _ = try? await vault.importFile(url, name: nil)
                }
            }
        }
        .sheet(item: $selectedItem) { item in
            NavigationStack {
                VaultItemDetailView(item: item)
            }
        }
        .alert("Delete Item?", isPresented: $showingDeleteAlert) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                if let item = itemToDelete {
                    Task {
                        _ = try? await vault.deleteItem(item.id)
                    }
                }
            }
        } message: {
            Text("This will permanently delete the item from your vault.")
        }
    }

    private var filteredItems: [VaultItem] {
        if searchText.isEmpty {
            return vault.items
        }
        return vault.searchItems(query: searchText)
    }
}

// MARK: - Vault Item Row

struct VaultItemRow: View {
    let item: VaultItem

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: item.metadata.contentType.systemImage)
                .font(.title2)
                .foregroundColor(.accentColor)
                .frame(width: 40, height: 40)
                .background(Color.accentColor.opacity(0.1))
                .cornerRadius(8)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(item.name)
                        .font(.body)
                        .lineLimit(1)

                    if item.isLocked {
                        Image(systemName: "lock.fill")
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                }

                Text(item.metadata.contentDescription)
                    .font(.caption)
                    .foregroundColor(.secondary)

                if !item.tags.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 4) {
                            ForEach(item.tags.prefix(3), id: \.self) { tag in
                                Text(tag)
                                    .font(.caption2)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Color.secondary.opacity(0.1))
                                    .cornerRadius(4)
                            }
                            if item.tags.count > 3 {
                                Text("+\(item.tags.count - 3)")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                }
            }

            Spacer()

            Text(item.formattedSize)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Vault Item Detail View

struct VaultItemDetailView: View {
    let item: VaultItem
    @Environment(\.dismiss) private var dismiss
    @StateObject private var vault = SovereignVaultService.shared
    @State private var showingShareSheet = false
    @State private var decryptedData: Data?
    @State private var isDecrypting = false
    @State private var showingTimeLockSheet = false

    var body: some View {
        Form {
            Section {
                HStack {
                    Spacer()
                    Image(systemName: item.metadata.contentType.systemImage)
                        .font(.system(size: 60))
                        .foregroundColor(.accentColor)
                    Spacer()
                }
            }

            Section("Details") {
                LabeledContent("Name", value: item.name)
                LabeledContent("Size", value: item.formattedSize)
                LabeledContent("Type", value: item.metadata.contentType.displayName)
                LabeledContent("Created", value: item.createdAt.formatted(date: .abbreviated, time: .shortened))
                LabeledContent("Modified", value: item.updatedAt.formatted(date: .abbreviated, time: .shortened))
            }

            Section("Checksum") {
                Text(item.metadata.checksum)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .textSelection(.enabled)
            }

            if !item.tags.isEmpty {
                Section("Tags") {
                    FlowLayout(spacing: 8) {
                        ForEach(item.tags, id: \.self) { tag in
                            Text(tag)
                                .font(.caption)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(Color.accentColor.opacity(0.1))
                                .cornerRadius(12)
                        }
                    }
                }
            }

            Section("Access") {
                LabeledContent("Access Control", value: item.accessControl.displayName)

                if let config = item.timeLockConfig {
                    LabeledContent("Time Lock", value: config.description)
                }

                Button {
                    showingTimeLockSheet = true
                } label: {
                    Label("Configure Access", systemImage: "lock.shield")
                }
            }

            Section {
                if let data = decryptedData {
                    Button {
                        showingShareSheet = true
                    } label: {
                        Label("Share Decrypted", systemImage: "square.and.arrow.up")
                    }

                    LabeledContent("Decrypted Size", value: ByteCountFormatter.string(fromByteCount: Int64(data.count), countStyle: .file))
                } else {
                    Button {
                        Task {
                            isDecrypting = true
                            decryptedData = try? await vault.getDecryptedData(item.id)
                            isDecrypting = false
                        }
                    } label: {
                        if isDecrypting {
                            ProgressView()
                        } else {
                            Label("Decrypt & Preview", systemImage: "lock.open")
                        }
                    }
                    .disabled(isDecrypting)
                }
            }
        }
        .navigationTitle("Item Details")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Done") { dismiss() }
            }
        }
        .sheet(isPresented: $showingShareSheet) {
            if let data = decryptedData {
                ShareSheet(items: [data])
            }
        }
        .sheet(isPresented: $showingTimeLockSheet) {
            NavigationStack {
                TimeLockConfigView(itemId: item.id)
            }
        }
    }
}

// MARK: - Locked Items View

struct LockedItemsView: View {
    @StateObject private var vault = SovereignVaultService.shared

    var body: some View {
        List {
            ForEach(vault.lockedItems()) { item in
                NavigationLink {
                    VaultItemDetailView(item: item)
                } label: {
                    VaultItemRow(item: item)
                }
            }
        }
        .navigationTitle("Locked Items")
        .overlay {
            if vault.lockedItems().isEmpty {
                ContentUnavailableView(
                    "No Locked Items",
                    systemImage: "lock.open",
                    description: Text("Items with time locks will appear here")
                )
            }
        }
    }
}

// MARK: - Recent Items View

struct RecentItemsView: View {
    @StateObject private var vault = SovereignVaultService.shared

    var body: some View {
        List {
            ForEach(vault.recentItems()) { item in
                NavigationLink {
                    VaultItemDetailView(item: item)
                } label: {
                    VaultItemRow(item: item)
                }
            }
        }
        .navigationTitle("Recent Items")
    }
}

// MARK: - Time Lock Config View

struct TimeLockConfigView: View {
    let itemId: UUID
    @Environment(\.dismiss) private var dismiss
    @StateObject private var vault = SovereignVaultService.shared
    @State private var hasTimeLock = false
    @State private var unlockDate = Date().addingTimeInterval(24 * 60 * 60)
    @State private var enableInactivity = false
    @State private var inactivityDays = 30

    var body: some View {
        Form {
            Section {
                Toggle("Enable Time Lock", isOn: $hasTimeLock)
            }

            if hasTimeLock {
                Section("Unlock Date") {
                    DatePicker("Unlock At", selection: $unlockDate, displayedComponents: [.date, .hourAndMinute])
                }

                Section("Inactivity Unlock") {
                    Toggle("Enable Inactivity Detection", isOn: $enableInactivity)

                    if enableInactivity {
                        Stepper("Unlock after \(inactivityDays) days", value: $inactivityDays, in: 7...365)
                    }
                }

                Section {
                    Text("The item will automatically unlock when either condition is met.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .navigationTitle("Time Lock")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button("Save") {
                    let config = TimeLockConfig(
                        enabled: hasTimeLock,
                        unlockDate: unlockDate,
                        inactivityDays: enableInactivity ? inactivityDays : nil
                    )
                    Task {
                        _ = try? await vault.updateTimeLock(itemId, config: config)
                        dismiss()
                    }
                }
            }
        }
    }
}

// MARK: - Flow Layout

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = FlowResult(in: proposal.width ?? 0, subviews: subviews, spacing: spacing)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = FlowResult(in: bounds.width, subviews: subviews, spacing: spacing)
        for (index, subview) in subviews.enumerated() {
            subview.place(at: CGPoint(x: bounds.minX + result.positions[index].x,
                                      y: bounds.minY + result.positions[index].y),
                         proposal: .unspecified)
        }
    }

    struct FlowResult {
        var size: CGSize = .zero
        var positions: [CGPoint] = []

        init(in maxWidth: CGFloat, subviews: Subviews, spacing: CGFloat) {
            var x: CGFloat = 0
            var y: CGFloat = 0
            var rowHeight: CGFloat = 0

            for subview in subviews {
                let size = subview.sizeThatFits(.unspecified)

                if x + size.width > maxWidth && x > 0 {
                    x = 0
                    y += rowHeight + spacing
                    rowHeight = 0
                }

                positions.append(CGPoint(x: x, y: y))
                rowHeight = max(rowHeight, size.height)
                x += size.width + spacing
            }

            self.size = CGSize(width: maxWidth, height: y + rowHeight)
        }
    }
}

// MARK: - Document Picker

struct DocumentPicker: UIViewControllerRepresentable {
    let onPick: (URL) -> Void

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.data])
        picker.delegate = context.coordinator
        picker.allowsMultipleSelection = false
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onPick: onPick)
    }

    class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onPick: (URL) -> Void

        init(onPick: @escaping (URL) -> Void) {
            self.onPick = onPick
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let url = urls.first else { return }
            onPick(url)
        }
    }
}
