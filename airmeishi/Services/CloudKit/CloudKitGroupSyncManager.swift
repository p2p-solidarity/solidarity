//
//  CloudKitGroupSyncManager.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import Foundation
import CloudKit
import Combine

@MainActor
protocol GroupSyncManagerProtocol {
    func startSyncEngine()
    func fetchLatestChanges() async throws
    func createGroup(name: String, description: String, coverImage: Data?) async throws -> GroupModel
    func updateGroup(_ group: GroupModel, name: String?, description: String?) async throws
    func deleteGroup(_ group: GroupModel) async throws
    func joinGroup(withInviteToken token: String) async throws -> GroupModel
    func leaveGroup(_ group: GroupModel) async throws
    func kickMember(userId: String, from group: GroupModel) async throws
    func createInviteLink(for group: GroupModel) async throws -> String
    func revokeInviteToken(_ token: String) async throws
    func getAllGroups() -> [GroupModel]
    func getMembers(for group: GroupModel) async throws -> [GroupMemberModel]
}

@MainActor
final class CloudKitGroupSyncManager: ObservableObject, GroupSyncManagerProtocol {
    static let shared = CloudKitGroupSyncManager()
    
    private let container = CKContainer.default()
    private var privateDB: CKDatabase { container.privateCloudDatabase }
    private var sharedDB: CKDatabase { container.sharedCloudDatabase }
    // Using Public DB for Invites to make them accessible by token query without prior sharing setup
    private var publicDB: CKDatabase { container.publicCloudDatabase }
    
    @Published private(set) var groups: [GroupModel] = []
    @Published var currentUserRecordID: CKRecord.ID?
    @Published var isAuthenticated = false
    @Published var accountStatus: CKAccountStatus = .couldNotDetermine
    
    private init() {
        loadGroupsFromLocal()
        Task {
            await checkAccountStatus()
        }
    }
    
    func checkAccountStatus() async {
        do {
            accountStatus = try await container.accountStatus()
            switch accountStatus {
            case .available:
                let id = try await container.userRecordID()
                self.currentUserRecordID = id
                self.isAuthenticated = true
            default:
                self.isAuthenticated = false
                self.currentUserRecordID = nil
            }
        } catch {
            print("Error checking account status: \(error)")
            self.isAuthenticated = false
            self.accountStatus = .couldNotDetermine
        }
    }
    
    private let zoneName = "AirMeishiGroups"
    private var customZoneID: CKRecordZone.ID {
        CKRecordZone.ID(zoneName: zoneName, ownerName: CKCurrentUserDefaultName)
    }
    
    // MARK: - Local Caching
    
    // Removed JSON caching in favor of SwiftData via LocalCacheManager
    
    private func saveGroupsToLocal() {
        LocalCacheManager.shared.saveGroups(self.groups)
    }
    
    private func loadGroupsFromLocal() {
        self.groups = LocalCacheManager.shared.fetchGroups()
        print("[CloudKitManager] Loaded \(self.groups.count) groups from SwiftData cache")
    }
    
    // MARK: - Core Sync
    
    public enum SyncStatus {
        case idle
        case syncing
        case error(Error)
        case offline
    }
    
    @Published var syncStatus: SyncStatus = .idle
    
    // MARK: - Core Sync
    
    func startSyncEngine() {
        print("[CloudKitManager] Starting sync engine...")
        Task {
            await checkAccountStatus()
            if isAuthenticated {
                try? await createCustomZoneIfNeeded()
                try? await subscribeToChanges()
                try? await fetchLatestChanges()
            }
        }
    }
    
    private func createCustomZoneIfNeeded() async throws {
        do {
            let zone = CKRecordZone(zoneID: customZoneID)
            try await privateDB.save(zone)
            print("[CloudKitManager] Custom zone created/verified")
        } catch {
            // Ignore if already exists
            print("[CloudKitManager] Zone creation note: \(error)")
        }
    }
    
    private func subscribeToChanges() async throws {
        // 1. Subscribe to Public Group Changes (Database Subscription not available for Public DB, use Query)
        // Subscribe to all group memberships for this user
        if let userID = currentUserRecordID {
            let predicate = NSPredicate(format: "userRecordID == %@", userID)
            let subscriptionID = "group-membership-changes"
            let subscription = CKQuerySubscription(recordType: CloudKitRecordType.groupMembership, predicate: predicate, subscriptionID: subscriptionID, options: [.firesOnRecordCreation, .firesOnRecordUpdate, .firesOnRecordDeletion])
            
            let notificationInfo = CKSubscription.NotificationInfo()
            notificationInfo.shouldSendContentAvailable = true // Silent push
            subscription.notificationInfo = notificationInfo
            
            _ = try? await publicDB.save(subscription)
            print("[CloudKitManager] Subscribed to public group membership changes")
        }
        
        // 2. Subscribe to Private/Shared Database Changes
        let privateSubscription = CKDatabaseSubscription(subscriptionID: "private-changes")
        let privateNotificationInfo = CKSubscription.NotificationInfo()
        privateNotificationInfo.shouldSendContentAvailable = true
        privateSubscription.notificationInfo = privateNotificationInfo
        _ = try? await privateDB.save(privateSubscription)
        
        let sharedSubscription = CKDatabaseSubscription(subscriptionID: "shared-changes")
        let sharedNotificationInfo = CKSubscription.NotificationInfo()
        sharedNotificationInfo.shouldSendContentAvailable = true
        sharedSubscription.notificationInfo = sharedNotificationInfo
        _ = try? await sharedDB.save(sharedSubscription)
        
        print("[CloudKitManager] Subscribed to private/shared database changes")
    }
    
