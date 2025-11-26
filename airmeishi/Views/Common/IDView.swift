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
    
    // UI State
    @State private var showingGroupManager = false
    @State private var showingOIDCRequest = false
    @State private var showingZKSettings = false
    @State private var selectedGroupIndex: Int = 0
    @State private var isWorking = false
    @State private var showErrorAlert = false
    @State private var errorMessage: String?
    
    // Computed Properties
    private var profile: UnifiedProfile {
        coordinator.state.currentProfile
    }
    
    private var rippleState: RippleButtonState {
        if coordinator.state.isLoading || isWorking {
            return .processing
        }
        if profile.zkIdentity == nil {
            return .idle
        }
        // Check if any group needs sync
        if profile.memberships.contains(where: { $0.status == .outdated }) {
            return .syncNeeded
        }
        return .idle
    }
    
    var body: some View {
        NavigationStack {
            ZStack {
                // Background
                Color(.systemGroupedBackground)
                    .ignoresSafeArea()
                
                VStack(spacing: 0) {
                    // 1. The Mask (DID Switcher)
                    maskSection
                        .padding(.top, 20)
                        .padding(.bottom, 40)
                    
                    // 2. The Core (Ripple Button)
                    coreSection
                    
                    Spacer()
                    
                    // 3. The Badge (Group Cards)
                    badgeSection
                        .padding(.bottom, 20)
                }
            }
            .navigationTitle("ID")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack {
                        Button {
                            showingOIDCRequest = true
                        } label: {
                            Image(systemName: "qrcode")
                                .foregroundColor(.primary)
                        }
                        
                        Button {
                            coordinator.refreshIdentity()
                        } label: {
                            Image(systemName: "arrow.clockwise")
                                .foregroundColor(.primary)
                        }
                    }
                }
                
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        showingZKSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                            .foregroundColor(.primary)
                    }
                }
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
    
    // MARK: - 1. The Mask (DID Switcher)
    
    private var maskSection: some View {
        VStack(spacing: 12) {
            HStack(spacing: 0) {
                didCapsule(
                    title: "Anonymous",
                    subtitle: "did:key",
                    isActive: isDidKeyActive,
                    action: { switchDID(.key) }
                )
                
                Divider()
                    .frame(height: 24)
                
                didCapsule(
                    title: "Public",
                    subtitle: "did:ethr",
                    isActive: !isDidKeyActive,
                    action: { switchDID(.ethr) }
                )
            }
            .background(Color(.secondarySystemBackground))
            .clipShape(Capsule())
            .shadow(color: Color.black.opacity(0.05), radius: 5, x: 0, y: 2)
            
            // DID String Display
            if let did = profile.activeDID?.did {
                Button(action: {
                    #if canImport(UIKit)
                    UIPasteboard.general.string = did
                    #endif
                }) {
                    HStack(spacing: 6) {
                        Text(shortDid(did))
                            .font(.caption.monospaced())
                            .foregroundColor(.secondary)
                        
                        Image(systemName: "doc.on.doc")
                            .font(.caption2)
                            .foregroundColor(.secondary.opacity(0.7))
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Color(.secondarySystemBackground))
                    .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }
    
    private func didCapsule(title: String, subtitle: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(isActive ? .black : .secondary)
                
                Text(subtitle)
                    .font(.caption2)
                    .foregroundColor(isActive ? .black.opacity(0.8) : .secondary.opacity(0.6))
            }
            .frame(width: 120, height: 50)
            .background(isActive ? Color.white : Color.clear)
            .clipShape(Capsule())
            .shadow(color: isActive ? Color.black.opacity(0.1) : Color.clear, radius: 2, x: 0, y: 1)
        }
        .buttonStyle(.plain)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isActive)
    }
    
    private var isDidKeyActive: Bool {
        guard let did = profile.activeDID?.did else { return true }
        return did.hasPrefix("did:key")
    }
    
    private func switchDID(_ method: DIDService.DIDMethod) {
        coordinator.switchDID(method: method)
    }
    
    private func shortDid(_ did: String) -> String {
        guard did.count > 20 else { return did }
        let start = did.prefix(12)
        let end = did.suffix(6)
        return String(start) + "..." + String(end)
    }
    
    // MARK: - 2. The Core (Ripple Button)
    
    private var coreSection: some View {
        RippleButton(
            state: rippleState,
            commitment: profile.zkIdentity?.commitment,
            onTap: handleCoreTap,
            onLongPress: handleCoreLongPress
        )
        .frame(height: 320)
    }
    
    private func handleCoreTap() {
        if profile.zkIdentity == nil {
            createIdentity()
        } else {
            // Sync logic
            coordinator.refreshIdentity()
        }
    }
    
    private func handleCoreLongPress() {
        showingGroupManager = true
    }
    
    private func createIdentity() {
        isWorking = true
        Task { @MainActor in
            do {
                _ = try idm.loadOrCreateIdentity()
                coordinator.refreshIdentity()
                isWorking = false
                
                #if canImport(UIKit)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                #endif
            } catch {
                errorMessage = "Failed to create identity: \(error.localizedDescription)"
                showErrorAlert = true
                isWorking = false
            }
        }
    }
    
    // MARK: - 3. The Badge (Group List)
    
    private var badgeSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Groups")
                    .font(.headline)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 24)
                
                Spacer()
                
                Button(action: { showingGroupManager = true }) {
                    Image(systemName: "plus.circle.fill")
                        .font(.title2)
                        .foregroundColor(.accentColor)
                }
                .padding(.trailing, 24)
            }
            
            if profile.memberships.isEmpty {
                Text("No group memberships")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 20)
            } else {
                LazyVStack(spacing: 12) {
                    ForEach(Array(profile.memberships.enumerated()), id: \.element.id) { index, membership in
                        groupRow(membership: membership, index: index)
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }
    
    private func groupRow(membership: GroupMembership, index: Int) -> some View {
        Button(action: {
            selectedGroupIndex = index
            presentProof()
        }) {
            HStack(spacing: 16) {
                // Icon
                ZStack {
                    Circle()
                        .fill(Color.accentColor.opacity(0.1))
                        .frame(width: 44, height: 44)
                    
                    Image(systemName: "person.3.fill")
                        .foregroundColor(.accentColor)
                }
                
                // Info
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(membership.name)
                            .font(.body.weight(.medium))
                            .foregroundColor(.primary)
                        
                        Text("Local")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.secondary.opacity(0.8))
                            .clipShape(Capsule())
                    }
                    
                    if let memberIndex = membership.memberIndex {
                        Text("Member #\(memberIndex + 1)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    } else {
                        Text("Not a member")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
                
                Spacer()
                
                // Status
                statusIcon(for: membership.status)
                
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(Color(uiColor: .tertiaryLabel))
            }
            .padding(12)
            .background(Color(.secondarySystemGroupedBackground))
            .cornerRadius(12)
        }
        .buttonStyle(.plain)
    }
    
    private func statusIcon(for status: GroupMembership.MembershipStatus) -> some View {
        switch status {
        case .active:
            return Image(systemName: "checkmark.circle.fill").foregroundColor(.green)
        case .outdated:
            return Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.yellow)
        case .pending:
            return Image(systemName: "clock.fill").foregroundColor(.gray)
        case .notMember:
            return Image(systemName: "circle").foregroundColor(.gray)
        }
    }
    
    private var addButton: some View {
        EmptyView() // Removed in favor of header button
    }
    
    private func presentProof() {
        guard selectedGroupIndex < profile.memberships.count else { return }
        _ = profile.memberships[selectedGroupIndex]
        
        // Logic to present proof for this group
        // For now, just show the OIDC request sheet
        showingOIDCRequest = true
    }
}

// MARK: - OIDC Request View (Unchanged)

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
                        
                        if qrString != nil {
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

// MARK: - ZK Settings View (Unchanged)

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
