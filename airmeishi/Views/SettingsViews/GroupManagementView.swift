//
//  GroupManagementView.swift
//  airmeishi
//
//  Manage group membership: view root, add/remove members, join via code/url.
//

import SwiftUI
import UIKit
import MultipeerConnectivity

struct GroupManagementView: View {
    @StateObject private var group = SemaphoreGroupManager.shared
    @StateObject private var proximity = ProximityManager.shared
    @State private var newMemberCommitment: String = ""
    @State private var isAddingMember: Bool = false
    @State private var addMemberErrorMessage: String? = nil
    @State private var showAddMemberError: Bool = false
    @State private var joinCode: String = ""
    @State private var ensName: String = ""
    @State private var ensResolvedAddress: String? = nil
    @State private var isResolvingENS: Bool = false
    @State private var isFetchingRoot: Bool = false
    @State private var activeSheet: SheetType? = nil
    @State private var showDeleteConfirm: Bool = false
    @State private var isAnimating: Bool = false
    @Environment(\.dismiss) private var dismiss

    private enum SheetType: String, Identifiable {
        case root, add, revoke, ens, privacy, terms
        var id: String { rawValue }
    }

    var body: some View {
        ZStack {
            // Simple gradient background
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.05, blue: 0.08),
                    Color(red: 0.08, green: 0.08, blue: 0.12)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                // Header Section
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 16) {
                        // Simple icon
                        ZStack {
                            RoundedRectangle(cornerRadius: 16)
                                .fill(Color.white.opacity(0.1))
                                .frame(width: 50, height: 50)

                            Image(systemName: "person.3.sequence.fill")
                                .font(.system(size: 24))
                                .foregroundColor(.white)
                        }

                        VStack(alignment: .leading, spacing: 6) {
                            Text("Group Management")
                                .font(.system(size: 28, weight: .bold))
                                .foregroundColor(.white)

                            Text("Manage your groups and members")
                                .font(.subheadline)
                                .foregroundColor(.white.opacity(0.6))
                        }

                        Spacer()
                    }
                    .padding(20)
                }
                .background(
                    RoundedRectangle(cornerRadius: 20)
                        .fill(Color.white.opacity(0.08))
                        .overlay(
                            RoundedRectangle(cornerRadius: 20)
                                .stroke(Color.white.opacity(0.15), lineWidth: 1)
                        )
                )
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 24)

                // Main Actions Section with enhanced cards
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        // Group Actions
                        VStack(alignment: .leading, spacing: 16) {
                            Text("Group Actions")
                                .font(.title3)
                                .fontWeight(.bold)
                                .foregroundColor(.white)
                                .padding(.horizontal, 20)
                                .padding(.top, 8)

                            VStack(spacing: 1) {
                                SimpleNodeRow(icon: "checkmark.seal", title: "View Root", subtitle: "Manage group root and identity") { activeSheet = .root }
                                SimpleNodeRow(icon: "person.badge.plus", title: "Add Member", subtitle: "Add new members to your group") { activeSheet = .add }
                                SimpleNodeRow(icon: "person.badge.minus", title: "Remove Member", subtitle: "Revoke member access") { activeSheet = .revoke }
                                SimpleNodeRow(icon: "sparkles", title: "ENS Mode", subtitle: "Upgrade or bind to ENS") { activeSheet = .ens }
                                SimpleDangerNodeRow(icon: "trash", title: "Delete Group", subtitle: "Remove group and its card") { showDeleteConfirm = true }
                            }
                        }
                        .padding(4)
                        .background(
                            RoundedRectangle(cornerRadius: 16)
                                .fill(Color.white.opacity(0.06))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 16)
                                        .stroke(Color.white.opacity(0.12), lineWidth: 1)
                                )
                        )
                        .padding(.horizontal, 20)

                        // Premium Features
                        VStack(alignment: .leading, spacing: 16) {
                            HStack {
                                Text("Premium Features")
                                    .font(.title3)
                                    .fontWeight(.bold)
                                    .foregroundColor(.white)

                                Spacer()

                                Image(systemName: "crown.fill")
                                    .foregroundColor(.white.opacity(0.5))
                                    .font(.title3)
                            }
                            .padding(.horizontal, 20)
                            .padding(.top, 8)

                            SimplePremiumFeatureRow(
                                icon: "plus.circle.fill",
                                title: "Create Group with ENS",
                                subtitle: "Create groups with custom ENS domains",
                                price: "$5",
                                isEnabled: false
                            )
                        }
                        .padding(4)
                        .background(
                            RoundedRectangle(cornerRadius: 16)
                                .fill(Color.white.opacity(0.08))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 16)
                                        .stroke(Color.white.opacity(0.15), lineWidth: 1)
                                )
                        )
                        .padding(.horizontal, 20)

                        // Legal & Privacy
                        VStack(alignment: .leading, spacing: 16) {
                            Text("Legal & Privacy")
                                .font(.title3)
                                .fontWeight(.bold)
                                .foregroundColor(.white)
                                .padding(.horizontal, 20)
                                .padding(.top, 8)

                            VStack(spacing: 1) {
                                SimpleNodeRow(icon: "hand.raised", title: "Privacy Policy", subtitle: "View our privacy policy") { activeSheet = .privacy }
                                SimpleNodeRow(icon: "doc.text", title: "Terms of Service", subtitle: "View terms of service") { activeSheet = .terms }
                            }
                        }
                        .padding(4)
                        .background(
                            RoundedRectangle(cornerRadius: 16)
                                .fill(Color.white.opacity(0.06))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 16)
                                        .stroke(Color.white.opacity(0.12), lineWidth: 1)
                                )
                        )
                        .padding(.horizontal, 20)
                        .padding(.bottom, 40)
                    }
                }
            }
            .safeAreaInset(edge: .top) {
                HStack {
                    Button(action: { dismiss() }) {
                        HStack(spacing: 8) {
                            Image(systemName: "xmark.circle.fill")
                            Text("Done")
                                .fontWeight(.semibold)
                        }
                        .foregroundColor(.white)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 12)
                        .background(
                            Capsule()
                                .fill(Color.white.opacity(0.15))
                                .background(
                                    Capsule()
                                        .stroke(Color.white.opacity(0.3), lineWidth: 1)
                                )
                        )
                    }
                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
            }
        }
        .navigationBarHidden(true)
        .onAppear {
            isAnimating = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .groupInviteReceived)) { _ in
            // A separate global UI can present ConnectGroupInvitePopupView when needed
        }
        .onReceive(NotificationCenter.default.publisher(for: .groupMembershipUpdated)) { _ in
            // Refresh published state to reflect latest membership/root
            group.load()
        }
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .root:
                RootSheet
            case .add:
                AddMemberSheet
            case .revoke:
                RevokeMemberSheet
            case .ens:
                ENSSheet
            case .privacy:
                PrivacySheet
            case .terms:
                TermsSheet
            }
        }
        .alert("Add Member Failed", isPresented: $showAddMemberError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(addMemberErrorMessage ?? "Unknown error")
        }
        .alert("Delete Group?", isPresented: $showDeleteConfirm) {
            Button("Delete", role: .destructive) {
                group.deleteSelectedGroup()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will remove the group and its associated card. This action cannot be undone.")
        }
    }

    // MARK: - Helpers

    private func resolveENS() {
        // Old ENS service removed; no-op in this build
        ensResolvedAddress = nil
    }

    private func fetchRootViaENS() {
        // Old API removed; rely on local root or other sync
        isFetchingRoot = false
    }

    private func copyRoot() {
        if let root = group.merkleRoot { UIPasteboard.general.string = root }
    }

    // Invite URL and QR generation removed in favor of ENS Mode

    private func addMemberAction() {
        let commitment = newMemberCommitment.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !commitment.isEmpty else { return }
        guard group.selectedGroupId != nil else { return }
        isAddingMember = true
        group.addMember(commitment)
        isAddingMember = false
        newMemberCommitment = ""
    }

    // No randomEthAddress here; add member must reuse owner's address from creation

    // MARK: - Sheets

    private var RootSheet: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Group Root Management")
                            .font(.largeTitle)
                            .fontWeight(.bold)
                        Text("View and manage your group's merkle root and identity")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    
                    // Group Selection
                if !group.allGroups.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Select Group")
                                .font(.headline)
                                .fontWeight(.semibold)
                                .padding(.horizontal, 20)
                            
                            VStack(spacing: 8) {
                        ForEach(group.allGroups) { g in
                                    Button(action: { group.selectGroup(g.id) }) {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                                Text(g.name)
                                                    .font(.headline)
                                                    .foregroundColor(.primary)
                                                Text(g.root ?? "No root available")
                                                    .font(.caption)
                                                    .foregroundColor(.secondary)
                                                    .lineLimit(1)
                                }
                                Spacer()
                                if group.selectedGroupId == g.id {
                                                Image(systemName: "checkmark.circle.fill")
                                                    .foregroundColor(.accentColor)
                                                    .font(.title2)
                                            } else {
                                                Image(systemName: "circle")
                                                    .foregroundColor(.secondary)
                                                    .font(.title2)
                                            }
                                        }
                                        .padding(.horizontal, 20)
                                        .padding(.vertical, 16)
                                        .background(
                                            RoundedRectangle(cornerRadius: 12)
                                                .fill(group.selectedGroupId == g.id ? Color.accentColor.opacity(0.1) : Color(.systemGray6))
                                        )
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 20)
                        }
                    }
                    
                    // Merkle Root Section
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Merkle Root")
                            .font(.headline)
                            .fontWeight(.semibold)
                            .padding(.horizontal, 20)
                        
                        VStack(spacing: 16) {
                            // Root Display
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Current Root")
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                    .foregroundColor(.secondary)
                                
                                Text(group.merkleRoot ?? "No root available")
                                    .font(.system(.body, design: .monospaced))
                                    .textSelection(.enabled)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 12)
                                    .background(
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(Color(.systemGray6))
                                    )
                            }
                            .padding(.horizontal, 20)
                            
                            // Action Buttons
                            HStack(spacing: 12) {
                                Button(action: { group.recomputeRoot() }) {
                                    HStack {
                                        Image(systemName: "arrow.clockwise")
                                        Text("Recompute")
                                    }
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                                    .background(
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(Color.blue)
                                    )
                                    .foregroundColor(.white)
                                }
                                
                                Button(action: { copyRoot() }) {
                                    HStack {
                                        Image(systemName: "doc.on.doc")
                                        Text("Copy")
                                    }
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                                    .background(
                                        RoundedRectangle(cornerRadius: 8)
                                            .stroke(Color.accentColor, lineWidth: 1)
                                    )
                                    .foregroundColor(.accentColor)
                                }
                                .disabled(group.merkleRoot == nil)
                            }
                            .padding(.horizontal, 20)
                            
                            // Sync Button
                    HStack {
                                if isFetchingRoot { 
                                    ProgressView()
                                        .controlSize(.small)
                                }
                                Button(action: { group.syncRootFromNetwork { _ in } }) {
                    HStack {
                                        Image(systemName: "icloud.and.arrow.down")
                                        Text("Sync from Network")
                                    }
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                                    .background(
                                        RoundedRectangle(cornerRadius: 8)
                                            .stroke(Color(.systemGray3), lineWidth: 1)
                                    )
                                    .foregroundColor(.primary)
                                }
                                .disabled(isFetchingRoot)
                            }
                            .padding(.horizontal, 20)
                        }
                        .background(
                            RoundedRectangle(cornerRadius: 16)
                                .fill(Color(.systemBackground))
                                .shadow(color: .black.opacity(0.05), radius: 8, x: 0, y: 2)
                                .padding(.horizontal, 20)
                        )
                    }
                    
                    // ENS Section
                    VStack(alignment: .leading, spacing: 12) {
                        Text("ENS Integration")
                            .font(.headline)
                            .fontWeight(.semibold)
                            .padding(.horizontal, 20)
                        
                        VStack(spacing: 16) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("ENS Name")
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                    .foregroundColor(.secondary)
                                
                    HStack {
                        TextField("mygroup.eth", text: $ensName)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                                        .padding(.horizontal, 16)
                                        .padding(.vertical, 12)
                                        .background(
                                            RoundedRectangle(cornerRadius: 8)
                                                .fill(Color(.systemGray6))
                                        )
                                    
                                    Button(action: { resolveENS() }) {
                                        if isResolvingENS {
                                            ProgressView()
                                                .controlSize(.small)
                                        } else {
                                            Text("Resolve")
                                                .font(.subheadline)
                                                .fontWeight(.medium)
                                        }
                                    }
                            .disabled(ensName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isResolvingENS)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 12)
                                    .background(
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(Color.blue)
                                    )
                                    .foregroundColor(.white)
                                }
                            }
                            .padding(.horizontal, 20)
                            
                    if let addr = ensResolvedAddress, !addr.isEmpty {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("Resolved Address")
                                        .font(.subheadline)
                                        .fontWeight(.medium)
                                        .foregroundColor(.secondary)
                                    
                                    Text(addr)
                                        .font(.system(.body, design: .monospaced))
                                        .textSelection(.enabled)
                                        .padding(.horizontal, 16)
                                        .padding(.vertical, 12)
                                        .background(
                                            RoundedRectangle(cornerRadius: 8)
                                                .fill(Color(.systemGray6))
                                        )
                                }
                                .padding(.horizontal, 20)
                            }
                            
                            HStack {
                                if isFetchingRoot { 
                                    ProgressView()
                                        .controlSize(.small)
                                }
                                Button(action: { fetchRootViaENS() }) {
                    HStack {
                                        Image(systemName: "arrow.down.circle")
                                        Text("Fetch Root via ENS")
                                    }
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                                    .background(
                                        RoundedRectangle(cornerRadius: 8)
                                            .stroke(Color(.systemGray3), lineWidth: 1)
                                    )
                                    .foregroundColor(.primary)
                                }
                            .disabled(ensName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isFetchingRoot)
                            }
                            .padding(.horizontal, 20)
                        }
                        .background(
                            RoundedRectangle(cornerRadius: 16)
                                .fill(Color(.systemBackground))
                                .shadow(color: .black.opacity(0.05), radius: 8, x: 0, y: 2)
                                .padding(.horizontal, 20)
                        )
                    }
                    
                    // Identity Section
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Your Identity")
                            .font(.headline)
                            .fontWeight(.semibold)
                            .padding(.horizontal, 20)
                        
                        VStack(spacing: 16) {
                            let bundle = SemaphoreIdentityManager.shared.getIdentity()
                            
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Commitment")
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                    .foregroundColor(.secondary)
                                
                                Text(bundle?.commitment ?? "No identity available")
                                    .font(.system(.body, design: .monospaced))
                                    .textSelection(.enabled)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 12)
                                    .background(
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(Color(.systemGray6))
                                    )
                            }
                            .padding(.horizontal, 20)
                            
                    if let c = bundle?.commitment, let idx = group.indexOf(c) {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("Group Index")
                                        .font(.subheadline)
                                        .fontWeight(.medium)
                                        .foregroundColor(.secondary)
                                    
                                    Text("#\(idx)")
                                        .font(.title2)
                                        .fontWeight(.semibold)
                                        .foregroundColor(.accentColor)
                                }
                                .padding(.horizontal, 20)
                    } else {
                                HStack {
                                    Image(systemName: "exclamationmark.triangle")
                                        .foregroundColor(.orange)
                                    Text("Not a member of this group yet")
                                        .foregroundColor(.secondary)
                                }
                                .padding(.horizontal, 20)
                            }
                        }
                        .background(
                            RoundedRectangle(cornerRadius: 16)
                                .fill(Color(.systemBackground))
                                .shadow(color: .black.opacity(0.05), radius: 8, x: 0, y: 2)
                                .padding(.horizontal, 20)
                        )
                    }
                    
                    Spacer(minLength: 40)
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Root Management")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { 
                ToolbarItem(placement: .navigationBarTrailing) { 
                    Button("Done") { activeSheet = nil } 
                } 
            }
        }
    }

    private var AddMemberSheet: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Add Group Member")
                            .font(.largeTitle)
                            .fontWeight(.bold)
                        Text("Add new members to your group using various methods")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    
                    // Manual Entry Section
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Manual Entry")
                            .font(.headline)
                            .fontWeight(.semibold)
                            .padding(.horizontal, 20)
                        
                        VStack(spacing: 16) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Member Commitment")
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                    .foregroundColor(.secondary)
                                
                                TextField("Enter member commitment", text: $newMemberCommitment)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 12)
                                    .background(
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(Color(.systemGray6))
                                    )
                            }
                            .padding(.horizontal, 20)
                            
                            Button(action: { addMemberAction() }) {
                                HStack {
                                    if isAddingMember {
                                        ProgressView()
                                            .controlSize(.small)
                                            .tint(.white)
                                    } else {
                                        Image(systemName: "person.badge.plus")
                                    }
                                    Text(isAddingMember ? "Adding..." : "Add to Group")
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(
                                    RoundedRectangle(cornerRadius: 8)
                                        .fill(Color.blue)
                                )
                                .foregroundColor(.white)
                            }
                            .disabled(isAddingMember || newMemberCommitment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            .padding(.horizontal, 20)
                        }
                        .background(
                            RoundedRectangle(cornerRadius: 16)
                                .fill(Color(.systemBackground))
                                .shadow(color: .black.opacity(0.05), radius: 8, x: 0, y: 2)
                                .padding(.horizontal, 20)
                        )
                    }
                    
                    // Nearby Discovery Section
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Nearby Discovery")
                            .font(.headline)
                            .fontWeight(.semibold)
                            .padding(.horizontal, 20)
                        
                        VStack(spacing: 16) {
                            // Scan Toggle
                    HStack {
                                HStack(spacing: 12) {
                                    ZStack {
                                        RoundedRectangle(cornerRadius: 10)
                                            .fill(proximity.isBrowsing ? Color.accentColor.opacity(0.1) : Color(.systemGray5))
                                            .frame(width: 40, height: 40)
                                        Image(systemName: proximity.isBrowsing ? "dot.radiowaves.right" : "dot.radiowaves.left.and.right")
                                            .foregroundColor(proximity.isBrowsing ? .accentColor : .secondary)
                                            .font(.system(size: 18, weight: .medium))
                                    }
                                    
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(proximity.isBrowsing ? "Scanning Nearby" : "Scan for Nearby Devices")
                                            .font(.subheadline)
                                            .fontWeight(.medium)
                                            .foregroundColor(.primary)
                                        Text(proximity.isBrowsing ? "Looking for nearby devices" : "Tap to start scanning")
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                }
                                
                        Spacer()
                                
                                Button(action: {
                            if proximity.isBrowsing {
                                proximity.stopBrowsing()
                            } else {
                                proximity.startBrowsing()
                            }
                                }) {
                                    Text(proximity.isBrowsing ? "Stop" : "Start")
                                        .font(.subheadline)
                                        .fontWeight(.medium)
                                        .padding(.horizontal, 16)
                                        .padding(.vertical, 8)
                                        .background(
                                            RoundedRectangle(cornerRadius: 6)
                                                .fill(proximity.isBrowsing ? Color.red : Color.blue)
                                        )
                                        .foregroundColor(.white)
                                }
                            }
                            .padding(.horizontal, 20)
                            
                            // Nearby Peers
                            if group.allGroups.isEmpty {
                                HStack {
                                    Image(systemName: "exclamationmark.triangle")
                                        .foregroundColor(.orange)
                                    Text("Create a group first to invite members")
                                        .foregroundColor(.secondary)
                                }
                                .padding(.horizontal, 20)
                    } else if let gid = group.selectedGroupId, let g = group.allGroups.first(where: { $0.id == gid }) {
                                VStack(alignment: .leading, spacing: 12) {
                        HStack {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text("Group: \(g.name)")
                                                .font(.subheadline)
                                                .fontWeight(.medium)
                                            Text("\(proximity.nearbyPeers.count) nearby peers")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                        }
                            Spacer()
                        }
                                    .padding(.horizontal, 20)
                                    
                        if proximity.nearbyPeers.isEmpty {
                                        VStack(spacing: 8) {
                                            Image(systemName: "wifi.slash")
                                                .font(.largeTitle)
                                                .foregroundColor(.secondary)
                                            Text("No nearby peers found")
                                                .font(.subheadline)
                                                .foregroundColor(.secondary)
                                            Text("Make sure other devices have the app open and are in Matching mode")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                                .multilineTextAlignment(.center)
                                        }
                                        .padding(.horizontal, 20)
                                        .padding(.vertical, 20)
                                        .background(
                                            RoundedRectangle(cornerRadius: 12)
                                                .fill(Color(.systemGray6))
                                                .padding(.horizontal, 20)
                                        )
                        } else {
                                        VStack(spacing: 8) {
                            ForEach(proximity.nearbyPeers) { peer in
                                HStack {
                                                    ZStack {
                                                        RoundedRectangle(cornerRadius: 8)
                                                            .fill(Color.accentColor.opacity(0.1))
                                                            .frame(width: 36, height: 36)
                                                        Image(systemName: "person.circle")
                                                            .foregroundColor(.accentColor)
                                                            .font(.system(size: 18))
                                                    }
                                                    
                                    VStack(alignment: .leading, spacing: 2) {
                                                        Text(peer.cardName ?? peer.name)
                                                            .font(.subheadline)
                                                            .fontWeight(.medium)
                                                        if let title = peer.cardTitle {
                                                            Text(title)
                                                                .font(.caption)
                                                                .foregroundColor(.secondary)
                                                        }
                                                    }
                                                    
                                    Spacer()
                                                    
                                                    Button(action: {
                                        let inviter = (try? CardManager.shared.getAllCards().get().first?.name) ?? CardManager.shared.businessCards.first?.name ?? UIDevice.current.name
                                        proximity.invitePeerToGroup(peer, group: g, inviterName: inviter)
                                                    }) {
                                        Image(systemName: "paperplane.fill")
                                                            .font(.system(size: 16, weight: .medium))
                                                            .foregroundColor(.white)
                                                            .padding(8)
                                                            .background(
                                                                Circle()
                                                                    .fill(Color.blue)
                                                            )
                                                    }
                                                }
                                                .padding(.horizontal, 20)
                                                .padding(.vertical, 12)
                                                .background(
                                                    RoundedRectangle(cornerRadius: 8)
                                                        .fill(Color(.systemGray6))
                                                        .padding(.horizontal, 20)
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        .background(
                            RoundedRectangle(cornerRadius: 16)
                                .fill(Color(.systemBackground))
                                .shadow(color: .black.opacity(0.05), radius: 8, x: 0, y: 2)
                                .padding(.horizontal, 20)
                        )
                    }
                    
                    Spacer(minLength: 40)
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Add Member")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { 
                ToolbarItem(placement: .navigationBarTrailing) { 
                    Button("Done") { activeSheet = nil } 
                } 
            }
            .onAppear {
                if !proximity.isBrowsing { proximity.startBrowsing() }
            }
            .onDisappear {
                if proximity.isBrowsing { proximity.stopBrowsing() }
            }
        }
    }

    private var RevokeMemberSheet: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Remove Group Member")
                            .font(.largeTitle)
                            .fontWeight(.bold)
                        Text("Revoke access for group members")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    
                    // Members Section
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Group Members")
                                .font(.headline)
                                .fontWeight(.semibold)
                            Spacer()
                            Text("\(group.members.count)")
                                .font(.headline)
                                .fontWeight(.semibold)
                                .foregroundColor(.accentColor)
                        }
                        .padding(.horizontal, 20)
                        
                    if group.members.isEmpty {
                            VStack(spacing: 12) {
                                Image(systemName: "person.3")
                                    .font(.largeTitle)
                                    .foregroundColor(.secondary)
                                Text("No members yet")
                                    .font(.headline)
                                    .foregroundColor(.secondary)
                                Text("Add members to your group first")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            .padding(.vertical, 40)
                            .frame(maxWidth: .infinity)
                            .background(
                                RoundedRectangle(cornerRadius: 16)
                                    .fill(Color(.systemBackground))
                                    .shadow(color: .black.opacity(0.05), radius: 8, x: 0, y: 2)
                                    .padding(.horizontal, 20)
                            )
                    } else {
                            VStack(spacing: 8) {
                                ForEach(group.members, id: \.self) { member in
                            HStack {
                                        ZStack {
                                            RoundedRectangle(cornerRadius: 8)
                                                .fill(Color.red.opacity(0.1))
                                                .frame(width: 36, height: 36)
                                            Image(systemName: "person.circle")
                                                .foregroundColor(.red)
                                                .font(.system(size: 18))
                                        }
                                        
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text("Member")
                                                .font(.subheadline)
                                                .fontWeight(.medium)
                                            Text(member)
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                                .lineLimit(1)
                                        }
                                        
                                Spacer()
                                        
                                        Button(action: { group.removeMember(member) }) {
                                            Image(systemName: "trash")
                                                .font(.system(size: 16, weight: .medium))
                                                .foregroundColor(.white)
                                                .padding(8)
                                                .background(
                                                    Circle()
                                                        .fill(Color.red)
                                                )
                                        }
                                    }
                                    .padding(.horizontal, 20)
                                    .padding(.vertical, 12)
                                    .background(
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(Color(.systemGray6))
                                            .padding(.horizontal, 20)
                                    )
                                }
                            }
                            .background(
                                RoundedRectangle(cornerRadius: 16)
                                    .fill(Color(.systemBackground))
                                    .shadow(color: .black.opacity(0.05), radius: 8, x: 0, y: 2)
                                    .padding(.horizontal, 20)
                            )
                        }
                    }
                    
                    Spacer(minLength: 40)
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Remove Member")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { 
                ToolbarItem(placement: .navigationBarTrailing) { 
                    Button("Done") { activeSheet = nil } 
                } 
            }
        }
    }

    private var ENSSheet: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    VStack(alignment: .leading, spacing: 8) {
                        Text("ENS Mode")
                            .font(.largeTitle)
                            .fontWeight(.bold)
                        Text("Upgrade or bind your group to ENS")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)

                    // Upgrade Section
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Upgrade")
                            .font(.headline)
                            .fontWeight(.semibold)
                            .padding(.horizontal, 20)

                        VStack(spacing: 12) {
                            SimplePremiumFeatureRow(
                                icon: "sparkles",
                                title: "Upgrade to ENS Mode",
                                subtitle: "Advanced features backed by ENS",
                                price: "$5",
                                isEnabled: false
                            )
                        }
                        .padding(.horizontal, 20)
                    }

                    // Bind Section
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Bind to ENS")
                            .font(.headline)
                            .fontWeight(.semibold)
                            .padding(.horizontal, 20)

                        VStack(spacing: 16) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("ENS Name")
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                    .foregroundColor(.secondary)

                                TextField("mygroup.eth", text: $ensName)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 12)
                                    .background(
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(Color(.systemGray6))
                                    )
                            }
                            .padding(.horizontal, 20)

                            Button(action: { /* TODO: bind to ENS when backend ready */ }) {
                                HStack {
                                    Image(systemName: "link")
                                    Text("Bind")
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(
                                    RoundedRectangle(cornerRadius: 8)
                                        .fill(Color.blue)
                                )
                                .foregroundColor(.white)
                            }
                            .disabled(ensName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            .padding(.horizontal, 20)

                            Text("Binding requires network support and will be available soon.")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .padding(.horizontal, 20)
                        }
                        .background(
                            RoundedRectangle(cornerRadius: 16)
                                .fill(Color(.systemBackground))
                                .shadow(color: .black.opacity(0.05), radius: 8, x: 0, y: 2)
                                .padding(.horizontal, 20)
                        )
                    }

                    Spacer(minLength: 40)
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("ENS Mode")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { activeSheet = nil }
                }
            }
        }
    }

    private var PrivacySheet: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text(privacyPolicyText)
                        .font(.body)
                        .foregroundColor(.primary)
                        .padding(.horizontal, 20)
                        .padding(.top, 20)

                    Spacer(minLength: 40)
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Privacy Policy")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { activeSheet = nil }
                }
            }
        }
    }

    private var TermsSheet: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text(termsOfServiceText)
                        .font(.body)
                        .foregroundColor(.primary)
                        .padding(.horizontal, 20)
                        .padding(.top, 20)

                    Spacer(minLength: 40)
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Terms of Service")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { activeSheet = nil }
                }
            }
        }
    }

    private var privacyPolicyText: String {
        """
        Privacy Policy for Solid(ar)ity

        Last Updated: 2025-01-15

        CORE PRINCIPLE
        Your data belongs to you. Everything stays on your device. We operate with zero servers and zero data collection.

        ZERO DATA COLLECTION
        We do NOT collect:
        • Personal information
        • Usage analytics or tracking data
        • Device identifiers
        • Contact lists
        • Location data

        LOCAL DATA STORAGE
        All data is stored encrypted on YOUR device:
        • Business cards (AES-GCM encryption)
        • Received contacts (encrypted local storage)
        • ZK identity keys (iOS Keychain, hardware-backed)
        • Group memberships (local encrypted files)

        ZERO-KNOWLEDGE PROOFS
        Advanced privacy technology:

        What is ZK?
        Cryptographic proofs that verify claims without revealing your identity.

        Example: Prove "I'm a conference attendee" without disclosing which attendee.

        How it works:
        1. Identity Generation: Created locally on your device
        2. Group Membership: Join groups (e.g., "Company Employees")
        3. Privacy-Preserving Proofs: Verify membership without exposing identity

        Technology Stack:
        • Semaphore Protocol: Industry-standard ZK protocol
        • Mopro Framework: Mobile ZK proof generation
        • iOS Keychain: Hardware-backed key storage

        Privacy Guarantees:
        • Anonymity: Identity within groups is protected
        • Unlinkability: Proofs cannot be linked to you
        • Local Computation: All proofs generated on-device
        • No Server Dependency: Works completely offline

        PEER-TO-PEER SHARING
        Direct device-to-device sharing:
        • MultipeerConnectivity: Local WiFi/Bluetooth only
        • QR Codes: Data encoded locally
        • AirDrop: Standard iOS sharing
        • Apple Wallet: PassKit integration (data stays local)

        SELECTIVE DISCLOSURE
        Control what you share:
        • Public: Minimal info (name, title)
        • Professional: Work-related info
        • Personal: Full contact details

        WHAT WE DON'T USE
        ❌ No analytics services
        ❌ No advertising networks
        ❌ No tracking SDKs
        ❌ No cloud databases
        ❌ No authentication providers
        ❌ No crash reporting services

        CRYPTOGRAPHY COMPLIANCE
        Encryption used for privacy and security ONLY:
        • Local data protection (AES-GCM)
        • P2P communication security (Apple frameworks)
        • ZK proof generation (Semaphore protocol)
        • NOT used for financial transactions
        • NOT cryptocurrency-related

        YOUR RIGHTS
        • Access all your data anytime
        • Edit or delete information
        • Export your data
        • Full control over sharing

        OPEN SOURCE
        Verify our privacy claims:
        https://github.com/kidneyweakx/solidarity

        CONTACT
        Questions? Create an issue:
        https://github.com/kidneyweakx/solidarity/issues

        Bottom Line: Your data stays on your device. Period.
        """
    }

    private var termsOfServiceText: String {
        """
        Terms of Service for Solid(ar)ity

        Last Updated: 2025-01-15

        1. ACCEPTANCE OF TERMS
        By using Solid(ar)ity, you agree to these Terms. If you don't agree, please don't use the App.

        2. WHAT IS SOLID(AR)ITY?
        A privacy-first business card sharing app that:
        • Operates completely offline (no servers)
        • Stores all data locally on your device
        • Uses Zero-Knowledge proofs for privacy
        • Enables P2P contact sharing
        • Requires no account or registration

        3. YOUR RESPONSIBILITIES
        You agree to:
        • Provide accurate information in your business cards
        • Use the App lawfully and respectfully
        • Not spam, harass, or harm others
        • Maintain your device's security
        • Not reverse engineer the App
        • Not share others' info without permission

        4. PRIVACY & DATA
        • All data stored locally on YOUR device
        • YOU control what information to share
        • Zero-Knowledge proofs generated on-device
        • No data collection or tracking
        • See Privacy Policy for full details

        5. ZERO-KNOWLEDGE PROOFS
        What they are:
        • Cryptographic privacy technology
        • Prove claims without revealing identity
        • Example: "I'm a group member" (without saying which one)

        Technology:
        • Semaphore Protocol (industry-standard)
        • Mopro Framework (mobile ZK generation)
        • All computation happens on YOUR device

        Important:
        • ZK proofs enhance privacy, not absolute security
        • You're responsible for managing your ZK identity keys
        • We're not liable for key loss or misuse
        • NOT used for cryptocurrency or financial transactions

        6. CRYPTOGRAPHY USAGE
        Encryption is used for:
        • Local data protection (AES-GCM)
        • P2P communication security
        • Privacy-preserving proofs

        NOT used for:
        • Financial transactions
        • Cryptocurrency trading
        • Blockchain operations
        • Money transfers

        Export Compliance:
        • Encryption for authentication/privacy only
        • Compliant with iOS App Store guidelines

        7. APPLE SERVICES
        The App uses Apple's native frameworks:
        • MultipeerConnectivity (P2P networking)
        • PassKit (Apple Wallet)
        • Keychain (key storage)

        These follow Apple's terms and conditions.

        8. OPEN-SOURCE LIBRARIES
        • SemaphoreSwift: ZK proof generation
        • Mopro: Mobile ZK optimization

        These run ON YOUR DEVICE and don't transmit data.

        9. NO THIRD-PARTY SERVICES
        We do NOT use:
        • Analytics or tracking services
        • Advertising networks
        • Cloud databases
        • Authentication providers

        10. DISCLAIMERS
        The App is provided "AS IS":
        • No warranties or guarantees
        • No guarantee of error-free operation
        • Works offline, but P2P requires network permissions

        11. LIMITATION OF LIABILITY
        We're NOT liable for:
        • Data loss
        • Security breaches from device compromise
        • ZK identity key loss
        • Misuse by users
        • Third-party actions

        Maximum liability: $10 USD or amount paid (if any).

        12. INTELLECTUAL PROPERTY
        • App licensed under Apache License 2.0
        • YOU own your business card data
        • Open-source: github.com/kidneyweakx/solidarity

        13. UPDATES & CHANGES
        • We may update the App or these Terms anytime
        • Material changes will be notified via app updates
        • Continued use = acceptance of changes

        14. TERMINATION
        • You can stop using anytime (just delete the App)
        • We may discontinue the App at any time
        • Upon termination, delete the App and its data

        15. GOVERNING LAW
        • Governed by laws of Taiwan
        • Disputes resolved through good-faith negotiation

        16. CONTACT
        Questions? Create an issue:
        https://github.com/kidneyweakx/solidarity/issues

        17. ACKNOWLEDGMENT
        By using Solid(ar)ity, you acknowledge:
        • You've read and understand these Terms
        • The App operates entirely on your device
        • You're responsible for your data and device security
        • This is NOT a cryptocurrency or financial app

        Open Source • Privacy-First • Community-Driven
        """
    }
}

