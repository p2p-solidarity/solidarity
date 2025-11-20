//
//  IDView.swift
//  airmeishi
//
//  Unified identity and group management with ripple animation, OpenID, and ZK settings
//

import SwiftUI

struct IDView: View {
    @ObservedObject private var coordinator = IdentityCoordinator.shared
    @StateObject private var groupManager = SemaphoreGroupManager.shared
    @StateObject private var idm = SemaphoreIdentityManager.shared
    @StateObject private var oidcService = OIDCService.shared
    @State private var identityCommitment: String = ""
    @State private var showingGroupManager = false
    @State private var showingRecomputeAlert = false
    @State private var showingOIDCRequest = false
    @State private var showingZKSettings = false
    @State private var needsRecompute = false
    @State private var memberCountBeforeAdd: Int = 0
    @State private var ringActiveCount = 0
    @State private var isPressing = false
    @State private var ringTimer: Timer?
    @State private var isWorking = false
    @State private var showErrorAlert = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Ripple animation center button
                    rippleCenterButton
                        .frame(height: 320)
                    
                    // Row 1: ZK Commitment -> ID
                    identityRow
                    
                    // Row 2: Group Management
                    groupRow
                    
                    // Row 3: OpenID & ZK Settings
                    settingsRow
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 20)
            }
            .background(Color(.systemGroupedBackground).ignoresSafeArea())
            .navigationTitle("ID")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        coordinator.refreshIdentity()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .foregroundColor(.primary)
                    }
                }
            }
            .onAppear {
                loadIdentity()
                memberCountBeforeAdd = groupManager.members.count
            }
            .onChange(of: groupManager.members.count) { oldValue, newValue in
                if newValue > oldValue && oldValue > 0 {
                    needsRecompute = true
                    showingRecomputeAlert = true
                }
            }
            .alert("Recompute Root Needed", isPresented: $showingRecomputeAlert) {
                Button("Recompute Now") {
                    groupManager.recomputeRoot()
                    needsRecompute = false
                }
                Button("Later", role: .cancel) {}
            } message: {
                Text("New members have been added. Would you like to recompute the Merkle root now?")
            }
            .alert("Error", isPresented: $showErrorAlert) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "Unknown error")
            }
            .sheet(isPresented: $showingGroupManager) {
                NavigationStack {
                    GroupManagementView()
                }
            }
            .sheet(isPresented: $showingOIDCRequest) {
                OIDCRequestView()
            }
            .sheet(isPresented: $showingZKSettings) {
                ZKSettingsView()
            }
        }
    }
    
    // MARK: - Ripple Center Button
    
    private var rippleCenterButton: some View {
        GeometryReader { geo in
            let base = min(geo.size.width, geo.size.height)
            ZStack {
                ringView(size: base * 0.80, index: 3)
                ringView(size: base * 0.62, index: 2)
                ringView(size: base * 0.46, index: 1)
                centerButton(size: base * 0.36)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
    
    private func ringView(size: CGFloat, index: Int) -> some View {
        Circle()
            .stroke(lineWidth: 8)
            .foregroundColor(
                index == 1
                ? Color.gray.opacity(0.2)
                : (index <= ringActiveCount ? Color.accentColor : Color.gray.opacity(0.2))
            )
            .frame(width: size, height: size)
            .animation(.easeInOut(duration: 0.3), value: ringActiveCount)
    }
    
    private func centerButton(size: CGFloat) -> some View {
        let longPressDuration: Double = 1.5
        return ZStack {
            Circle()
                .fill(
                    identityCommitment.isEmpty
                    ? LinearGradient(colors: [.accentColor.opacity(0.9), .accentColor.opacity(0.7)], startPoint: .topLeading, endPoint: .bottomTrailing)
                    : LinearGradient(colors: [.green.opacity(0.95), .blue.opacity(0.75)], startPoint: .topLeading, endPoint: .bottomTrailing)
                )
                .frame(width: size, height: size)
                .shadow(color: .accentColor.opacity(isPressing ? 0.6 : 0.25), radius: isPressing ? 20 : 10)
                .overlay(
                    VStack(spacing: 6) {
                        Text("ID")
                            .font(.title2.weight(.bold))
                            .foregroundColor(.white)
                            .shadow(color: .black.opacity(0.35), radius: 3, x: 0, y: 1)

                        if !identityCommitment.isEmpty {
                            VStack(spacing: 4) {
                                Text("Commitment")
                                    .font(.caption2)
                                    .foregroundColor(.white.opacity(0.9))
                                Text(shortCommitment(identityCommitment))
                                    .font(.caption.monospaced())
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                    .background(Color.black.opacity(0.20))
                                    .clipShape(RoundedRectangle(cornerRadius: 6))
                            }
                        } else {
                            Text("Tap to create ID\nHold to manage groups")
                                .font(.caption2)
                                .multilineTextAlignment(.center)
                                .foregroundColor(.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.black.opacity(0.20))
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                    }
                )
                .onTapGesture { tapAction() }
                .onLongPressGesture(minimumDuration: longPressDuration, maximumDistance: 50, pressing: { pressing in
                    isPressing = pressing
                    if pressing {
                        startRingAnimation()
                        #if canImport(UIKit)
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        #endif
                    } else {
                        stopRingAnimation(reset: false)
                    }
                }, perform: {
                    #if canImport(UIKit)
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    #endif
                    stopRingAnimation(reset: false)
                    longPressAction()
                })
        }
    }
    
    private func startRingAnimation() {
        ringActiveCount = 1
        ringTimer?.invalidate()
        ringTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { timer in
            ringActiveCount = min(3, ringActiveCount + 1)
            if ringActiveCount >= 3 { timer.invalidate() }
        }
    }
    
    private func stopRingAnimation(reset: Bool) {
        ringTimer?.invalidate()
        ringTimer = nil
        if reset { ringActiveCount = 0 }
    }
    
    private func tapAction() {
        if isWorking { return }
        isWorking = true
        
        Task {
            do {
                let bundle = try await Task.detached(priority: .userInitiated) {
                    try idm.loadOrCreateIdentity()
                }.value
                
                await MainActor.run {
                    identityCommitment = bundle.commitment
                    
                    if !groupManager.members.contains(bundle.commitment) {
                        groupManager.addMember(bundle.commitment)
                    }
                    
                    IdentityCoordinator.shared.refreshIdentity()
                    isWorking = false
                }
                
                #if canImport(UIKit)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                #endif
            } catch {
                await MainActor.run {
                    errorMessage = "Failed to create identity: \(error.localizedDescription)"
                    showErrorAlert = true
                    isWorking = false
                }
            }
        }
    }
    
    private func longPressAction() {
        if isWorking { return }
        isWorking = true
        
        Task {
            do {
                let bundle = try await Task.detached(priority: .userInitiated) {
                    try idm.loadOrCreateIdentity()
                }.value
                
                await MainActor.run {
                    identityCommitment = bundle.commitment
                    isWorking = false
                    showingGroupManager = true
                }
            } catch {
                await MainActor.run {
                    errorMessage = "Failed to prepare for group management: \(error.localizedDescription)"
                    showErrorAlert = true
                    isWorking = false
                }
            }
        }
    }
    
    private func shortCommitment(_ value: String) -> String {
        guard value.count > 12 else { return value }
        let start = value.prefix(6)
        let end = value.suffix(6)
        return String(start) + "…" + String(end)
    }
    
    // MARK: - Row 1: Identity (ZK Commitment -> ID)
    
    private var identityRow: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Image(systemName: "person.crop.circle.badge.checkmark")
                    .font(.title2)
                    .foregroundColor(.primary)
                
                Text("Identity")
                    .font(.headline)
                    .foregroundColor(.primary)
                
                Spacer()
            }
            
            if let commitment = coordinator.state.zkIdentity?.commitment {
                VStack(alignment: .leading, spacing: 8) {
                    Text("ZK Commitment")
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.secondary)
                    
                    Button(action: copyCommitment) {
                        HStack {
                            Text(commitment)
                                .font(.footnote.monospaced())
                                .foregroundColor(.primary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            
                            Spacer()
                            
                            Image(systemName: "doc.on.doc")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(Color(.secondarySystemBackground))
                        )
                    }
                    .buttonStyle(.plain)
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("No Identity")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
            }
            
            if let did = coordinator.state.activeDid?.did {
                VStack(alignment: .leading, spacing: 4) {
                    Text("DID")
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.secondary)
                    
                    Text(did)
                        .font(.footnote.monospaced())
                        .foregroundColor(.primary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(.secondarySystemBackground))
        )
    }
    
    // MARK: - Row 2: Group Management
    
    private var groupRow: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Image(systemName: "person.3")
                    .font(.title2)
                    .foregroundColor(.primary)
                
                Text("Group")
                    .font(.headline)
                    .foregroundColor(.primary)
                
                Spacer()
                
                if needsRecompute {
                    Button(action: {
                        groupManager.recomputeRoot()
                        needsRecompute = false
                    }) {
                        HStack(spacing: 4) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.caption)
                            Text("Recompute")
                                .font(.caption.weight(.semibold))
                        }
                        .foregroundColor(.orange)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(
                            Capsule()
                                .fill(Color.orange.opacity(0.15))
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            
            if let currentGroup = currentGroup {
                VStack(alignment: .leading, spacing: 12) {
                    LabeledContent("Name", value: currentGroup.name)
                    
                    if let root = currentGroup.root {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Merkle Root")
                                .font(.caption.weight(.semibold))
                                .foregroundColor(.secondary)
                            
                            Text(root)
                                .font(.footnote.monospaced())
                                .foregroundColor(.primary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }
                    
                    Text("Members: \(currentGroup.members.count)")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                    
                    if let commitment = coordinator.state.zkIdentity?.commitment,
                       let index = groupManager.members.firstIndex(of: commitment) {
                        Text("Your commitment is member #\(index + 1)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("No group selected")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
            }
            
            Button(action: { showingGroupManager = true }) {
                Label("Manage Groups", systemImage: "gearshape.fill")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color(.tertiarySystemBackground))
                    )
                    .foregroundColor(.primary)
            }
            .buttonStyle(.plain)
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(.secondarySystemBackground))
        )
    }
    
    // MARK: - Row 3: OpenID & ZK Settings
    
    private var settingsRow: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Image(systemName: "gearshape.2")
                    .font(.title2)
                    .foregroundColor(.primary)
                
                Text("Settings")
                    .font(.headline)
                    .foregroundColor(.primary)
                
                Spacer()
            }
            
            VStack(spacing: 12) {
                Button(action: { showingOIDCRequest = true }) {
                    HStack {
                        Image(systemName: "qrcode")
                            .font(.title3)
                            .foregroundColor(.primary)
                        
                        VStack(alignment: .leading, spacing: 4) {
                            Text("OpenID Request")
                                .font(.subheadline.weight(.medium))
                                .foregroundColor(.primary)
                            
                            Text("Create presentation request QR")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        
                        Spacer()
                        
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color(.tertiarySystemBackground))
                    )
                }
                .buttonStyle(.plain)
                
                Button(action: { showingZKSettings = true }) {
                    HStack {
                        Image(systemName: "lock.shield")
                            .font(.title3)
                            .foregroundColor(.primary)
                        
                        VStack(alignment: .leading, spacing: 4) {
                            Text("ZK Settings")
                                .font(.subheadline.weight(.medium))
                                .foregroundColor(.primary)
                            
                            Text("Configure Semaphore identity")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        
                        Spacer()
                        
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color(.tertiarySystemBackground))
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(.secondarySystemBackground))
        )
    }

    // MARK: - Helpers
    
    private var currentGroup: SemaphoreGroupManager.ManagedGroup? {
        guard let id = groupManager.selectedGroupId else { return nil }
        return groupManager.allGroups.first(where: { $0.id == id })
    }
    
    private func loadIdentity() {
        if let id = idm.getIdentity() {
            identityCommitment = id.commitment
        }
    }
    
    private func copyCommitment() {
        guard let commitment = coordinator.state.zkIdentity?.commitment else { return }
        #if canImport(UIKit)
        UIPasteboard.general.string = commitment
        #endif
    }
}

// MARK: - OIDC Request View

struct OIDCRequestView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var qrManager = QRCodeManager.shared
    @State private var qrImage: UIImage?
    @State private var qrString: String?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showingError = false
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    if let qrImage = qrImage {
                        Image(uiImage: qrImage)
                            .resizable()
                            .interpolation(.none)
                            .scaledToFit()
                            .frame(width: 300, height: 300)
                            .padding()
                            .background(Color.white)
                            .cornerRadius(16)
                        
                        if let qrString = qrString {
                            Button(action: copyQRString) {
                                Label("Copy QR String", systemImage: "doc.on.doc")
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                                    .background(
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .fill(Color.accentColor)
                                    )
                            }
                            .buttonStyle(.plain)
                        }
                    } else {
                        Button(action: generateOIDCRequest) {
                            Label(isLoading ? "Generating..." : "Generate OIDC Request", systemImage: "qrcode")
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                        }
                        .buttonStyle(.plain)
                        .disabled(isLoading)
                    }
                }
                .padding()
            }
            .navigationTitle("OpenID Request")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .alert("Error", isPresented: $showingError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "Unknown error")
            }
        }
    }
    
    private func generateOIDCRequest() {
        isLoading = true
        let result = OIDCService.shared.createPresentationRequest()
        
        switch result {
        case .failure(let error):
            errorMessage = error.localizedDescription
            showingError = true
            isLoading = false
        case .success(let context):
            qrString = context.qrString
            let qrResult = qrManager.generateQRCode(from: context.qrString)
            switch qrResult {
            case .success(let image):
                qrImage = image
            case .failure(let error):
                errorMessage = error.localizedDescription
                showingError = true
            }
            isLoading = false
        }
    }
    
    private func copyQRString() {
        guard let qrString = qrString else { return }
        #if canImport(UIKit)
        UIPasteboard.general.string = qrString
        #endif
    }
}

// MARK: - ZK Settings View

struct ZKSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var idm = SemaphoreIdentityManager.shared
    @State private var identityCommitment: String?
    @State private var showingDeleteConfirm = false
    
    var body: some View {
        NavigationStack {
            List {
                Section("Identity Status") {
                    if let commitment = identityCommitment {
                        LabeledContent("Commitment", value: commitment)
                            .font(.footnote.monospaced())
                    } else {
                        Text("No identity created")
                            .foregroundColor(.secondary)
                    }
                    
                    LabeledContent("Proofs Supported", value: SemaphoreIdentityManager.proofsSupported ? "Yes" : "No")
                }
                
                Section("Actions") {
                    Button(role: .destructive, action: { showingDeleteConfirm = true }) {
                        Label("Delete Identity", systemImage: "trash")
                    }
                    .disabled(identityCommitment == nil)
                }
            }
            .navigationTitle("ZK Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .onAppear {
                identityCommitment = idm.getIdentity()?.commitment
            }
            .alert("Delete Identity?", isPresented: $showingDeleteConfirm) {
                Button("Delete", role: .destructive) {
                    // TODO: Implement identity deletion
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This will permanently delete your ZK identity. This action cannot be undone.")
            }
        }
    }
}

#Preview {
    IDView()
}
