//
//  CloudKitGroupSyncManager+Invite.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import Foundation
import CloudKit

extension CloudKitGroupSyncManager {
    
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
}
