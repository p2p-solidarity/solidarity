//
//  OfflineManager+Types.swift
//  solidarity
//
//  Supporting types and operation executors for OfflineManager
//

import Foundation

// MARK: - Operation Executors

extension OfflineManager {

  func executeWalletPassGeneration(_ operation: PendingOperation) -> CardResult<OperationResult> {
    return .success(
      OperationResult(
        operationId: operation.id,
        type: operation.type,
        success: true,
        error: nil,
        executedAt: Date()
      )
    )
  }

  func executeDomainVerification(_ operation: PendingOperation) -> CardResult<OperationResult> {
    return .success(
      OperationResult(
        operationId: operation.id,
        type: operation.type,
        success: true,
        error: nil,
        executedAt: Date()
      )
    )
  }

  func executeDataSync(_ operation: PendingOperation) -> CardResult<OperationResult> {
    UserDefaults.standard.set(Date(), forKey: "last_sync_attempt")

    return .success(
      OperationResult(
        operationId: operation.id,
        type: operation.type,
        success: true,
        error: nil,
        executedAt: Date()
      )
    )
  }

  func executeWalletPassUpdate(_ operation: PendingOperation) -> CardResult<OperationResult> {
    return .success(
      OperationResult(
        operationId: operation.id,
        type: operation.type,
        success: true,
        error: nil,
        executedAt: Date()
      )
    )
  }
}

// MARK: - Supporting Types

enum ConnectionType: String, Codable, CaseIterable {
  case none = "None"
  case wifi = "Wi-Fi"
  case cellular5G = "5G"
  case cellular4G = "4G"
  case cellular3G = "3G"
  case cellular2G = "2G"

  var displayName: String {
    return self.rawValue
  }

  var systemImageName: String {
    switch self {
    case .none: return "wifi.slash"
    case .wifi: return "wifi"
    case .cellular5G: return "antenna.radiowaves.left.and.right"
    case .cellular4G: return "antenna.radiowaves.left.and.right"
    case .cellular3G: return "antenna.radiowaves.left.and.right"
    case .cellular2G: return "antenna.radiowaves.left.and.right"
    }
  }
}

enum OperationType: String, Codable, CaseIterable {
  case createBusinessCard = "Create Business Card"
  case updateBusinessCard = "Update Business Card"
  case deleteBusinessCard = "Delete Business Card"
  case addContact = "Add Contact"
  case updateContact = "Update Contact"
  case deleteContact = "Delete Contact"
  case generateQRCode = "Generate QR Code"
  case scanQRCode = "Scan QR Code"
  case generateProof = "Generate Proof"
  case verifyProof = "Verify Proof"
  case encryptData = "Encrypt Data"
  case decryptData = "Decrypt Data"
  case generateWalletPass = "Generate Wallet Pass"
  case verifyDomain = "Verify Domain"
  case syncData = "Sync Data"
  case updateWalletPass = "Update Wallet Pass"

  var displayName: String {
    return self.rawValue
  }
}

struct PendingOperation: Codable, Identifiable {
  let id: String
  let type: OperationType
  let data: [String: String]
  let createdAt: Date
  let retryCount: Int
  let maxRetries: Int

  init(
    type: OperationType,
    data: [String: String] = [:],
    maxRetries: Int = 3
  ) {
    self.id = UUID().uuidString
    self.type = type
    self.data = data
    self.createdAt = Date()
    self.retryCount = 0
    self.maxRetries = maxRetries
  }

  var canRetry: Bool {
    return retryCount < maxRetries
  }

  var isExpired: Bool {
    let expirationDate = Calendar.current.date(byAdding: .day, value: 7, to: createdAt) ?? createdAt
    return Date() > expirationDate
  }
}

struct OperationResult: Codable {
  let operationId: String
  let type: OperationType
  let success: Bool
  let error: CardError?
  let executedAt: Date
}

struct OfflineCapabilities: Codable {
  let totalOperations: Int
  let offlineOperations: Int
  let offlinePercentage: Double
  let pendingOperationsCount: Int
  let lastSyncAttempt: Date?

  var offlineCapabilityDescription: String {
    return "\(offlineOperations)/\(totalOperations) operations available offline (\(Int(offlinePercentage))%)"
  }
}

struct NetworkQuality: Codable {
  let isOnline: Bool
  let connectionType: ConnectionType
  let quality: Quality
  let estimatedBandwidth: Double  // Mbps
  let latency: Double?  // ms

  enum Quality: String, Codable, CaseIterable {
    case poor = "Poor"
    case fair = "Fair"
    case good = "Good"
    case excellent = "Excellent"

    var estimatedBandwidth: Double {
      switch self {
      case .poor: return 0.5
      case .fair: return 2.0
      case .good: return 10.0
      case .excellent: return 50.0
      }
    }

    var color: String {
      switch self {
      case .poor: return "red"
      case .fair: return "orange"
      case .good: return "yellow"
      case .excellent: return "green"
      }
    }
  }
}
