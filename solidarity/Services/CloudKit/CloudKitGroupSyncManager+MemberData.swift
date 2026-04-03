//
//  CloudKitGroupSyncManager+MemberData.swift
//  solidarity
//
//  Created by Solidarity Team.
//

import CloudKit
import Foundation

extension CloudKitGroupSyncManager {

  // MARK: - Data Access

  func getMembers(for group: GroupModel) async throws -> [GroupMemberModel] {
    if group.isPrivate {
      return []
    } else {
      let predicate = NSPredicate(
        format: "group == %@ AND status == %@",
        CKRecord.Reference(recordID: CKRecord.ID(recordName: group.id), action: .none),
        "active"
      )
      let query = CKQuery(recordType: CloudKitRecordType.groupMembership, predicate: predicate)
      query.sortDescriptors = [NSSortDescriptor(key: "joinedAt", ascending: true)]

      let (results, _) = try await publicDB.records(matching: query)
      let members = results.compactMap { result -> GroupMemberModel? in
        guard case .success(let record) = result.1 else { return nil }
        return mapRecordToMember(record)
      }

      if members.count != group.memberCount {
        print("[CloudKitManager] Local member count mismatch. Updating local group model.")
        if let index = self.groups.firstIndex(where: { $0.id == group.id }) {
          self.groups[index].memberCount = members.count
          saveGroupsToLocal()
        }
      }

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

    record["sealedRoute"] = sealedRoute
    record["pubKey"] = pubKey
    record["signPubKey"] = signPubKey

    try await publicDB.save(record)
    print("[CloudKitManager] Updated messaging data for member \(userId)")
  }

  func getMembersMessagingData(
    for group: GroupModel,
    includeDeviceTokens: Bool = false
  ) async throws -> [GroupMemberModel] {
    if includeDeviceTokens {
      guard let currentUser = currentUserRecordID, group.ownerRecordID == currentUser.recordName else {
        throw CKError(.permissionFailure)
      }
    }

    let members = try await getActiveMembers(for: group)

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
      group.ownerRecordID == currentUser.recordName
    else {
      throw CKError(CKError.Code.permissionFailure)
    }

    var updatedGroup = group
    if !updatedGroup.credentialIssuers.contains(userId) {
      updatedGroup.credentialIssuers.append(userId)
    }

    let db = group.isPrivate ? privateDB : publicDB
    let recordID = CKRecord.ID(
      recordName: group.id,
      zoneID: group.isPrivate ? customZoneID : CKRecordZone.default().zoneID
    )
    let record = try await db.record(for: recordID)
    record["credentialIssuers"] = updatedGroup.credentialIssuers

    try await db.save(record)

    if let index = groups.firstIndex(where: { $0.id == group.id }) {
      groups[index].credentialIssuers = updatedGroup.credentialIssuers
      saveGroupsToLocal()
    }
  }

  func removeCredentialIssuer(userId: String, from group: GroupModel) async throws {
    guard let currentUser = currentUserRecordID,
      group.ownerRecordID == currentUser.recordName
    else {
      throw CKError(CKError.Code.permissionFailure)
    }

    var updatedGroup = group
    updatedGroup.credentialIssuers.removeAll { $0 == userId }

    let db = group.isPrivate ? privateDB : publicDB
    let recordID = CKRecord.ID(
      recordName: group.id,
      zoneID: group.isPrivate ? customZoneID : CKRecordZone.default().zoneID
    )
    let record = try await db.record(for: recordID)
    record["credentialIssuers"] = updatedGroup.credentialIssuers

    try await db.save(record)

    if let index = groups.firstIndex(where: { $0.id == group.id }) {
      groups[index].credentialIssuers = updatedGroup.credentialIssuers
      saveGroupsToLocal()
    }
  }

  // MARK: - Record Mapping

  internal func mapRecordToMember(_ record: CKRecord) -> GroupMemberModel? {
    guard let groupRef = record["group"] as? CKRecord.Reference,
      let userRef = record["userRecordID"] as? CKRecord.Reference,
      let roleStr = record["role"] as? String,
      let statusStr = record["status"] as? String
    else { return nil }

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
    member.deviceToken = record["deviceToken"] as? String
    member.commitment = record["commitment"] as? String

    return member
  }
}
