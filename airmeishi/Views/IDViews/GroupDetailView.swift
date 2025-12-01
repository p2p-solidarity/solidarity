//
//  GroupDetailView.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import SwiftUI

struct GroupDetailView: View {
    let group: GroupModel
    @ObservedObject private var semaphoreManager = SemaphoreGroupManager.shared
    @ObservedObject private var cloudKitManager = CloudKitGroupSyncManager.shared
    
    @State private var members: [GroupMemberModel] = []
    @State private var isLoadingMembers = false
    @State private var errorMessage: String?
    
    var isOwner: Bool {
        group.ownerRecordID == cloudKitManager.currentUserRecordID?.recordName
    }
    
    var body: some View {
        ScrollView {
            LazyVStack(spacing: 20) {
                // MARK: - Group Info
                GroupInfoSection(group: group)
                
                // MARK: - Merkle Tree
                MerkleTreeSection(group: group, semaphoreManager: semaphoreManager)
                
                // MARK: - Invite
                InviteSection(group: group)
                
                // MARK: - Members
                MembersSection(
                    members: members,
                    isLoading: isLoadingMembers,
                    isOwner: isOwner,
                    onKick: kickMember,
                    onApprove: approveMember,
                    onReject: rejectMember
                )
                
                // MARK: - OIDC Integration
                OIDCSection(group: group)
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(group.name)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await loadData()
        }
        .refreshable {
            await loadData()
        }
    }
    
    private func loadData() async {
        isLoadingMembers = true
        defer { isLoadingMembers = false }
        
        // Sync Semaphore
        if let uuid = UUID(uuidString: group.id) {
            semaphoreManager.ensureGroupFromInvite(id: uuid, name: group.name, root: group.merkleRoot)
        }
        
        // Fetch Members
        do {
            members = try await cloudKitManager.getMembers(for: group)
        } catch {
            print("Error fetching members: \(error)")
            errorMessage = error.localizedDescription
        }
    }
    
    private func kickMember(_ member: GroupMemberModel) {
        Task {
            do {
                try await cloudKitManager.kickMember(userId: member.userRecordID, from: group)
                await loadData()
            } catch {
                print("Error kicking member: \(error)")
            }
        }
    }
    
    private func approveMember(_ member: GroupMemberModel) {
        Task {
            do {
                try await cloudKitManager.approveMember(userId: member.userRecordID, from: group)
                await loadData()
            } catch {
                print("Error approving member: \(error)")
            }
        }
    }
    
    private func rejectMember(_ member: GroupMemberModel) {
        Task {
            do {
                try await cloudKitManager.rejectMember(userId: member.userRecordID, from: group)
                await loadData()
            } catch {
                print("Error rejecting member: \(error)")
            }
        }
    }
}

// MARK: - Subviews

struct GroupInfoSection: View {
    let group: GroupModel
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Group Info")
                .font(.headline)
                .foregroundColor(.secondary)
            
            VStack(alignment: .leading, spacing: 8) {
                LabeledContent("Name", value: group.name)
                if !group.description.isEmpty {
                    LabeledContent("Description", value: group.description)
                }
                LabeledContent("ID", value: group.id)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .textSelection(.enabled)
                
                LabeledContent("Members", value: "\(group.memberCount)")
            }
            .padding()
            .background(Color(.secondarySystemGroupedBackground))
            .cornerRadius(12)
        }
    }
}

struct MerkleTreeSection: View {
    let group: GroupModel
    @ObservedObject var semaphoreManager: SemaphoreGroupManager
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Merkle Tree")
                .font(.headline)
                .foregroundColor(.secondary)
            
            VStack(alignment: .leading, spacing: 12) {
                if let root = semaphoreManager.merkleRoot {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Root Hash")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Text(root)
                            .font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled)
                            .padding(8)
                            .background(Color(.systemGray6))
                            .cornerRadius(8)
                    }
                } else {
                    Text("No Root Calculated")
                        .foregroundColor(.secondary)
                }
                
                Button(action: {
                    semaphoreManager.recomputeRoot()
                }) {
                    Label("Recompute Root", systemImage: "arrow.triangle.2.circlepath")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
            .padding()
            .background(Color(.secondarySystemGroupedBackground))
            .cornerRadius(12)
        }
    }
}

