//
//  ProximityManager+Types.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import Foundation
import MultipeerConnectivity

extension ProximityManager {
  struct PendingGroupJoinResponse {
    let invite: GroupInvitePayload
    let memberName: String
    let memberCommitment: String
    let peerID: MCPeerID
  }

  enum DiscoveryState: Equatable {
    case idle
    case scanning
    case connecting(ProximityPeer)
    case connected(ProximityPeer)
    case error(String)
  }
}

// MARK: - Supporting Types

/// Represents a nearby peer discovered through Multipeer Connectivity
struct ProximityPeer: Identifiable, Equatable {
  let id = UUID()
  let peerID: MCPeerID
  let discoveryInfo: [String: String]
  let discoveredAt: Date
  var status: ProximityPeerStatus = .disconnected
  var verification: VerificationStatus?

  var name: String {
    return peerID.displayName
  }

  var cardName: String? {
    return discoveryInfo["name"]
  }

  var cardTitle: String? {
    return discoveryInfo["title"]
  }

  var cardCompany: String? {
    return discoveryInfo["company"]
  }

  var sharingLevel: SharingLevel {
    if let levelString = discoveryInfo["level"],
      let level = SharingLevel(rawValue: levelString)
    {
      return level
    }
    return .professional
  }

  static func == (lhs: ProximityPeer, rhs: ProximityPeer) -> Bool {
    return lhs.peerID == rhs.peerID
  }
}

/// Status of a proximity peer connection
enum ProximityPeerStatus: String, CaseIterable {
  case disconnected = "Disconnected"
  case connecting = "Connecting"
  case connected = "Connected"

  var systemImageName: String {
    switch self {
    case .disconnected: return "circle"
    case .connecting: return "circle.dotted"
    case .connected: return "circle.fill"
    }
  }

  var color: String {
    switch self {
    case .disconnected: return "gray"
    case .connecting: return "orange"
    case .connected: return "green"
    }
  }
}

/// Overall connection status for proximity sharing
enum ProximityConnectionStatus: String, CaseIterable {
  case disconnected = "Disconnected"
  case advertising = "Advertising"
  case browsing = "Browsing"
  case advertisingAndBrowsing = "Advertising & Browsing"
  case connected = "Connected"

  var displayName: String {
    return self.rawValue
  }

  var systemImageName: String {
    switch self {
    case .disconnected: return "wifi.slash"
    case .advertising: return "dot.radiowaves.left.and.right"
    case .browsing: return "magnifyingglass"
    case .advertisingAndBrowsing: return "dot.radiowaves.up.forward"
    case .connected: return "wifi"
    }
  }
}

/// Current sharing status information
struct ProximitySharingStatus {
  let isAdvertising: Bool
  let isBrowsing: Bool
  let connectedPeersCount: Int
  let nearbyPeersCount: Int
  let currentCard: BusinessCard?
  let sharingLevel: SharingLevel
}

/// Represents a pending incoming invitation that awaits user consent
struct PendingInvitation {
  let peerID: MCPeerID
  let receivedAt: Date
}
