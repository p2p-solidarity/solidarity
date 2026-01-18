//
//  CloudKitGroupSyncManager.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import CloudKit
import Combine
import Foundation

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

  internal let container = CKContainer.default()
  internal var privateDB: CKDatabase { container.privateCloudDatabase }
  internal var sharedDB: CKDatabase { container.sharedCloudDatabase }
  // Using Public DB for Invites to make them accessible by token query without prior sharing setup
  internal var publicDB: CKDatabase { container.publicCloudDatabase }

  @Published var groups: [GroupModel] = []
  @Published var currentUserRecordID: CKRecord.ID?
  @Published var isAuthenticated = false
  @Published var accountStatus: CKAccountStatus = .couldNotDetermine

  private init() {
    loadGroupsFromLocal()
    Task {
      await checkAccountStatus()
    }
  }

  internal let zoneName = "AirMeishiGroups"
  internal var customZoneID: CKRecordZone.ID {
    CKRecordZone.ID(zoneName: zoneName, ownerName: CKCurrentUserDefaultName)
  }

  // MARK: - Local Caching

  // Removed JSON caching in favor of SwiftData via LocalCacheManager

  internal func saveGroupsToLocal() {
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

  func fetchLatestChanges() async throws {
    print("[CloudKitManager] Fetching latest changes...")
    await MainActor.run { self.syncStatus = .syncing }

    guard let userID = currentUserRecordID else {
      print("[CloudKitManager] Fetch aborted: No User ID")
      await MainActor.run { self.syncStatus = .idle }
      return
    }

    let fetchedPublicGroups = await fetchPublicGroups(userID: userID)
    let fetchedPrivateAndSharedGroups = await fetchPrivateAndSharedGroups()

    let allFetchedGroups = fetchedPublicGroups + fetchedPrivateAndSharedGroups

    let mergedGroups = mergeGroups(cloudGroups: allFetchedGroups, localGroups: self.groups)

    syncMerkleRoots(groups: mergedGroups)

    self.groups = mergedGroups
    saveGroupsToLocal()
    print("[CloudKitManager] Successfully updated groups. Total: \(self.groups.count)")
    await MainActor.run { self.syncStatus = .idle }
  }
  // MARK: - Sync Helpers

  private func fetchPublicGroups(userID: CKRecord.ID) async -> [GroupModel] {
    var fetchedGroups: [GroupModel] = []
    let publicPredicate = NSPredicate(format: "userRecordID == %@", userID)
    let publicQuery = CKQuery(recordType: CloudKitRecordType.groupMembership, predicate: publicPredicate)
    do {
      let (matchResults, _) = try await publicDB.records(matching: publicQuery)
      for result in matchResults {
        if case .success(let record) = result.1,
          let groupRef = record["group"] as? CKRecord.Reference
        {
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
    return fetchedGroups
  }

  private func fetchPrivateAndSharedGroups() async -> [GroupModel] {
    var fetchedGroups: [GroupModel] = []

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

    return fetchedGroups
  }

  private func mergeGroups(cloudGroups: [GroupModel], localGroups: [GroupModel]) -> [GroupModel] {
    var mergedGroups: [GroupModel] = []
    let localGroupsMap = Dictionary(uniqueKeysWithValues: localGroups.map { ($0.id, $0) })

    for cloudGroup in cloudGroups {
      if let localGroup = localGroupsMap[cloudGroup.id] {
        if !localGroup.isSynced {
          // Local has unsynced changes. Keep Local.
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

    // Keep local-only groups
    for localGroup in localGroups where !mergedGroups.contains(where: { $0.id == localGroup.id }) {
      print("[CloudKitManager] Keeping local-only group: \(localGroup.name)")
      mergedGroups.append(localGroup)
    }

    return mergedGroups
  }

  private func syncMerkleRoots(groups: [GroupModel]) {
    for group in groups {
      if let groupUUID = UUID(uuidString: group.id) {
        _ = SemaphoreGroupManager.shared.ensureGroupFromInvite(
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
  }

  // MARK: - Data Access

  func getAllGroups() -> [GroupModel] {
    return groups
  }

  // MARK: - Helpers

  internal func mapRecordToGroup(_ record: CKRecord) -> GroupModel? {
    guard let name = record["name"] as? String,
      let ownerRef = record["ownerRecordID"] as? CKRecord.Reference
    else { return nil }

    return GroupModel(
      id: record.recordID.recordName,
      name: name,
      description: record["description"] as? String ?? "",
      coverImage: nil,
      ownerRecordID: ownerRef.recordID.recordName,
      merkleRoot: record["merkleRoot"] as? String,
      merkleTreeDepth: record["merkleTreeDepth"] as? Int ?? 20,
      memberCount: record["memberCount"] as? Int ?? 0,
      isPrivate: false,  // Default, overridden by caller
      credentialIssuers: (record["credentialIssuers"] as? [String]) ?? []
    )
  }
}
