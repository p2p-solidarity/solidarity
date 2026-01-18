//
//  ShardDistributionView.swift
//  airmeishi
//
//  UI for distributing Shamir key shards via AirDrop/QR
//

import SwiftUI
import CoreImage.CIFilterBuiltins

struct ShardDistributionView: View {
    @StateObject private var service = ShardDistributionService.shared
    @StateObject private var vault = SovereignVaultService.shared
    @State private var showingItemPicker = false
    @State private var selectedItem: VaultItem?
    @State private var recipientName = ""

    var body: some View {
        Form {
            Section("Distributed Shards") {
                if service.distributedShards.isEmpty {
                    ContentUnavailableView(
                        "No Shards Shared",
                        systemImage: "puzzlepiece.extension",
                        description: Text("Share key shards with trusted contacts for digital inheritance.")
                    )
                } else {
                    ForEach(service.distributedShards) { record in
                        DistributedShardRow(record: record)
                    }
                }

                Button {
                    showingItemPicker = true
                } label: {
                    Label("Distribute New Shard", systemImage: "plus")
                }
            }

            Section("Received Shards") {
                if service.receivedShards.isEmpty {
                    Text("No shards received yet")
                        .foregroundColor(.secondary)
                } else {
                    ForEach(service.receivedShards) { shard in
                        ReceivedShardRow(shard: shard)
                    }
                }
            }

            if !service.pendingRecoveries.isEmpty {
                Section("Active Recoveries") {
                    ForEach(service.pendingRecoveries) { session in
                        RecoverySessionRow(session: session)
                    }
                }
            }
        }
        .navigationTitle("Key Shards")
        .sheet(isPresented: $showingItemPicker) {
            NavigationStack {
                ShardDistributionFlow(item: $selectedItem)
            }
        }
    }
}

// MARK: - Distribution Flow

struct ShardDistributionFlow: View {
    @Binding var item: VaultItem?
    @StateObject private var vault = SovereignVaultService.shared
    @StateObject private var service = ShardDistributionService.shared
    @Environment(\.dismiss) private var dismiss

    @State private var step = 0
    @State private var selectedItem: VaultItem?
    @State private var recipientName = ""
    @State private var shardPackage: ShardPackage?
    @State private var showingShareSheet = false
    @State private var shareURL: URL?

    var body: some View {
        VStack {
            if step == 0 {
                // Step 1: Select Item
                List(vault.items) { vaultItem in
                    Button {
                        selectedItem = vaultItem
                        step = 1
                    } label: {
                        VaultItemRow(item: vaultItem)
                    }
                }
                .navigationTitle("Select Item")
            } else if step == 1 {
                // Step 2: Recipient Details
                Form {
                    TextField("Recipient Name", text: $recipientName)

                    Section {
                        Button("Generate Shard Package") {
                            generatePackage()
                        }
                        .disabled(recipientName.isEmpty)
                    }
                }
                .navigationTitle("Recipient")
            } else if let package = shardPackage {
                // Step 3: Share (QR / AirDrop)
                ScrollView {
                    VStack(spacing: 24) {
                        if let qr = service.generateQRCode(for: package) {
                            Image(uiImage: qr)
                                .resizable()
                                .interpolation(.none)
                                .scaledToFit()
                                .frame(width: 250, height: 250)
                                .padding()
                                .background(Color.white)
                                .cornerRadius(12)
                        }

                        Text("Scan to Accept Shard")
                            .font(.headline)

                        Button {
                            sharePackage(package)
                        } label: {
                            Label("Share via AirDrop", systemImage: "airplayaudio")
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color.blue)
                                .foregroundColor(.white)
                                .cornerRadius(10)
                        }
                        .padding(.horizontal)
                    }
                    .padding()
                }
                .navigationTitle("Share Shard")
                .sheet(isPresented: $showingShareSheet) {
                    if let url = shareURL {
                        ShareSheet(items: [url])
                    }
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button("Cancel") { dismiss() }
            }
        }
    }

    private func sharePackage(_ package: ShardPackage) {
        shareURL = generateAirDropFile(for: package)
        showingShareSheet = true
    }

    private func generatePackage() {
        guard let item = selectedItem else { return }

        // In a real app we'd get the actual shard from the item's config
        // For demo, we'll create a dummy one
        let dummyShard = EncryptedKeyShard(
            shardIndex: 1,
            encryptedData: Data(),
            recipientContactId: UUID()
        )

        shardPackage = service.createShardPackage(
            shard: dummyShard,
            itemName: item.name,
            recipientName: recipientName
        )

        service.recordDistribution(
            shard: dummyShard,
            itemId: item.id,
            itemName: item.name,
            recipientName: recipientName,
            method: .qrCode
        )

        step = 2
    }

    private func generateAirDropFile(for package: ShardPackage) -> URL {
        // This is a placeholder since ShareLink requires an ItemSource that is Sendable/Transferable
        // For simplicity in this demo we return a dummy URL, but in real impl we'd use service.createAirDropFile
        return service.createAirDropFile(for: package) ?? URL(fileURLWithPath: "/")
    }
}

// MARK: - Rows

struct DistributedShardRow: View {
    let record: DistributedShardRecord

    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text(record.recipientName)
                    .font(.headline)
                Text("Item: \(record.itemName)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            Spacer()
            Image(systemName: record.method.systemImage)
                .foregroundColor(.blue)
        }
    }
}

struct ReceivedShardRow: View {
    let shard: ReceivedShard

    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text(shard.senderName)
                    .font(.headline)
                Text("For: \(shard.itemName)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            Spacer()
            Text("Part \(shard.shardIndex)")
                .font(.caption)
                .padding(4)
                .background(Color.secondary.opacity(0.1))
                .cornerRadius(4)
        }
    }
}

struct RecoverySessionRow: View {
    let session: RecoverySession

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Recovering: \(session.itemName)")
                .font(.headline)

            ProgressView(value: session.progress)

            HStack {
                Text("\(session.collectedShards.count)/\(session.requiredShards) shards")
                    .font(.caption)
                Spacer()
                if session.status == .ready {
                    Text("Ready to Unlock")
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundColor(.green)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
