//
//  GroupEntities.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import Foundation
import SwiftData

@Model
final class GroupEntity {
    @Attribute(.unique) var id: String
    var name: String
    var groupDescription: String // 'description' is a reserved word in some contexts, safer to use groupDescription or just description if SwiftData allows. SwiftData usually handles it, but let's stick to 'description' and see if it conflicts with CustomStringConvertible. Actually, let's use 'desc' or keep it 'description' but be careful.
    var coverImage: Data?
    var ownerRecordID: String
    var merkleRoot: String?
    var merkleTreeDepth: Int
    var memberCount: Int
    var isPrivate: Bool
    var isSynced: Bool
    var credentialIssuers: [String] = []
    
    @Relationship(deleteRule: .cascade, inverse: \MemberEntity.group)
    var members: [MemberEntity] = []
    
    init(id: String, 
         name: String, 
         description: String, 
         coverImage: Data? = nil, 
         ownerRecordID: String, 
         merkleRoot: String? = nil, 
         merkleTreeDepth: Int = 20, 
         memberCount: Int = 1, 
         isPrivate: Bool = false, 
         credentialIssuers: [String] = [], 
         isSynced: Bool = true) {
        self.id = id
        self.name = name
        self.groupDescription = description
        self.coverImage = coverImage
        self.ownerRecordID = ownerRecordID
        self.merkleRoot = merkleRoot
        self.merkleTreeDepth = merkleTreeDepth
        self.memberCount = memberCount
        self.isPrivate = isPrivate
        self.credentialIssuers = credentialIssuers
        self.isSynced = isSynced
    }
    
    // Mapper to Domain Model
    func toModel() -> GroupModel {
        return GroupModel(
            id: id,
            name: name,
            description: groupDescription,
            coverImage: coverImage,
            ownerRecordID: ownerRecordID,
            merkleRoot: merkleRoot,
            merkleTreeDepth: merkleTreeDepth,
            memberCount: memberCount,
            isPrivate: isPrivate,
            credentialIssuers: credentialIssuers,
            isSynced: isSynced
        )
    }
    
    // Update from Domain Model
    func update(from model: GroupModel) {
        self.name = model.name
        self.groupDescription = model.description
        self.coverImage = model.coverImage
        self.ownerRecordID = model.ownerRecordID
        self.merkleRoot = model.merkleRoot
        self.merkleTreeDepth = model.merkleTreeDepth
        self.memberCount = model.memberCount
        self.isPrivate = model.isPrivate
        self.credentialIssuers = model.credentialIssuers
        self.isSynced = model.isSynced
    }
}

@Model
final class MemberEntity {
    @Attribute(.unique) var id: String
    var groupID: String
    var userRecordID: String
    var role: String
    var status: String
    var merkleIndex: Int
    var joinedAt: Date
    
    // Secure Messaging Data
    var sealedRoute: String?
    var pubKey: String?
    var signPubKey: String?
    var deviceToken: String?
    var commitment: String?
    
    var group: GroupEntity?
    
    init(id: String,
         groupID: String,
         userRecordID: String,
         role: String,
         status: String,
         merkleIndex: Int,
         joinedAt: Date,
         sealedRoute: String? = nil,
         pubKey: String? = nil,
         signPubKey: String? = nil,
         deviceToken: String? = nil,
         commitment: String? = nil) {
        self.id = id
        self.groupID = groupID
        self.userRecordID = userRecordID
        self.role = role
        self.status = status
        self.merkleIndex = merkleIndex
        self.joinedAt = joinedAt
        self.sealedRoute = sealedRoute
        self.pubKey = pubKey
        self.signPubKey = signPubKey
        self.deviceToken = deviceToken
        self.commitment = commitment
    }
    
    func toModel() -> GroupMemberModel {
        var member = GroupMemberModel(
            id: id,
            groupID: groupID,
            userRecordID: userRecordID,
            role: GroupMemberModel.Role(rawValue: role) ?? .member,
            status: GroupMemberModel.Status(rawValue: status) ?? .active,
            merkleIndex: merkleIndex,
            joinedAt: joinedAt
        )
        member.sealedRoute = sealedRoute
        member.pubKey = pubKey
        member.signPubKey = signPubKey
        member.deviceToken = deviceToken
        member.commitment = commitment
        return member
    }
    
    func update(from model: GroupMemberModel) {
        self.role = model.role.rawValue
        self.status = model.status.rawValue
        self.merkleIndex = model.merkleIndex
        self.joinedAt = model.joinedAt
        self.sealedRoute = model.sealedRoute
        self.pubKey = model.pubKey
        self.signPubKey = model.signPubKey
        self.deviceToken = model.deviceToken
        self.commitment = model.commitment
    }
}
