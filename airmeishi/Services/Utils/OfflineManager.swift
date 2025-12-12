//
//  OfflineManager.swift
//  airmeishi
//
//  Offline-first functionality manager for business card operations
//

import Foundation
import Network
import Combine

/// Manages offline-first functionality and network connectivity
class OfflineManager: ObservableObject {
    static let shared = OfflineManager()
    
    @Published private(set) var isOnline = false
    @Published private(set) var connectionType: ConnectionType = .none
    @Published private(set) var pendingOperations: [PendingOperation] = []
    
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "OfflineManager")
    private let storageManager = StorageManager.shared
    private var cancellables = Set<AnyCancellable>()
    
    private let pendingOperationsKey = "pending_operations"
    
    private init() {
        setupNetworkMonitoring()
        loadPendingOperations()
    }
    
    // MARK: - Public Methods
    
    /// Start monitoring network connectivity
    func startMonitoring() {
        monitor.start(queue: queue)
    }
    
    /// Stop monitoring network connectivity
    func stopMonitoring() {
        monitor.cancel()
    }
    
    /// Check if a specific operation can be performed offline
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
            return false // Requires server-side signing
        case .verifyDomain:
            return false // Requires DNS lookup
        case .syncData:
            return false // Requires network
        case .updateWalletPass:
            return false // Requires server communication
        }
    }
    
    /// Queue an operation for later execution when online
    func queueOperation(_ operation: PendingOperation) -> CardResult<Void> {
        // Check if operation can be performed offline
        if canPerformOffline(operation.type) {
            return .failure(.offlineError("Operation can be performed offline"))
        }
        
        // Add to pending operations
        pendingOperations.append(operation)
        
        // Save to storage
        return savePendingOperations()
    }
    
    /// Execute all pending operations when online
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
                // Keep failed operations for retry
                failedOperations.append(operation)
                results.append(OperationResult(
                    operationId: operation.id,
                    type: operation.type,
                    success: false,
                    error: error,
                    executedAt: Date()
                ))
            }
        }
        
        // Update pending operations with only failed ones
        pendingOperations = failedOperations
        _ = savePendingOperations()
        
        return .success(results)
    }
    
    /// Get offline capabilities summary
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
    
    /// Retry failed operations
    func retryFailedOperations() -> CardResult<[OperationResult]> {
        guard isOnline else {
            return .failure(.offlineError("Cannot retry operations while offline"))
        }
        
        return executePendingOperations()
    }
    
    /// Clear all pending operations
    func clearPendingOperations() -> CardResult<Void> {
        pendingOperations.removeAll()
        return savePendingOperations()
    }
    
    /// Get network quality information
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
        
        // Simplified network quality assessment
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
        
        // Determine connection type
        if path.usesInterfaceType(.wifi) {
            connectionType = .wifi
        } else if path.usesInterfaceType(.cellular) {
            connectionType = .cellular4G // Simplified - would need more detection for specific cellular types
        } else {
            connectionType = .none
        }
        
        // Execute pending operations when coming online
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
    
    private func savePendingOperations() -> CardResult<Void> {
        return storageManager.saveUserPreferences(pendingOperations)
    }
    
    private func executeOperation(_ operation: PendingOperation) -> CardResult<OperationResult> {
        // This would contain the actual implementation for each operation type
        // For now, we'll simulate the execution
        
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
    
    private func executeWalletPassGeneration(_ operation: PendingOperation) -> CardResult<OperationResult> {
        // Simulate wallet pass generation
        // In real implementation, this would call PassKitManager
        
        return .success(OperationResult(
            operationId: operation.id,
            type: operation.type,
            success: true,
            error: nil,
            executedAt: Date()
        ))
    }
    
    private func executeDomainVerification(_ operation: PendingOperation) -> CardResult<OperationResult> {
        // Simulate domain verification
        // In real implementation, this would call DomainVerificationManager
        
        return .success(OperationResult(
            operationId: operation.id,
            type: operation.type,
            success: true,
            error: nil,
            executedAt: Date()
        ))
    }
    
    private func executeDataSync(_ operation: PendingOperation) -> CardResult<OperationResult> {
        // Simulate data synchronization
        // In real implementation, this would sync with server
        
        UserDefaults.standard.set(Date(), forKey: "last_sync_attempt")
        
        return .success(OperationResult(
            operationId: operation.id,
            type: operation.type,
            success: true,
            error: nil,
            executedAt: Date()
        ))
    }
    
    private func executeWalletPassUpdate(_ operation: PendingOperation) -> CardResult<OperationResult> {
        // Simulate wallet pass update
        // In real implementation, this would call PassKitManager
        
        return .success(OperationResult(
            operationId: operation.id,
            type: operation.type,
            success: true,
            error: nil,
            executedAt: Date()
        ))
    }
    
    private func executePendingOperationsAsync() async -> CardResult<[OperationResult]> {
        return await withCheckedContinuation { continuation in
            let result = executePendingOperations()
            continuation.resume(returning: result)
        }
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
    let estimatedBandwidth: Double // Mbps
    let latency: Double? // ms
    
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
