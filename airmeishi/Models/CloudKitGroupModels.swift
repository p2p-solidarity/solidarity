//
//  CloudKitGroupModels.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import Foundation
import CloudKit

// MARK: - Record Types
enum CloudKitRecordType {
    static let group = "Group"
    static let groupMembership = "GroupMembership"
    static let groupInvite = "GroupInvite"
    static let userIdentity = "UserIdentity"
}

// MARK: - Models

struct GroupModel: Identifiable, Hashable, Codable {
    let id: String // Record Name
    var name: String
    var description: String
    var coverImage: Data?
    var ownerRecordID: String
    var merkleRoot: String?
    var merkleTreeDepth: Int
    var memberCount: Int
    var isPrivate: Bool
    
    // Local metadata
    var isSynced: Bool = true
    
    init(id: String = UUID().uuidString,
         name: String,
         description: String = "",
         coverImage: Data? = nil,
         ownerRecordID: String,
         merkleRoot: String? = nil,
         merkleTreeDepth: Int = 20,
         memberCount: Int = 1,
         isPrivate: Bool = false,
         isSynced: Bool = true) {
        self.id = id
        self.name = name
        self.description = description
        self.coverImage = coverImage
        self.ownerRecordID = ownerRecordID
        self.merkleRoot = merkleRoot
        self.merkleTreeDepth = merkleTreeDepth
        self.memberCount = memberCount
        self.isPrivate = isPrivate
        self.isSynced = isSynced
    }
}

struct GroupMemberModel: Identifiable, Hashable {
    let id: String // Record Name
    let groupID: String
    let userRecordID: String
    let role: Role
    let status: Status
    let merkleIndex: Int
    let joinedAt: Date
    
    enum Role: String, Codable {
        case owner
        case member
    }
    
    enum Status: String, Codable {
        case active
        case pending
        case left
        case kicked
    }
}

struct GroupInviteModel: Identifiable {
    let id: String
    let token: String
    let targetGroupID: String
    let isActive: Bool
    let createdBy: String
}