    func fetchLatestChanges() async throws {
        print("[CloudKitManager] Fetching latest changes...")
        await MainActor.run { self.syncStatus = .syncing }
        
        guard let userID = currentUserRecordID else {
            print("[CloudKitManager] Fetch aborted: No User ID")
            await MainActor.run { self.syncStatus = .idle }
            return
        }
        
        var fetchedGroups: [GroupModel] = []
        
        // 1. Fetch Public Groups (Existing Logic)
        let publicPredicate = NSPredicate(format: "userRecordID == %@", userID)
        let publicQuery = CKQuery(recordType: CloudKitRecordType.groupMembership, predicate: publicPredicate)
        
        do {
            let (matchResults, _) = try await publicDB.records(matching: publicQuery)
            for result in matchResults {
                if case .success(let record) = result.1,
                   let groupRef = record["group"] as? CKRecord.Reference {
                    let groupRecordID = groupRef.recordID
                    if let groupRecord = try? await publicDB.record(for: groupRecordID) {
                        if var model = mapRecordToGroup(groupRecord) {
                            model.isPrivate = false
                            fetchedGroups.append(model)
                        }
                    }
                }
            }
        } catch {
            print("[CloudKitManager] Public fetch failed: \(error)")
            await MainActor.run { self.syncStatus = .error(error) }
        }
        
        // 2. Fetch Private/Shared Groups
        // Fetch Owned Private Groups
        let privateQuery = CKQuery(recordType: CloudKitRecordType.group, predicate: NSPredicate(value: true))
        do {
            let (matchResults, _) = try await privateDB.records(matching: privateQuery, inZoneWith: customZoneID)
            for result in matchResults {
                if case .success(let record) = result.1 {
                    if var model = mapRecordToGroup(record) {
                        model.isPrivate = true
                        fetchedGroups.append(model)
                    }
                }
            }
        } catch {
            print("[CloudKitManager] Private fetch failed: \(error)")
        }
        
        // Fetch Shared Groups (Joined)
        let sharedQuery = CKQuery(recordType: CloudKitRecordType.group, predicate: NSPredicate(value: true))
        do {
            let (matchResults, _) = try await sharedDB.records(matching: sharedQuery)
            for result in matchResults {
                if case .success(let record) = result.1 {
                    if var model = mapRecordToGroup(record) {
                        model.isPrivate = true
                        fetchedGroups.append(model)
                    }
                }
            }
        } catch {
            print("[CloudKitManager] Shared fetch failed: \(error)")
        }
        
        // 3. Merge Strategy (Conflict Resolution)
        // We have `fetchedGroups` (Cloud) and `self.groups` (Local).
        // Goal: Update `self.groups` with `fetchedGroups`, but respect local unsynced changes.
        
        var mergedGroups: [GroupModel] = []
        let localGroupsMap = Dictionary(uniqueKeysWithValues: self.groups.map { ($0.id, $0) })
        
        for cloudGroup in fetchedGroups {
            if let localGroup = localGroupsMap[cloudGroup.id] {
                if !localGroup.isSynced {
                    // Local has unsynced changes. Keep Local.
                    // Ideally we should try to merge fields or warn user, but for now "Keep Local" preserves work.
                    print("[CloudKitManager] Conflict: Group \(localGroup.name) has local changes. Keeping local version.")
                    mergedGroups.append(localGroup)
                } else {
                    // Local is synced (or unchanged). Overwrite with Cloud.
                    mergedGroups.append(cloudGroup)
                }
            } else {
                // New from Cloud
                mergedGroups.append(cloudGroup)
            }
        }
        
        // Also keep local-only groups that are not present in CloudKit.
        // Design choice: local cache is the source of truth for "what the user has created locally".
        // We keep them until the user explicitly deletes them.
        for localGroup in self.groups {
            if !mergedGroups.contains(where: { $0.id == localGroup.id }) {
                print("[CloudKitManager] Keeping local-only group: \(localGroup.name)")
                mergedGroups.append(localGroup)
            }
        }
        
        // After fetching all groups, sync merkle roots to SemaphoreManager
        for group in mergedGroups {
            if let groupUUID = UUID(uuidString: group.id) {
                let _ = SemaphoreGroupManager.shared.ensureGroupFromInvite(
                    id: groupUUID,
                    name: group.name,
                    root: group.merkleRoot
                )
                // If we have a merkle root from CloudKit, update it
                if let root = group.merkleRoot {
                    SemaphoreGroupManager.shared.selectGroup(groupUUID)
                    SemaphoreGroupManager.shared.updateRoot(root)
                }
            }
        }
        
        self.groups = mergedGroups
        saveGroupsToLocal()
        print("[CloudKitManager] Successfully updated groups. Total: \(self.groups.count)")
        await MainActor.run { self.syncStatus = .idle }
    }
    
