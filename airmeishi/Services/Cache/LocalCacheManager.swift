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
        do {
            let schema = Schema([
                GroupEntity.self,
                MemberEntity.self
            ])
            let modelConfiguration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)
            self.modelContainer = try ModelContainer(for: schema, configurations: [modelConfiguration])
            self.modelContext = modelContainer.mainContext
        } catch {
            fatalError("Could not create ModelContainer: \(error)")
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
                    existing.group = groupEntity // Ensure relationship
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