#Preview {
    NavigationView { GroupManagementView() }
}

// MARK: - Simple UI Components

private struct SimpleNodeRow: View {
    let icon: String
    let title: String
    let subtitle: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 16) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color.white.opacity(0.1))
                        .frame(width: 44, height: 44)

                    Image(systemName: icon)
                        .font(.system(size: 20, weight: .medium))
                        .foregroundColor(.white)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundColor(.white)

                    Text(subtitle)
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.5))
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 14))
                    .foregroundColor(.white.opacity(0.4))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.white.opacity(0.05))
            )
            .padding(.horizontal, 12)
            .padding(.vertical, 2)
        }
        .buttonStyle(.plain)
    }
}

private struct SimplePremiumFeatureRow: View {
    let icon: String
    let title: String
    let subtitle: String
    let price: String
    let isEnabled: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 14)
                    .fill(Color.white.opacity(0.12))
                    .frame(width: 50, height: 50)

                Image(systemName: icon)
                    .font(.system(size: 22, weight: .medium))
                    .foregroundColor(.white)
                    .frame(width: 50, height: 50)
                    .contentShape(Rectangle())
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(.white)

                Text(subtitle)
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.5))
                    .lineLimit(2)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text(price)
                    .font(.headline)
                    .fontWeight(.semibold)
                    .foregroundColor(.white)

                Text("Premium")
                    .font(.caption2)
                    .foregroundColor(.white.opacity(0.5))
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color.white.opacity(0.08))
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(Color.white.opacity(0.15), lineWidth: 1)
                )
        )
        .padding(.horizontal, 12)
        .opacity(isEnabled ? 1.0 : 0.6)
    }
}

private struct SimpleDangerNodeRow: View {
    let icon: String
    let title: String
    let subtitle: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 16) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color.red.opacity(0.15))
                        .frame(width: 44, height: 44)

                    Image(systemName: icon)
                        .font(.system(size: 20, weight: .medium))
                        .foregroundColor(.red)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundColor(.red)

                    Text(subtitle)
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.5))
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 14))
                    .foregroundColor(.red.opacity(0.6))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.red.opacity(0.08))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color.red.opacity(0.15), lineWidth: 1)
                    )
            )
            .padding(.horizontal, 12)
            .padding(.vertical, 2)
        }
        .buttonStyle(.plain)
    }
}


