//
//  GroupCredentialDeliveryService.swift
//  airmeishi
//
//  Handles the delivery of Group Verifiable Credentials via various methods (Sakura, Proximity, etc.)
//

import Foundation
import Combine

enum GroupCredentialDeliveryError: Error {
    case deliveryError(String)
    case memberNotFound
    case missingMessagingData
}

@MainActor
final class GroupCredentialDeliveryService: ObservableObject {
    static let shared = GroupCredentialDeliveryService()
    
    private let messageService = MessageService.shared
    private let proximityManager = ProximityManager.shared
    private let groupManager = CloudKitGroupSyncManager.shared
    
    func sendCredential(
        _ credentialCard: BusinessCard,
        to memberId: String,
        via method: GroupCredentialDeliverySettings.DeliveryMethod,
        group: GroupModel
    ) async throws {
        switch method {
        case .sakura:
            try await sendViaSakura(credentialCard, to: memberId, group: group)
        case .proximity:
            // Proximity requires peer to be nearby and connected.
            // This is usually initiated by the user selecting a peer in the Proximity view.
            // Automated sending to a specific member ID via Proximity is difficult unless we map MemberID -> PeerID.
            // For now, we throw an error if trying to send to a specific member ID via Proximity without peer context.
            throw GroupCredentialDeliveryError.deliveryError("Proximity delivery requires direct peer interaction. Please use the Proximity view.")
        case .qrCode:
            // QR Code is handled by UI (user scans)
            break
        case .airdrop:
            // AirDrop is handled by UI
            break
        }
    }
    
    private func sendViaSakura(
        _ credentialCard: BusinessCard,
        to memberId: String,
        group: GroupModel
    ) async throws {
        // Get member's messaging data
        // We fetch fresh data to ensure we have the latest keys/route
        let members = try await groupManager.getMembersMessagingData(for: group, includeDeviceTokens: false)
        
        guard let member = members.first(where: { $0.userRecordID == memberId }) else {
            throw GroupCredentialDeliveryError.memberNotFound
        }
        
        guard let sealedRoute = member.sealedRoute,
              let pubKey = member.pubKey,
              let signPubKey = member.signPubKey else {
            throw GroupCredentialDeliveryError.missingMessagingData
        }
        
        // Create SecureContact for MessageService
        let contact = SecureContact(
            name: memberId, // Use member ID or name as identifier
            pubKey: pubKey,
            signPubKey: signPubKey,
            sealedRoute: sealedRoute
        )
        
        // Encode credential card as JSON
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let cardData = try encoder.encode(credentialCard)
        
        guard let cardJSON = String(data: cardData, encoding: .utf8) else {
            throw GroupCredentialDeliveryError.deliveryError("Failed to encode credential card")
        }
        
        // Send via MessageService
        // Note: MessageService.sendMessage usually takes text. We send the JSON.
        // The recipient needs to detect this is a VC.
        // Ideally, we should wrap this in a structured message, but for MVP we send raw JSON or a specific prefix.
        // Let's use a prefix to help the recipient identify it.
        let messageText = "AIRMEISHI_VC::\(cardJSON)"
        
        try await messageService.sendMessage(to: contact, text: messageText)
    }
}
