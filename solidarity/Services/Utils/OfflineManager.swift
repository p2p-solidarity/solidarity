//
//  OfflineManager.swift
//  solidarity
//
//  Offline-first functionality manager for business card operations
//

import Combine
import Foundation
import Network

/// Manages offline-first functionality and network connectivity
class OfflineManager: ObservableObject {
  static let shared = OfflineManager()

  @Published private(set) var isOnline = false
  @Published private(set) var connectionType: ConnectionType = .none
  @Published private(set) var pendingOperations: [PendingOperation] = []

  private let monitor = NWPathMonitor()
  private let queue = DispatchQueue(label: "OfflineManager")
  let storageManager = StorageManager.shared
  private var cancellables = Set<AnyCancellable>()

  private let pendingOperationsKey = "pending_operations"

  private init() {
    setupNetworkMonitoring()
    loadPendingOperations()
  }

  // MARK: - Public Methods

  func startMonitoring() {
    monitor.start(queue: queue)
  }

  func stopMonitoring() {
    monitor.cancel()
  }

  func canPerformOffline(_ operation: OperationType) -> Bool {
    switch operation {
    case .createBusinessCard, .updateBusinessCard, .deleteBusinessCard:
      return true
    case .addContact, .updateContact, .deleteContact:
      return true
    case .generateQRCode, .scanQRCode:
      return true
    case .generateProof, .verifyProof:
      return true
    case .encryptData, .decryptData:
      return true
    case .generateWalletPass:
      return false
    case .verifyDomain:
      return false
    case .syncData:
      return false
    case .updateWalletPass:
      return false
    }
  }

  func queueOperation(_ operation: PendingOperation) -> CardResult<Void> {
    if canPerformOffline(operation.type) {
      return .failure(.offlineError("Operation can be performed offline"))
    }

    pendingOperations.append(operation)
    return savePendingOperations()
  }

  func executePendingOperations() -> CardResult<[OperationResult]> {
    guard isOnline else {
      return .failure(.offlineError("Cannot execute pending operations while offline"))
    }

    var results: [OperationResult] = []
    var failedOperations: [PendingOperation] = []

    for operation in pendingOperations {
      let result = executeOperation(operation)

      switch result {
      case .success(let operationResult):
        results.append(operationResult)
      case .failure(let error):
        failedOperations.append(operation)
        results.append(
          OperationResult(
            operationId: operation.id,
            type: operation.type,
            success: false,
            error: error,
            executedAt: Date()
          )
        )
      }
    }

    pendingOperations = failedOperations
    _ = savePendingOperations()

    return .success(results)
  }

  func getOfflineCapabilities() -> OfflineCapabilities {
    let totalOperations = OperationType.allCases.count
    let offlineOperations = OperationType.allCases.filter { canPerformOffline($0) }.count

    return OfflineCapabilities(
      totalOperations: totalOperations,
      offlineOperations: offlineOperations,
      offlinePercentage: Double(offlineOperations) / Double(totalOperations) * 100,
      pendingOperationsCount: pendingOperations.count,
      lastSyncAttempt: UserDefaults.standard.object(forKey: "last_sync_attempt") as? Date
    )
  }

  func retryFailedOperations() -> CardResult<[OperationResult]> {
    guard isOnline else {
      return .failure(.offlineError("Cannot retry operations while offline"))
    }

    return executePendingOperations()
  }

  func clearPendingOperations() -> CardResult<Void> {
    pendingOperations.removeAll()
    return savePendingOperations()
  }

  func getNetworkQuality() -> NetworkQuality {
    guard isOnline else {
      return NetworkQuality(
        isOnline: false,
        connectionType: .none,
        quality: .poor,
        estimatedBandwidth: 0,
        latency: nil
      )
    }

    let quality: NetworkQuality.Quality
    switch connectionType {
    case .wifi:
      quality = .excellent
    case .cellular5G:
      quality = .excellent
    case .cellular4G:
      quality = .good
    case .cellular3G:
      quality = .fair
    case .cellular2G:
      quality = .poor
    case .none:
      quality = .poor
    }

    return NetworkQuality(
      isOnline: isOnline,
      connectionType: connectionType,
      quality: quality,
      estimatedBandwidth: quality.estimatedBandwidth,
      latency: nil
    )
  }

  // MARK: - Private Methods

  private func setupNetworkMonitoring() {
    monitor.pathUpdateHandler = { [weak self] path in
      DispatchQueue.main.async {
        self?.updateNetworkStatus(path)
      }
    }
  }

  private func updateNetworkStatus(_ path: NWPath) {
    let wasOnline = isOnline
    isOnline = path.status == .satisfied

    if path.usesInterfaceType(.wifi) {
      connectionType = .wifi
    } else if path.usesInterfaceType(.cellular) {
      connectionType = .cellular4G
    } else {
      connectionType = .none
    }

    if !wasOnline && isOnline {
      Task {
        _ = await executePendingOperationsAsync()
      }
    }
  }

  private func loadPendingOperations() {
    let result = storageManager.loadUserPreferences([PendingOperation].self)

    switch result {
    case .success(let operations):
      pendingOperations = operations
    case .failure:
      pendingOperations = []
    }
  }

  func savePendingOperations() -> CardResult<Void> {
    return storageManager.saveUserPreferences(pendingOperations)
  }

  func executeOperation(_ operation: PendingOperation) -> CardResult<OperationResult> {
    switch operation.type {
    case .generateWalletPass:
      return executeWalletPassGeneration(operation)
    case .verifyDomain:
      return executeDomainVerification(operation)
    case .syncData:
      return executeDataSync(operation)
    case .updateWalletPass:
      return executeWalletPassUpdate(operation)
    default:
      return .failure(.offlineError("Operation should be performed offline"))
    }
  }

  private func executePendingOperationsAsync() async -> CardResult<[OperationResult]> {
    return await withCheckedContinuation { continuation in
      let result = executePendingOperations()
      continuation.resume(returning: result)
    }
  }
}
