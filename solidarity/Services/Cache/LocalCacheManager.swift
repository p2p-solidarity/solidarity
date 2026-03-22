//
//  LocalCacheManager.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import Foundation
import SwiftData

@MainActor
final class LocalCacheManager {
  static let shared = LocalCacheManager()

  private let modelContainer: ModelContainer
  private let modelContext: ModelContext

  private init() {
    // Use a specific file URL to isolate the cache and allow for versioning/resetting
    let url = URL.documentsDirectory.appending(path: "AirMeishiCache_v2.store")
    // Explicitly disable CloudKit sync to avoid strict schema requirements (all optionals, no unique constraints)
    let modelConfiguration = ModelConfiguration(url: url, cloudKitDatabase: .none)

    do {
      // Option 2: Use simpler Schema creation (Auto-detection)
      self.modelContainer = try ModelContainer(
        for: GroupEntity.self,
        MemberEntity.self,
        configurations: modelConfiguration
      )
      self.modelContext = modelContainer.mainContext
      print("[LocalCacheManager] Successfully initialized with persistent store at: \(url.path)")
    } catch {
      print(
        "[LocalCacheManager] Failed to create persistent ModelContainer: \(error). Falling back to in-memory store."
      )

      // Fallback: In-Memory Store
      let memoryConfiguration = ModelConfiguration(isStoredInMemoryOnly: true, cloudKitDatabase: .none)
      do {
        self.modelContainer = try ModelContainer(
          for: GroupEntity.self,
          MemberEntity.self,
          configurations: memoryConfiguration
        )
        self.modelContext = modelContainer.mainContext
        print("[LocalCacheManager] Initialized with IN-MEMORY store.")
      } catch {
        print("[LocalCacheManager] CRITICAL: Failed to create in-memory container")
        print("Error type: \(type(of: error))")
        print("Error description: \(error)")
        // Check for SwiftData specific errors if possible, though SwiftDataError might not be publicly exposing everything.
        // We print the error description which usually contains enough info.
        fatalError("[LocalCacheManager] Critical Error: Could not create even in-memory ModelContainer: \(error)")
      }
    }
  }

  // MARK: - Groups

  func fetchGroups() -> [GroupModel] {
    do {
      let descriptor = FetchDescriptor<GroupEntity>()
      let entities = try modelContext.fetch(descriptor)
      return entities.map { $0.toModel() }
    } catch {
      print("[LocalCacheManager] Failed to fetch groups: \(error)")
      return []
    }
  }

  func saveGroups(_ groups: [GroupModel]) {
    do {
      // For simplicity in this sync flow, we might want to upsert.
      // But since CloudKitSyncManager often replaces the whole list or appends,
      // let's handle upsert logic.

      for group in groups {
        let groupID = group.id
        let descriptor = FetchDescriptor<GroupEntity>(predicate: #Predicate { $0.id == groupID })
        let existing = try modelContext.fetch(descriptor).first

        if let existing {
          existing.update(from: group)
        } else {
          let newEntity = GroupEntity(
            id: group.id,
            name: group.name,
            description: group.description,
            coverImage: group.coverImage,
            ownerRecordID: group.ownerRecordID,
            merkleRoot: group.merkleRoot,
            merkleTreeDepth: group.merkleTreeDepth,
            memberCount: group.memberCount,
            isPrivate: group.isPrivate,
            credentialIssuers: group.credentialIssuers,
            isSynced: group.isSynced
          )
          modelContext.insert(newEntity)
        }
      }
      try modelContext.save()
      print("[LocalCacheManager] Saved \(groups.count) groups to SwiftData")
    } catch {
      print("[LocalCacheManager] Failed to save groups: \(error)")
    }
  }

  func deleteGroup(_ groupID: String) {
    do {
      let descriptor = FetchDescriptor<GroupEntity>(predicate: #Predicate { $0.id == groupID })
      if let entity = try modelContext.fetch(descriptor).first {
        modelContext.delete(entity)
        try modelContext.save()
      }
    } catch {
      print("[LocalCacheManager] Failed to delete group: \(error)")
    }
  }

  // MARK: - Members

  func fetchMembers(for groupID: String) -> [GroupMemberModel] {
    do {
      let descriptor = FetchDescriptor<MemberEntity>(predicate: #Predicate { $0.groupID == groupID })
      let entities = try modelContext.fetch(descriptor)
      return entities.map { $0.toModel() }
    } catch {
      print("[LocalCacheManager] Failed to fetch members: \(error)")
      return []
    }
  }

  func saveMembers(_ members: [GroupMemberModel], for groupID: String) {
    do {
      // Fetch group entity to set relationship
      let groupDescriptor = FetchDescriptor<GroupEntity>(predicate: #Predicate { $0.id == groupID })
      guard let groupEntity = try modelContext.fetch(groupDescriptor).first else {
        print("[LocalCacheManager] Cannot save members: Group \(groupID) not found")
        return
      }

      for member in members {
        let memberID = member.id
        let descriptor = FetchDescriptor<MemberEntity>(predicate: #Predicate { $0.id == memberID })
        let existing = try modelContext.fetch(descriptor).first

        if let existing {
          existing.update(from: member)
          existing.group = groupEntity  // Ensure relationship
        } else {
          let newEntity = MemberEntity(
            id: member.id,
            groupID: member.groupID,
            userRecordID: member.userRecordID,
            role: member.role.rawValue,
            status: member.status.rawValue,
            merkleIndex: member.merkleIndex,
            joinedAt: member.joinedAt,
            sealedRoute: member.sealedRoute,
            pubKey: member.pubKey,
            signPubKey: member.signPubKey,
            deviceToken: member.deviceToken,
            commitment: member.commitment
          )
          newEntity.group = groupEntity
          modelContext.insert(newEntity)
        }
      }
      try modelContext.save()
      print("[LocalCacheManager] Saved \(members.count) members for group \(groupID)")
    } catch {
      print("[LocalCacheManager] Failed to save members: \(error)")
    }
  }
}
