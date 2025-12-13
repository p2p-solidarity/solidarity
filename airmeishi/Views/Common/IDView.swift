//
//  IDView.swift
//  airmeishi
//
//  Unified identity and group management with ripple animation, OpenID, and ZK settings
//

import SwiftUI

struct IDView: View {
    @ObservedObject private var coordinator = IdentityCoordinator.shared
    @StateObject private var groupManager = CloudKitGroupSyncManager.shared
    @StateObject private var idm = SemaphoreIdentityManager.shared

    // UI State
    @State private var showingGroupManager = false
    @State private var showingOIDCRequest = false
    @State private var showingZKSettings = false
    @State private var selectedGroup: GroupModel?
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
        return .idle
    }
    
    var body: some View {
        NavigationStack {
            ZStack {
                // Background
                Color(.systemGroupedBackground)
                    .ignoresSafeArea()
                
                ScrollView {
                    VStack(spacing: 0) {
                        // 1. The Mask (DID Switcher)
                        maskSection
                            .padding(.top, 20)
                            .padding(.bottom, 40)
                        
                        // 2. The Core (Ripple Button)
                        coreSection
                        
                        Spacer()
                            .frame(height: 40)
                        
                        // 3. The Badge (Group Cards)
                        badgeSection
                            .padding(.bottom, 20)
                    }
                }
            }
            .navigationTitle("ID")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack {
                        Button(action: {
                            showingOIDCRequest = true
                        }, label: {
                            Image(systemName: "qrcode")
                                .foregroundColor(.primary)
                        })
                        
                        Button(action: {
                            coordinator.refreshIdentity()
                        }, label: {
                            Image(systemName: "arrow.clockwise")
                                .foregroundColor(.primary)
                        })
                    }
                }
                
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: {
                        showingZKSettings = true
                    }, label: {
                        Image(systemName: "gearshape")
                            .foregroundColor(.primary)
                    })
                }
            }
            .alert("Error", isPresented: $showErrorAlert, actions: {
                Button("OK", role: .cancel) {}
            }, message: {
                Text(errorMessage ?? "Unknown error")
            })
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
            .onAppear {
                groupManager.startSyncEngine()
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
            
            if groupManager.groups.isEmpty {
                Text("No group memberships")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 20)
            } else {
                LazyVStack(spacing: 12) {
                    ForEach(groupManager.groups) { group in
                        groupRow(group: group)
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }
    
    private func groupRow(group: GroupModel) -> some View {
        Button(action: {
            selectedGroup = group
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
                        Text(group.name)
                            .font(.body.weight(.medium))
                            .foregroundColor(.primary)
                        
                        Text("CloudKit")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.blue.opacity(0.8))
                            .clipShape(Capsule())
                    }
                    
                    Text("\(group.memberCount) members")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                Spacer()
                
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
    
    private var addButton: some View {
        EmptyView() // Removed in favor of header button
    }
    
    private func presentProof() {
        guard let _ = selectedGroup else { return }
        
        // Logic to present proof for this group
        // For now, just show the OIDC request sheet
        showingOIDCRequest = true
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
            .alert("Delete Identity?", isPresented: $showingDeleteConfirm, actions: {
                Button("Delete", role: .destructive) {
                    // TODO: Implement identity deletion
                }
                Button("Cancel", role: .cancel) {}
            }, message: {
                Text("This will permanently delete your ZK identity. This action cannot be undone.")
            })
        }
    }
}

#Preview {
    IDView()
}