struct InviteSection: View {
    let group: GroupModel
    @State private var inviteLink: String?
    @State private var qrImage: UIImage?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showQRCode = false
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Invite Members")
                .font(.headline)
                .foregroundColor(.secondary)
            
            VStack(spacing: 16) {
                if isLoading {
                    ProgressView()
                        .frame(height: 100)
                } else if let link = inviteLink {
                    // Link Display & Copy
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Invite Link")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        
                        HStack {
                            Text(link)
                                .font(.system(.subheadline, design: .monospaced))
                                .lineLimit(1)
                                .truncationMode(.middle)
                                .foregroundColor(.primary)
                            
                            Spacer()
                            
                            Button(action: {
                                UIPasteboard.general.string = link
                            }) {
                                Image(systemName: "doc.on.doc")
                                    .foregroundColor(.blue)
                            }
                        }
                        .padding()
                        .background(Color(.systemGray6))
                        .cornerRadius(8)
                    }
                    
                    // QR Code Toggle
                    Button(action: {
                        withAnimation {
                            showQRCode.toggle()
                        }
                    }) {
                        Label(showQRCode ? "Hide QR Code" : "Show QR Code", systemImage: "qrcode")
                    }
                    .buttonStyle(.bordered)
                    
                    if showQRCode, let image = qrImage {
                        Image(uiImage: image)
                            .resizable()
                            .interpolation(.none)
                            .scaledToFit()
                            .frame(width: 200, height: 200)
                            .padding()
                            .background(Color.white)
                            .cornerRadius(12)
                            .shadow(radius: 2)
                            .transition(.scale.combined(with: .opacity))
                    }
                } else {
                    Button("Generate Invite Link") {
                        generateInvite()
                    }
                    .buttonStyle(.borderedProminent)
                    .frame(maxWidth: .infinity)
                }
                
                if let error = errorMessage {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                }
            }
            .padding()
            .frame(maxWidth: .infinity)
            .background(Color(.secondarySystemGroupedBackground))
            .cornerRadius(12)
        }
        .onAppear {
            // Auto-generate if not present? Maybe wait for user action to avoid spamming tokens.
            // But user asked for "list/copy interface", implying readiness.
            // Let's auto-generate if it's cheap, but creating a token involves a server call (CloudKit save).
            // Better to keep it manual or load existing if possible.
            // For now, manual trigger is safer but I'll make the UI ready.
        }
    }
    
    private func generateInvite() {
        isLoading = true
        errorMessage = nil
        
        Task {
            do {
                let link = try await CloudKitGroupSyncManager.shared.createInviteLink(for: group)
                
                // Generate QR Image
                var image: UIImage?
                if let filter = CIFilter(name: "CIQRCodeGenerator") {
                    filter.setValue(link.data(using: .ascii), forKey: "inputMessage")
                    if let output = filter.outputImage {
                        let transform = CGAffineTransform(scaleX: 10, y: 10)
                        let scaled = output.transformed(by: transform)
                        let context = CIContext()
                        if let cgImage = context.createCGImage(scaled, from: scaled.extent) {
                            image = UIImage(cgImage: cgImage)
                        }
                    }
                }
                
                await MainActor.run {
                    self.inviteLink = link
                    self.qrImage = image
                    self.isLoading = false
                    // Auto-show QR if generated
                    // self.showQRCode = true 
                }
            } catch {
                await MainActor.run {
                    self.errorMessage = error.localizedDescription
                    self.isLoading = false
                }
            }
        }
    }
}

struct MembersSection: View {
    let members: [GroupMemberModel]
    let isLoading: Bool
    let isOwner: Bool
    let onKick: (GroupMemberModel) -> Void
    let onApprove: (GroupMemberModel) -> Void
    let onReject: (GroupMemberModel) -> Void
    
    var pendingMembers: [GroupMemberModel] {
        members.filter { $0.status == .pending }
    }
    
    var activeMembers: [GroupMemberModel] {
        members.filter { $0.status == .active || $0.status == .kicked } // Show kicked? Maybe not.
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Members")
                    .font(.headline)
                    .foregroundColor(.secondary)
                Spacer()
                if isLoading {
                    ProgressView()
                }
            }
            
