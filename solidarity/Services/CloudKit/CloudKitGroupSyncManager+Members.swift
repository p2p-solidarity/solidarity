//
//  CloudKitGroupSyncManager+Members.swift
//  solidarity
//
//  Created by Solidarity Team.
//

import CloudKit
import Foundation

extension CloudKitGroupSyncManager {

  // MARK: - Membership Actions (Public)

  func joinGroup(withInviteToken token: String) async throws -> GroupModel {
    return try await joinPublicGroup(withInviteToken: token)
  }

  internal func joinPublicGroup(withInviteToken token: String) async throws -> GroupModel {
    print("[CloudKitManager] Attempting to join public group with token: \(token)")

    let userID = try await ensureAuthenticated()
    let groupRecordID = try await findGroupID(from: token)
    print("[CloudKitManager] Found invite for group ID: \(groupRecordID.recordName)")

    if let existingGroup = try await checkExistingMembership(groupRecordID: groupRecordID, userID: userID) {
      return existingGroup
    }

    // Join the group
    print("[CloudKitManager] Joining group...")
    let groupRecord = try await publicDB.record(for: groupRecordID)
    let currentMemberCount = (groupRecord["memberCount"] as? Int) ?? 1

    // Update count and create membership
    groupRecord["memberCount"] = currentMemberCount + 1
    let membershipRecord = createMembershipRecord(group: groupRecord, userID: userID)

    // Atomic save
    _ = try await publicDB.modifyRecords(saving: [groupRecord, membershipRecord], deleting: [])
    print("[CloudKitManager] Successfully joined group in CloudKit, memberCount updated to \(currentMemberCount + 1)")

    // Update local state
    guard var groupModel = mapRecordToGroup(groupRecord) else {
      throw NSError(domain: "GroupError", code: 500, userInfo: [NSLocalizedDescriptionKey: "Failed to map group record"])
    }
    groupModel.isPrivate = false
    groupModel.memberCount = currentMemberCount + 1
    self.groups.append(groupModel)
    saveGroupsToLocal()

    // Sync Semaphore and refresh
    await syncSemaphore(for: &groupModel, groupRecordID: groupRecordID)

    Task { try? await self.fetchLatestChanges() }
    return groupModel
  }

  // MARK: - Join Helpers

  private func ensureAuthenticated() async throws -> CKRecord.ID {
    if currentUserRecordID == nil {
      print("[CloudKitManager] User ID missing, checking account status...")
      await checkAccountStatus()
    }
    guard let userID = currentUserRecordID else {
      print("[CloudKitManager] Still no User ID after check.")
      throw CKError(.notAuthenticated)
    }
    return userID
  }

  private func findGroupID(from token: String) async throws -> CKRecord.ID {
    let predicate = NSPredicate(format: "token == %@", token)
    let query = CKQuery(recordType: CloudKitRecordType.groupInvite, predicate: predicate)
    let (results, _) = try await publicDB.records(matching: query)

    guard let firstMatch = results.first, case .success(let inviteRecord) = firstMatch.1,
      let groupRef = inviteRecord["targetGroup"] as? CKRecord.Reference
    else {
      print("[CloudKitManager] Invalid or expired invite token")
      throw NSError(domain: "GroupError", code: 404, userInfo: [NSLocalizedDescriptionKey: "Invalid or expired invite token"])
    }
    return groupRef.recordID
  }

  private func checkExistingMembership(groupRecordID: CKRecord.ID, userID: CKRecord.ID) async throws -> GroupModel? {
    let membershipPredicate = NSPredicate(
      format: "group == %@ AND userRecordID == %@",
      CKRecord.Reference(recordID: groupRecordID, action: .none),
      CKRecord.Reference(recordID: userID, action: .none)
    )
    if try await checkMembershipExists(predicate: membershipPredicate) {
      print("[CloudKitManager] User is already a member of this group.")
      return try await fetchAndCacheGroup(groupRecordID: groupRecordID)
    }

    if let identity = SemaphoreIdentityManager.shared.getIdentity() {
      let commitmentPredicate = NSPredicate(
        format: "group == %@ AND commitment == %@",
        CKRecord.Reference(recordID: groupRecordID, action: .none),
        identity.commitment
      )
      if try await checkMembershipExists(predicate: commitmentPredicate) {
        print("[CloudKitManager] User is already a member of this group (verified by commitment).")
        return try await fetchAndCacheGroup(groupRecordID: groupRecordID)
      }
    }
    return nil
  }

  private func checkMembershipExists(predicate: NSPredicate) async throws -> Bool {
    let query = CKQuery(recordType: CloudKitRecordType.groupMembership, predicate: predicate)
    let (results, _) = try await publicDB.records(matching: query)
    return results.first != nil
  }

  private func fetchAndCacheGroup(groupRecordID: CKRecord.ID) async throws -> GroupModel? {
    let groupRecord = try await publicDB.record(for: groupRecordID)
    if var groupModel = mapRecordToGroup(groupRecord) {
      groupModel.isPrivate = false
      if !self.groups.contains(where: { $0.id == groupModel.id }) {
        self.groups.append(groupModel)
        saveGroupsToLocal()
      }
      return groupModel
    }
    return nil
  }

