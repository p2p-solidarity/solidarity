//
//  ProximityEvents.swift
//  airmeishi
//
//  Global notification names for proximity matching so multiple views can react.
//

import Foundation

extension Notification.Name {
    static let matchingPeerListUpdated = Notification.Name("matchingPeerListUpdated")
    static let matchingConnectionStatusChanged = Notification.Name("matchingConnectionStatusChanged")
    static let matchingReceivedCard = Notification.Name("matchingReceivedCard")
    static let matchingError = Notification.Name("matchingError")
    static let groupInviteReceived = Notification.Name("groupInviteReceived")
    static let groupJoinAccepted = Notification.Name("groupJoinAccepted")
    static let groupMembershipUpdated = Notification.Name("groupMembershipUpdated")

    // New: secure Sakura message arrived (after /sync + decrypt)
    static let secureMessageReceived = Notification.Name("secureMessageReceived")
}

enum ProximityEventKey {
    static let peers = "peers"
    static let status = "status"
    static let card = "card"
    static let error = "error"
    static let invite = "invite"
    static let peerID = "peerID"
    static let groupId = "groupId"
}

// New: userInfo keys for Sakura message events
enum MessageEventKey {
    static let senderName = "senderName"
    static let text = "text"
}
