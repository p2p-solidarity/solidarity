import Foundation
import Combine

@MainActor
final class GroupProximityManager: ObservableObject {
    static let shared = GroupProximityManager()
    
    private let groupSyncManager = CloudKitGroupSyncManager.shared
    private let proximityManager = ProximityManager.shared
    
    // MARK: - Sending Group Credentials
    
    /// Sends a Group Credential via Proximity (Owner only)
    /// - Parameters:
    ///   - credentialCard: The BusinessCard containing the Group Credential
    ///   - group: The Group context
    ///   - members: Target members to send to
    func sendGroupCredentialViaProximity(
        credentialCard: BusinessCard,
        group: GroupModel,
        to members: [GroupMemberModel]
    ) async throws {
        // 1. Permission Check: Only authorized issuers can initiate proximity distribution of Group VCs
        guard let currentUser = groupSyncManager.currentUserRecordID,
              group.canIssueCredentials(userRecordID: currentUser.recordName) else {
            throw GroupCredentialError.permissionDenied
        }
        
        // 2. Get Messaging Data (including device tokens for proximity)
        // Note: We need to implement getMembersMessagingData in CloudKitGroupSyncManager
        let messagingData = try await groupSyncManager.getMembersMessagingData(
            for: group,
            includeDeviceTokens: true // Owner needs device tokens for proximity routing
        )
        
        // 3. Filter for target members
        let targetUserIds = Set(members.map { $0.userRecordID })
        let targets = messagingData.filter { targetUserIds.contains($0.userRecordID) }
        
        // 4. Send to each target
        let deliveryService = GroupCredentialDeliveryService.shared
        for target in targets {
            if target.hasMessagingData {
                // Use DeliveryService to send via Sakura (since we have sealedRoute)
                // ProximityManager is for P2P BLE, which requires a session.
                // If we want to "push" to a remote user via APNs/Sakura, we use DeliveryService.
                try await deliveryService.sendCredential(
                    credentialCard,
                    to: target.userRecordID,
                    via: .sakura,
                    group: group
                )
            }
        }
    }
    
    /// Sends a Group Credential to exchanged contacts (Member to Member)
    /// This is used when a member wants to share the Group VC with another member they already know.
    func sendGroupCredentialToExchangedContacts(
        credentialCard: BusinessCard,
        group: GroupModel
    ) async throws {
        // 1. Get members we have exchanged cards with
        // We need a way to cross-reference group members with local contacts
        // This logic will be refined when we integrate ContactRepository
        
        // Placeholder logic:
        // let exchangedMembers = try await contactRepository.getExchangedMembers(for: group)
        // for member in exchangedMembers { ... send ... }
    }
}