  private func createMembershipRecord(group: CKRecord, userID: CKRecord.ID) -> CKRecord {
    let record = CKRecord(recordType: CloudKitRecordType.groupMembership)
    record["group"] = CKRecord.Reference(recordID: group.recordID, action: .deleteSelf)
    record["userRecordID"] = CKRecord.Reference(recordID: userID, action: .none)
    record["role"] = "member"
    record["status"] = "active"
    record["joinedAt"] = Date()
    if let identity = SemaphoreIdentityManager.shared.getIdentity() {
      record["commitment"] = identity.commitment
    }
    return record
  }

  private func syncSemaphore(for groupModel: inout GroupModel, groupRecordID: CKRecord.ID) async {
    guard let identity = SemaphoreIdentityManager.shared.getIdentity(),
      let groupUUID = UUID(uuidString: groupModel.id)
    else {
      print("[CloudKitManager] WARNING: Could not sync with Semaphore Manager. Identity or GroupUUID missing.")
      return
    }

    print("[CloudKitManager] Syncing with Semaphore Manager for group: \(groupModel.name)")
    _ = SemaphoreGroupManager.shared.ensureGroupFromInvite(id: groupUUID, name: groupModel.name, root: groupModel.merkleRoot)
    SemaphoreGroupManager.shared.selectGroup(groupUUID)
    SemaphoreGroupManager.shared.addMember(identity.commitment)
    print("[CloudKitManager] Added member to Semaphore Group")

    // Wait for root computation
    try? await Task.sleep(nanoseconds: 100_000_000)

    if let updatedRoot = SemaphoreGroupManager.shared.merkleRoot {
      print("[CloudKitManager] Updating merkle root in CloudKit: \(updatedRoot)")
      if let updatedGroupRecord = try? await publicDB.record(for: groupRecordID) {
        updatedGroupRecord["merkleRoot"] = updatedRoot
        _ = try? await publicDB.save(updatedGroupRecord)
        print("[CloudKitManager] Merkle root synced to CloudKit")

        groupModel.merkleRoot = updatedRoot
        if let index = self.groups.firstIndex(where: { $0.id == groupModel.id }) {
          self.groups[index].merkleRoot = updatedRoot
          saveGroupsToLocal()
        }
      }
    }
  }

  func leaveGroup(_ group: GroupModel) async throws {
    if group.isPrivate {
      // Leave CKShare
      // Complex, requires removing self from participants
    } else {
      guard let userID = currentUserRecordID else { return }
      let predicate = NSPredicate(
        format: "group == %@ AND userRecordID == %@",
        CKRecord.Reference(recordID: CKRecord.ID(recordName: group.id), action: .none),
        CKRecord.Reference(recordID: userID, action: .none)
      )
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

    let predicate = NSPredicate(
      format: "group == %@ AND userRecordID == %@",
      CKRecord.Reference(recordID: CKRecord.ID(recordName: group.id), action: .none),
      CKRecord.Reference(recordID: CKRecord.ID(recordName: userId), action: .none)
    )
    let query = CKQuery(recordType: CloudKitRecordType.groupMembership, predicate: predicate)
    let (results, _) = try await publicDB.records(matching: query)

    guard let match = results.first, case .success(let record) = match.1 else {
      throw NSError(domain: "GroupError", code: 404, userInfo: [NSLocalizedDescriptionKey: "Member not found"])
    }

    record["status"] = "kicked"
    try await publicDB.save(record)
    print("[CloudKitManager] Member kicked successfully")
  }

  func approveMember(userId: String, from group: GroupModel) async throws {
    print("[CloudKitManager] Approving member \(userId) for group \(group.name)")
    try await updateMemberStatus(userId: userId, group: group, status: "active")
  }

  func rejectMember(userId: String, from group: GroupModel) async throws {
    print("[CloudKitManager] Rejecting member \(userId) from group \(group.name)")
    try await kickMember(userId: userId, from: group)
  }

  internal func updateMemberStatus(userId: String, group: GroupModel, status: String) async throws {
    let predicate = NSPredicate(
      format: "group == %@ AND userRecordID == %@",
      CKRecord.Reference(recordID: CKRecord.ID(recordName: group.id), action: .none),
      CKRecord.Reference(recordID: CKRecord.ID(recordName: userId), action: .none)
    )
    let query = CKQuery(recordType: CloudKitRecordType.groupMembership, predicate: predicate)
    let (results, _) = try await publicDB.records(matching: query)

    guard let match = results.first, case .success(let record) = match.1 else {
      throw NSError(domain: "GroupError", code: 404, userInfo: [NSLocalizedDescriptionKey: "Member not found"])
    }

    record["status"] = status
    try await publicDB.save(record)
    print("[CloudKitManager] Member status updated to \(status)")
  }
}