    // MARK: - Group Management
    
    func createGroup(name: String, description: String, coverImage: Data?) async throws -> GroupModel {
        // Default to Public for backward compatibility if called without isPrivate
        return try await createGroup(name: name, description: description, coverImage: coverImage, isPrivate: false)
    }
    
    func createGroup(name: String, description: String, coverImage: Data?, isPrivate: Bool) async throws -> GroupModel {
        print("[CloudKitManager] Creating group: \(name), Private: \(isPrivate)")
        
        if currentUserRecordID == nil {
            await checkAccountStatus()
        }
        
        guard let userID = currentUserRecordID else { throw CKError(.notAuthenticated) }
        
        if isPrivate {
            return try await createPrivateGroup(name: name, description: description, coverImage: coverImage, userID: userID)
        } else {
            return try await createPublicGroup(name: name, description: description, coverImage: coverImage, userID: userID)
        }
    }
    
    private func createPublicGroup(name: String, description: String, coverImage: Data?, userID: CKRecord.ID) async throws -> GroupModel {
        let groupRecord = CKRecord(recordType: CloudKitRecordType.group)
        groupRecord["name"] = name
        groupRecord["description"] = description
        if let image = coverImage { groupRecord["coverImage"] = image }
        groupRecord["ownerRecordID"] = CKRecord.Reference(recordID: userID, action: .none)
        groupRecord["memberCount"] = 1
        
        let membershipRecord = CKRecord(recordType: CloudKitRecordType.groupMembership)
        membershipRecord["group"] = CKRecord.Reference(recordID: groupRecord.recordID, action: .deleteSelf)
        membershipRecord["userRecordID"] = CKRecord.Reference(recordID: userID, action: .none)
        membershipRecord["role"] = "owner"
        membershipRecord["status"] = "active"
        
        let _ = try await publicDB.modifyRecords(saving: [groupRecord, membershipRecord], deleting: [])
        
        var newGroup = mapRecordToGroup(groupRecord)!
        newGroup.isPrivate = false
        self.groups.append(newGroup)
        saveGroupsToLocal()
        return newGroup
    }
    
    private func createPrivateGroup(name: String, description: String, coverImage: Data?, userID: CKRecord.ID) async throws -> GroupModel {
        let recordID = CKRecord.ID(recordName: UUID().uuidString, zoneID: customZoneID)
        let groupRecord = CKRecord(recordType: CloudKitRecordType.group, recordID: recordID)
        groupRecord["name"] = name
        groupRecord["description"] = description
        if let image = coverImage { groupRecord["coverImage"] = image }
        groupRecord["ownerRecordID"] = CKRecord.Reference(recordID: userID, action: .none)
        groupRecord["memberCount"] = 1
        
        // For private groups, we don't need a separate Membership record for the owner in the same way,
        // or we can store it in the private DB too.
        // But CKShare handles the "membership" concept.
        // However, to keep models consistent, we might want one.
        // For now, let's just save the Group record.
        
        try await privateDB.save(groupRecord)
        
        var newGroup = mapRecordToGroup(groupRecord)!
        newGroup.isPrivate = true
        self.groups.append(newGroup)
        saveGroupsToLocal()
        return newGroup
    }
    
    func updateGroup(_ group: GroupModel, name: String?, description: String?) async throws {
        let db = group.isPrivate ? privateDB : publicDB
        let recordID = CKRecord.ID(recordName: group.id, zoneID: group.isPrivate ? customZoneID : CKRecordZone.default().zoneID)
        
        // Note: For shared records, we need to fetch from sharedDB if we are not the owner.
        // This logic needs refinement for shared groups where we are participants.
        // For MVP, assuming owner updates.
        
        let record = try await db.record(for: recordID)
        if let name = name { record["name"] = name }
        if let description = description { record["description"] = description }
        try await db.save(record)
        
        if let index = groups.firstIndex(where: { $0.id == group.id }) {
            var updated = self.groups[index]
            if let name = name { updated.name = name }
            if let description = description { updated.description = description }
            self.groups[index] = updated
            saveGroupsToLocal()
        }
    }
    