            if members.isEmpty && !isLoading {
                Text("No members found.")
                    .foregroundColor(.secondary)
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .center)
                    .background(Color(.secondarySystemGroupedBackground))
                    .cornerRadius(12)
            } else {
                LazyVStack(spacing: 16) {
                    if !pendingMembers.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Pending Requests")
                                .font(.subheadline)
                                .foregroundColor(.orange)
                                .padding(.leading, 4)
                            
                            VStack(spacing: 1) {
                                ForEach(pendingMembers) { member in
                                    PendingMemberRow(member: member, isOwner: isOwner, onApprove: { onApprove(member) }, onReject: { onReject(member) })
                                    if member.id != pendingMembers.last?.id {
                                        Divider().padding(.leading, 16)
                                    }
                                }
                            }
                            .background(Color(.secondarySystemGroupedBackground))
                            .cornerRadius(12)
                        }
                    }
                    
                    if !activeMembers.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            if !pendingMembers.isEmpty {
                                Text("Active Members")
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)
                                    .padding(.leading, 4)
                            }
                            
                            VStack(spacing: 1) {
                                ForEach(activeMembers) { member in
                                    MemberRow(member: member, isOwner: isOwner, onKick: { onKick(member) })
                                    if member.id != activeMembers.last?.id {
                                        Divider().padding(.leading, 16)
                                    }
                                }
                            }
                            .background(Color(.secondarySystemGroupedBackground))
                            .cornerRadius(12)
                        }
                    }
                }
            }
        }
    }
}

struct PendingMemberRow: View {
    let member: GroupMemberModel
    let isOwner: Bool
    let onApprove: () -> Void
    let onReject: () -> Void
    
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(member.userRecordID)
                    .font(.body)
                    .lineLimit(1)
                    .truncationMode(.middle)
                
                Text("Requesting to join")
                    .font(.caption)
                    .foregroundColor(.orange)
            }
            
            Spacer()
            
            if isOwner {
                HStack(spacing: 12) {
                    Button(action: onReject) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.red)
                            .font(.title2)
                    }
                    
                    Button(action: onApprove) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                            .font(.title2)
                    }
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground))
    }
}

struct MemberRow: View {
    let member: GroupMemberModel
    let isOwner: Bool
    let onKick: () -> Void
    
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(member.userRecordID) // Ideally replace with Name
                    .font(.body)
                    .lineLimit(1)
                    .truncationMode(.middle)
                
                HStack(spacing: 6) {
                    Text(member.role.rawValue.capitalized)
                        .font(.caption)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(member.role == .owner ? Color.blue.opacity(0.1) : Color.gray.opacity(0.1))
                        .foregroundColor(member.role == .owner ? .blue : .secondary)
                        .cornerRadius(4)
                    
                    if member.status == .kicked {
                        Text("Kicked")
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }
            }
            
            Spacer()
            
            if isOwner && member.role != .owner && member.status != .kicked {
                Button(role: .destructive, action: onKick) {
                    Text("Kick")
                        .foregroundColor(.red)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground)) // Ensure background for tap
    }
}

struct OIDCSection: View {
    let group: GroupModel
    @ObservedObject private var cloudKitManager = CloudKitGroupSyncManager.shared
    @ObservedObject private var semaphoreManager = SemaphoreIdentityManager.shared
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Identity Info")
                .font(.headline)
                .foregroundColor(.secondary)
            
            VStack(alignment: .leading, spacing: 12) {
                // User Name (Record ID)
                if let userID = cloudKitManager.currentUserRecordID?.recordName {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("User ID")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Text(userID)
                            .font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled)
                    }
                } else {
                    Text("User ID not available")
                        .font(.caption)
                        .foregroundColor(.red)
                }
                
                Divider()
                
                // Leaf Hash (Commitment)
                if let identity = semaphoreManager.getIdentity() {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Leaf Hash (Commitment)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Text(identity.commitment)
                            .font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled)
                    }
                } else {
                    Text("Identity not initialized")
                        .font(.caption)
                        .foregroundColor(.orange)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground))
            .cornerRadius(12)
        }
    }
}
