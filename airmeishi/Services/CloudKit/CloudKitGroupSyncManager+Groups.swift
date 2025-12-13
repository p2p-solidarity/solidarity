//
//  CloudKitGroupSyncManager+Groups.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import CloudKit
import Foundation

extension CloudKitGroupSyncManager {

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

  internal func createPublicGroup(
    name: String,
    description: String,
    coverImage: Data?,
    userID: CKRecord.ID
  ) async throws -> GroupModel {
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

    _ = try await publicDB.modifyRecords(saving: [groupRecord, membershipRecord], deleting: [])

    guard var newGroup = mapRecordToGroup(groupRecord) else {
      throw NSError(
        domain: "GroupError",
        code: 500,
        userInfo: [NSLocalizedDescriptionKey: "Failed to map group record"]
      )
    }
    newGroup.isPrivate = false
    self.groups.append(newGroup)
    saveGroupsToLocal()
    return newGroup
  }

  internal func createPrivateGroup(
    name: String,
    description: String,
    coverImage: Data?,
    userID: CKRecord.ID
  ) async throws -> GroupModel {
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

    guard var newGroup = mapRecordToGroup(groupRecord) else {
      throw NSError(
        domain: "GroupError",
        code: 500,
        userInfo: [NSLocalizedDescriptionKey: "Failed to map group record"]
      )
    }
    newGroup.isPrivate = true
    self.groups.append(newGroup)
    saveGroupsToLocal()
    return newGroup
  }

  func updateGroup(_ group: GroupModel, name: String?, description: String?) async throws {
    let db = group.isPrivate ? privateDB : publicDB
    let recordID = CKRecord.ID(
      recordName: group.id,
      zoneID: group.isPrivate ? customZoneID : CKRecordZone.default().zoneID
    )

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
    let recordID = CKRecord.ID(
      recordName: group.id,
      zoneID: group.isPrivate ? customZoneID : CKRecordZone.default().zoneID
    )
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
    guard group.isPrivate else {
      throw NSError(
        domain: "GroupError",
        code: 400,
        userInfo: [NSLocalizedDescriptionKey: "Cannot share public group via CKShare"]
      )
    }

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
}