    func deleteGroup(_ group: GroupModel) async throws {
        let db = group.isPrivate ? privateDB : publicDB
        let recordID = CKRecord.ID(recordName: group.id, zoneID: group.isPrivate ? customZoneID : CKRecordZone.default().zoneID)
        try await db.deleteRecord(withID: recordID)
        
        // Update in-memory list
        self.groups.removeAll { $0.id == group.id }
        
        // Delete from local SwiftData cache
        LocalCacheManager.shared.deleteGroup(group.id)
        
        // Persist remaining groups (optional but keeps local mirror consistent)
        saveGroupsToLocal()
    }
    
    // MARK: - Sharing (Private Groups)
    
    func createShare(for group: GroupModel) async throws -> (CKShare, CKContainer) {
        guard group.isPrivate else { throw NSError(domain: "GroupError", code: 400, userInfo: [NSLocalizedDescriptionKey: "Cannot share public group via CKShare"]) }
        
        let recordID = CKRecord.ID(recordName: group.id, zoneID: customZoneID)
        let record = try await privateDB.record(for: recordID)
        
        if let shareRef = record.share {
            guard let share = try await privateDB.record(for: shareRef.recordID) as? CKShare else {
                throw NSError(domain: "GroupError", code: 500, userInfo: [NSLocalizedDescriptionKey: "Invalid share record"])
            }
            return (share, self.container)
        }
        
        let share = CKShare(rootRecord: record)
        share[CKShare.SystemFieldKey.title] = group.name as CKRecordValue
        share.publicPermission = .none
        
        let modifyOp = CKModifyRecordsOperation(recordsToSave: [share, record], recordIDsToDelete: nil)
        modifyOp.savePolicy = .changedKeys
        
        return try await withCheckedThrowingContinuation { continuation in
            modifyOp.modifyRecordsResultBlock = { result in
                switch result {
                case .success:
                    continuation.resume(returning: (share, self.container))
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
            privateDB.add(modifyOp)
        }
    }
    
    // MARK: - Membership Actions (Public)
    
    func joinGroup(withInviteToken token: String) async throws -> GroupModel {
        // ... (Existing implementation for Public Groups) ...
        // Re-using existing logic but ensuring it maps to public group
        return try await joinPublicGroup(withInviteToken: token)
    }
    
    private func joinPublicGroup(withInviteToken token: String) async throws -> GroupModel {
        print("[CloudKitManager] Attempting to join public group with token: \(token)")
        if currentUserRecordID == nil {
            print("[CloudKitManager] User ID missing, checking account status...")
            await checkAccountStatus()
        }
        
        guard let userID = currentUserRecordID else {
            print("[CloudKitManager] Still no User ID after check.")
            throw CKError(.notAuthenticated)
        }
        
        // 1. Find the invite record
        let predicate = NSPredicate(format: "token == %@", token)
        let query = CKQuery(recordType: CloudKitRecordType.groupInvite, predicate: predicate)
        let (results, _) = try await publicDB.records(matching: query)
        
        guard let firstMatch = results.first, case .success(let inviteRecord) = firstMatch.1,
              let groupRef = inviteRecord["targetGroup"] as? CKRecord.Reference else {
            print("[CloudKitManager] Invalid or expired invite token")
            throw NSError(domain: "GroupError", code: 404, userInfo: [NSLocalizedDescriptionKey: "Invalid or expired invite token"])
        }
        
        let groupRecordID = groupRef.recordID
        print("[CloudKitManager] Found invite for group ID: \(groupRecordID.recordName)")
        
        // 2. Check if already a member
        let membershipPredicate = NSPredicate(format: "group == %@ AND userRecordID == %@", CKRecord.Reference(recordID: groupRecordID, action: .none), CKRecord.Reference(recordID: userID, action: .none))
        let membershipQuery = CKQuery(recordType: CloudKitRecordType.groupMembership, predicate: membershipPredicate)
        let (membershipResults, _) = try await publicDB.records(matching: membershipQuery)
        
        if let _ = membershipResults.first {
            print("[CloudKitManager] User is already a member of this group.")
            // Fetch group details and return
            let groupRecord = try await publicDB.record(for: groupRecordID)
            if var groupModel = mapRecordToGroup(groupRecord) {
                groupModel.isPrivate = false
                // Ensure it's in our local list if not already
                if !self.groups.contains(where: { $0.id == groupModel.id }) {
                    self.groups.append(groupModel)
                    saveGroupsToLocal()
                }
                return groupModel
            }
        }
        
        // 2b. Check if already a member by commitment (Prevent Double Spending)
        if let identity = SemaphoreIdentityManager.shared.getIdentity() {
            let commitment = identity.commitment
            let commitmentPredicate = NSPredicate(format: "group == %@ AND commitment == %@", CKRecord.Reference(recordID: groupRecordID, action: .none), commitment)
            let commitmentQuery = CKQuery(recordType: CloudKitRecordType.groupMembership, predicate: commitmentPredicate)
            let (commitmentResults, _) = try await publicDB.records(matching: commitmentQuery)
            
            if let _ = commitmentResults.first {
                print("[CloudKitManager] User is already a member of this group (verified by commitment).")
                // Fetch group details and return
                let groupRecord = try await publicDB.record(for: groupRecordID)
                if var groupModel = mapRecordToGroup(groupRecord) {
                    groupModel.isPrivate = false
                    // Ensure it's in our local list if not already
                    if !self.groups.contains(where: { $0.id == groupModel.id }) {
                        self.groups.append(groupModel)
                        saveGroupsToLocal()
                    }
                    return groupModel
                }
            }
        }
        
        // 3. Join the group
        print("[CloudKitManager] Joining group...")
        let groupRecord = try await publicDB.record(for: groupRecordID)
        
        // 3a. Create membership record
        let membershipRecord = CKRecord(recordType: CloudKitRecordType.groupMembership)
        membershipRecord["group"] = CKRecord.Reference(recordID: groupRecord.recordID, action: .deleteSelf)
        membershipRecord["userRecordID"] = CKRecord.Reference(recordID: userID, action: .none)
        membershipRecord["role"] = "member"
        membershipRecord["status"] = "active"
        membershipRecord["joinedAt"] = Date()
        
        // Save commitment
        if let identity = SemaphoreIdentityManager.shared.getIdentity() {
            membershipRecord["commitment"] = identity.commitment
        }
        
        // 3b. Update group's memberCount atomically
        let currentMemberCount = (groupRecord["memberCount"] as? Int) ?? 1
        groupRecord["memberCount"] = currentMemberCount + 1
        
        // Use modifyRecords to save both atomically
        let _ = try await publicDB.modifyRecords(saving: [groupRecord, membershipRecord], deleting: [])
        print("[CloudKitManager] Successfully joined group in CloudKit, memberCount updated to \(currentMemberCount + 1)")
        
        // 4. Update local state
        var groupModel = mapRecordToGroup(groupRecord)!
        groupModel.isPrivate = false
        groupModel.memberCount = currentMemberCount + 1
        self.groups.append(groupModel)
        saveGroupsToLocal()
        
        // 5. Sync with Semaphore (ZK) Manager
        if let identity = SemaphoreIdentityManager.shared.getIdentity(),
           let groupUUID = UUID(uuidString: groupModel.id) {
            
            print("[CloudKitManager] Syncing with Semaphore Manager for group: \(groupModel.name)")
            print("[CloudKitManager] Identity Commitment: \(identity.commitment)")
            
            // Ensure group exists in ZK manager and is selected
            let _ = SemaphoreGroupManager.shared.ensureGroupFromInvite(
                id: groupUUID,
                name: groupModel.name,
                root: groupModel.merkleRoot
            )
            
            // Make sure the group is selected before adding member
            SemaphoreGroupManager.shared.selectGroup(groupUUID)
            
            // Add self as member (leaf)
            SemaphoreGroupManager.shared.addMember(identity.commitment)
            print("[CloudKitManager] Added member to Semaphore Group")
            
            // 6. Sync updated merkle root back to CloudKit
            // Wait a bit for the root computation to complete
            try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds
            
            if let updatedRoot = SemaphoreGroupManager.shared.merkleRoot {
                print("[CloudKitManager] Updating merkle root in CloudKit: \(updatedRoot)")
                let updatedGroupRecord = try await publicDB.record(for: groupRecordID)
                updatedGroupRecord["merkleRoot"] = updatedRoot
                try await publicDB.save(updatedGroupRecord)
                print("[CloudKitManager] Merkle root synced to CloudKit")
                
                // Update local model
                if let index = self.groups.firstIndex(where: { $0.id == groupModel.id }) {
                    self.groups[index].merkleRoot = updatedRoot
                    saveGroupsToLocal()
                }
            }
        } else {
            print("[CloudKitManager] WARNING: Could not sync with Semaphore Manager. Identity or GroupUUID missing.")
        }
        
        // 7. Trigger a refresh to fetch latest changes (for other users)
        Task {
            try? await self.fetchLatestChanges()
        }
        
        return groupModel
    }
    
    func leaveGroup(_ group: GroupModel) async throws {
        if group.isPrivate {
            // Leave CKShare
            // Complex, requires removing self from participants
        } else {
            // Leave Public Group
            guard let userID = currentUserRecordID else { return }
            let predicate = NSPredicate(format: "group == %@ AND userRecordID == %@", CKRecord.Reference(recordID: CKRecord.ID(recordName: group.id), action: .none), CKRecord.Reference(recordID: userID, action: .none))
            let query = CKQuery(recordType: CloudKitRecordType.groupMembership, predicate: predicate)
            let (results, _) = try await publicDB.records(matching: query)
            if let match = results.first, case .success(let record) = match.1 {
                try await publicDB.deleteRecord(withID: record.recordID)
                self.groups.removeAll { $0.id == group.id }
                saveGroupsToLocal()
            }
        }
    }
    
    func kickMember(userId: String, from group: GroupModel) async throws {
        print("[CloudKitManager] Kicking member \(userId) from group \(group.name)")
        
        // 1. Find the membership record
        let predicate = NSPredicate(format: "group == %@ AND userRecordID == %@", CKRecord.Reference(recordID: CKRecord.ID(recordName: group.id), action: .none), CKRecord.Reference(recordID: CKRecord.ID(recordName: userId), action: .none))
        let query = CKQuery(recordType: CloudKitRecordType.groupMembership, predicate: predicate)
        let (results, _) = try await publicDB.records(matching: query)
        
        guard let match = results.first, case .success(let record) = match.1 else {
            throw NSError(domain: "GroupError", code: 404, userInfo: [NSLocalizedDescriptionKey: "Member not found"])
        }
        
        // 2. Update status to kicked
        record["status"] = "kicked"
        
        // 3. Save
        try await publicDB.save(record)
        print("[CloudKitManager] Member kicked successfully")
        
        // 4. Update Semaphore Group (Remove leaf)
        // We need the identity commitment of the user to remove them from the tree.
        // This is tricky because we might not have their commitment easily accessible unless it's stored in the membership record.
        // For now, we just update the CloudKit status. The Semaphore Manager needs to handle tree updates based on this.
        // Ideally, the membership record should store the merkle leaf/commitment.
    }
    
    func approveMember(userId: String, from group: GroupModel) async throws {
        print("[CloudKitManager] Approving member \(userId) for group \(group.name)")
        try await updateMemberStatus(userId: userId, group: group, status: "active")
    }
    
    func rejectMember(userId: String, from group: GroupModel) async throws {
        print("[CloudKitManager] Rejecting member \(userId) from group \(group.name)")
        // Rejecting is effectively kicking/removing
        try await kickMember(userId: userId, from: group)
    }
    
    private func updateMemberStatus(userId: String, group: GroupModel, status: String) async throws {
        let predicate = NSPredicate(format: "group == %@ AND userRecordID == %@", CKRecord.Reference(recordID: CKRecord.ID(recordName: group.id), action: .none), CKRecord.Reference(recordID: CKRecord.ID(recordName: userId), action: .none))
        let query = CKQuery(recordType: CloudKitRecordType.groupMembership, predicate: predicate)
        let (results, _) = try await publicDB.records(matching: query)
        
        guard let match = results.first, case .success(let record) = match.1 else {
            throw NSError(domain: "GroupError", code: 404, userInfo: [NSLocalizedDescriptionKey: "Member not found"])
        }
        
        record["status"] = status
        try await publicDB.save(record)
        print("[CloudKitManager] Member status updated to \(status)")
    }
    
    // MARK: - Invite System (Public)
    
    func createInviteLink(for group: GroupModel) async throws -> String {
        if group.isPrivate {
            // For private groups, we use CloudKit Sharing.
            // We return the Share URL so it can be used as a link.
            let (share, _) = try await createShare(for: group)
            guard let url = share.url else {
                throw NSError(domain: "GroupError", code: 500, userInfo: [NSLocalizedDescriptionKey: "Share created but no URL available. Try again."])
            }
            return url.absoluteString
        }
        
        guard let userID = currentUserRecordID else { throw CKError(.notAuthenticated) }
        
        // 1. Check for existing active token
        let predicate = NSPredicate(format: "targetGroup == %@ AND createdBy == %@ AND isActive == 1", 
                                   CKRecord.Reference(recordID: CKRecord.ID(recordName: group.id), action: .none),
                                   CKRecord.Reference(recordID: userID, action: .none))
        let query = CKQuery(recordType: CloudKitRecordType.groupInvite, predicate: predicate)
        // Note: Removed sortDescriptor to avoid CloudKit schema configuration issues
        // We'll sort in memory instead
        
        let (results, _) = try await publicDB.records(matching: query)
        // Sort by creationDate in memory (most recent first)
        let sortedResults = results.compactMap { result -> (CKRecord, Date)? in
            guard case .success(let record) = result.1 else { return nil }
            let creationDate = record.creationDate ?? Date.distantPast
            return (record, creationDate)
        }.sorted { $0.1 > $1.1 }
        
        if let firstMatch = sortedResults.first, let token = firstMatch.0["token"] as? String {
            print("[CloudKitManager] Found existing active invite token")
            return "airmeishi://group/join?token=\(token)"
        }
        
        // 2. Create new token if none exists
        let token = UUID().uuidString
        let inviteRecord = CKRecord(recordType: CloudKitRecordType.groupInvite)
        inviteRecord["token"] = token
        inviteRecord["targetGroup"] = CKRecord.Reference(recordID: CKRecord.ID(recordName: group.id), action: .none)
        inviteRecord["isActive"] = 1
        inviteRecord["createdBy"] = CKRecord.Reference(recordID: userID, action: .none)
        // CloudKit automatically adds creationDate
        
        try await publicDB.save(inviteRecord)
        print("[CloudKitManager] Created new invite token")
        return "airmeishi://group/join?token=\(token)"
    }
    
    func revokeInviteToken(_ token: String) async throws {
        // ... (Existing logic) ...
         let predicate = NSPredicate(format: "token == %@", token)
        let query = CKQuery(recordType: CloudKitRecordType.groupInvite, predicate: predicate)
        let (results, _) = try await publicDB.records(matching: query)
        if let match = results.first, case .success(let record) = match.1 {
            record["isActive"] = 0
            try await publicDB.save(record)
        }
    }
    
    // MARK: - Data Access
    
    func getAllGroups() -> [GroupModel] {
        return groups
    }
    
    func getMembers(for group: GroupModel) async throws -> [GroupMemberModel] {
        if group.isPrivate {
            // Fetch from CKShare participants?
            // For MVP, private groups might not support full member listing via this API yet
            return []
        } else {
            let predicate = NSPredicate(format: "group == %@ AND status == %@",
                                       CKRecord.Reference(recordID: CKRecord.ID(recordName: group.id), action: .none),
                                       "active")
            let query = CKQuery(recordType: CloudKitRecordType.groupMembership, predicate: predicate)
            // Sort by joinedAt
            query.sortDescriptors = [NSSortDescriptor(key: "joinedAt", ascending: true)]
            
            let (results, _) = try await publicDB.records(matching: query)
            let members = results.compactMap { result -> GroupMemberModel? in
                guard case .success(let record) = result.1 else { return nil }
                return mapRecordToMember(record)
            }
            
            // Update memberCount if it's different from actual count
            // Update memberCount if it's different from actual count
            if members.count != group.memberCount {
                print("[CloudKitManager] Local member count mismatch. Updating local group model.")
                if let index = self.groups.firstIndex(where: { $0.id == group.id }) {
                    self.groups[index].memberCount = members.count
                    saveGroupsToLocal()
                }
                
                // Optionally update CloudKit if we are the owner or if the count is significantly off?
                // For now, let's just update CloudKit to keep it consistent for everyone
                // But this might cause write conflicts if many people do it.
                // Better to let the join action handle the increment, and here we just sync local view.
                // However, if we want to self-heal:
                /*
                if let groupRecord = try? await publicDB.record(for: CKRecord.ID(recordName: group.id)) {
                    groupRecord["memberCount"] = members.count
                    try? await publicDB.save(groupRecord)
                }
                */
            }
            
            // Update memberCount if it's different from actual count
            if members.count != group.memberCount {
                print("[CloudKitManager] Local member count mismatch. Updating local group model.")
                if let index = self.groups.firstIndex(where: { $0.id == group.id }) {
                    self.groups[index].memberCount = members.count
                    saveGroupsToLocal()
                }
            }
            
            // Save members to local cache
            LocalCacheManager.shared.saveMembers(members, for: group.id)
            
            return members
        }
    }
    
    // MARK: - Group VC Support
    
    func getActiveMembers(for group: GroupModel) async throws -> [GroupMemberModel] {
        return try await getMembers(for: group).filter { $0.status == .active }
    }
    
    func updateMemberMessagingData(
        userId: String,
        group: GroupModel,
        sealedRoute: String,
        pubKey: String,
        signPubKey: String
    ) async throws {
        // 1. Find member record
        let predicate = NSPredicate(format: "group == %@ AND userRecordID == %@",
                                   CKRecord.Reference(recordID: CKRecord.ID(recordName: group.id), action: .none),
                                   CKRecord.Reference(recordID: CKRecord.ID(recordName: userId), action: .none))
        let query = CKQuery(recordType: CloudKitRecordType.groupMembership, predicate: predicate)
        let (results, _) = try await publicDB.records(matching: query)
        
        guard let match = results.first, case .success(let record) = match.1 else {
            throw NSError(domain: "GroupError", code: 404, userInfo: [NSLocalizedDescriptionKey: "Member not found"])
        }
        
        // 2. Update fields
        record["sealedRoute"] = sealedRoute
        record["pubKey"] = pubKey
        record["signPubKey"] = signPubKey
        
        // 3. Save
        try await publicDB.save(record)
        print("[CloudKitManager] Updated messaging data for member \(userId)")
    }
    
    func getMembersMessagingData(for group: GroupModel, includeDeviceTokens: Bool = false) async throws -> [GroupMemberModel] {
        // Only owner can request device tokens
        if includeDeviceTokens {
            guard let currentUser = currentUserRecordID, group.ownerRecordID == currentUser.recordName else {
                throw CKError(.permissionFailure)
            }
        }
        
        let members = try await getActiveMembers(for: group)
        
        // If we are not owner, we shouldn't see deviceTokens (even if they were fetched, which they shouldn't be if we use proper field security, but here we filter in memory for MVP)
        if !includeDeviceTokens {
            return members.map { member in
                var filtered = member
                filtered.deviceToken = nil
                return filtered
            }
        }
        
        return members
    }
    
    func canIssueCredentials(for group: GroupModel) -> Bool {
        guard let currentUser = currentUserRecordID else { return false }
        return group.canIssueCredentials(userRecordID: currentUser.recordName)
    }
    
    // MARK: - Credential Issuers Management

    func addCredentialIssuer(userId: String, to group: GroupModel) async throws {
        guard let currentUser = currentUserRecordID,
              group.ownerRecordID == currentUser.recordName else {
            throw CKError(CKError.Code.permissionFailure)
        }
        
        var updatedGroup = group
        if !updatedGroup.credentialIssuers.contains(userId) {
            updatedGroup.credentialIssuers.append(userId)
        }
        
        let db = group.isPrivate ? privateDB : publicDB
        let recordID = CKRecord.ID(recordName: group.id, zoneID: group.isPrivate ? customZoneID : CKRecordZone.default().zoneID)
        let record = try await db.record(for: recordID)
        record["credentialIssuers"] = updatedGroup.credentialIssuers
        
        try await db.save(record)
        
        // Update local state
        if let index = groups.firstIndex(where: { $0.id == group.id }) {
            groups[index].credentialIssuers = updatedGroup.credentialIssuers
            saveGroupsToLocal()
        }
    }

    func removeCredentialIssuer(userId: String, from group: GroupModel) async throws {
        guard let currentUser = currentUserRecordID,
              group.ownerRecordID == currentUser.recordName else {
            throw CKError(CKError.Code.permissionFailure)
        }
        
        var updatedGroup = group
        updatedGroup.credentialIssuers.removeAll { $0 == userId }
        
        let db = group.isPrivate ? privateDB : publicDB
        let recordID = CKRecord.ID(recordName: group.id, zoneID: group.isPrivate ? customZoneID : CKRecordZone.default().zoneID)
        let record = try await db.record(for: recordID)
        record["credentialIssuers"] = updatedGroup.credentialIssuers
        
        try await db.save(record)
        
        // Update local state
        if let index = groups.firstIndex(where: { $0.id == group.id }) {
            groups[index].credentialIssuers = updatedGroup.credentialIssuers
            saveGroupsToLocal()
        }
    }

    // MARK: - Helpers
    
    private func mapRecordToGroup(_ record: CKRecord) -> GroupModel? {
        guard let name = record["name"] as? String,
              let ownerRef = record["ownerRecordID"] as? CKRecord.Reference else { return nil }
        
        return GroupModel(
            id: record.recordID.recordName,
            name: name,
            description: record["description"] as? String ?? "",
            coverImage: nil,
            ownerRecordID: ownerRef.recordID.recordName,
            merkleRoot: record["merkleRoot"] as? String,
            merkleTreeDepth: record["merkleTreeDepth"] as? Int ?? 20,
            memberCount: record["memberCount"] as? Int ?? 0,
            isPrivate: false, // Default, overridden by caller
            credentialIssuers: (record["credentialIssuers"] as? [String]) ?? []
        )
    }
    
    private func mapRecordToMember(_ record: CKRecord) -> GroupMemberModel? {
        guard let groupRef = record["group"] as? CKRecord.Reference,
              let userRef = record["userRecordID"] as? CKRecord.Reference,
              let roleStr = record["role"] as? String,
              let statusStr = record["status"] as? String else { return nil }
        
        var member = GroupMemberModel(
            id: record.recordID.recordName,
            groupID: groupRef.recordID.recordName,
            userRecordID: userRef.recordID.recordName,
            role: GroupMemberModel.Role(rawValue: roleStr) ?? .member,
            status: GroupMemberModel.Status(rawValue: statusStr) ?? .active,
            merkleIndex: record["merkleIndex"] as? Int ?? 0,
            joinedAt: record["joinedAt"] as? Date ?? Date()
        )
        
        member.sealedRoute = record["sealedRoute"] as? String
        member.pubKey = record["pubKey"] as? String
        member.signPubKey = record["signPubKey"] as? String
        // deviceToken should ideally be protected or only fetched by owner.
        // For MVP, we map it if present, but access control is handled in getMembersMessagingData
        member.deviceToken = record["deviceToken"] as? String
        member.commitment = record["commitment"] as? String
        
        return member
    }
}

