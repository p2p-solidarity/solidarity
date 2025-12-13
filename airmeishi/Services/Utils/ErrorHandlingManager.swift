//
//  ErrorHandlingManager.swift
//  airmeishi
//
//  Comprehensive error handling and logging system for offline-first functionality
//

import Foundation
import os.log

/// Centralized error handling and logging system
class ErrorHandlingManager {
  static let shared = ErrorHandlingManager()

  private let logger = Logger(subsystem: "com.kidneyweakx.airmeishi", category: "ErrorHandling")
  private let storageManager = StorageManager.shared
  private let maxLogEntries = 1000

  @Published private(set) var recentErrors: [ErrorLogEntry] = []

  private init() {
    loadErrorLog()
  }

  // MARK: - Public Methods

  /// Log an error with context
  func logError(
    _ error: CardError,
    operation: String,
    additionalInfo: [String: String] = [:],
    file: String = #file,
    function: String = #function,
    line: Int = #line
  ) {
    let entry = ErrorLogEntry(
      error: error,
      operation: operation,
      additionalInfo: additionalInfo,
      file: URL(fileURLWithPath: file).lastPathComponent,
      function: function,
      line: line
    )

    // Add to recent errors
    recentErrors.insert(entry, at: 0)

    // Keep only recent entries
    if recentErrors.count > maxLogEntries {
      recentErrors = Array(recentErrors.prefix(maxLogEntries))
    }

    // Log to system
    logToSystem(entry)

    // Save to storage
    _ = saveErrorLog()

    // Handle critical errors
    if error.severity == .critical {
      handleCriticalError(entry)
    }
  }

  /// Handle error with automatic retry logic
  func handleErrorWithRetry<T>(
    operation: @escaping () -> CardResult<T>,
    maxRetries: Int = 3,
    retryDelay: TimeInterval = 1.0,
    operationName: String
  ) async -> CardResult<T> {

    var lastError: CardError?

    for attempt in 1...maxRetries {
      let result = operation()

      switch result {
      case .success(let value):
        if attempt > 1 {
          logger.info("Operation '\(operationName)' succeeded on attempt \(attempt)")
        }
        return .success(value)

      case .failure(let error):
        lastError = error

        // Log the attempt
        logError(
          error,
          operation: "\(operationName) (attempt \(attempt)/\(maxRetries))"
        )

        // Check if error is recoverable
        if !error.isRecoverable {
          logger.error("Non-recoverable error in '\(operationName)': \(error.localizedDescription)")
          return .failure(error)
        }

        // Wait before retry (except on last attempt)
        if attempt < maxRetries {
          try? await Task.sleep(nanoseconds: UInt64(retryDelay * 1_000_000_000))
        }
      }
    }

    // All retries failed
    let finalError = lastError ?? .configurationError("Unknown error during retry")
    logger.error("Operation '\(operationName)' failed after \(maxRetries) attempts")

    return .failure(finalError)
  }

  /// Get error statistics
  func getErrorStatistics() -> ErrorStatistics {
    let now = Date()
    let last24Hours = Calendar.current.date(byAdding: .hour, value: -24, to: now) ?? now
    let lastWeek = Calendar.current.date(byAdding: .day, value: -7, to: now) ?? now

    let recent24h = recentErrors.filter { $0.timestamp >= last24Hours }
    let recentWeek = recentErrors.filter { $0.timestamp >= lastWeek }

    let severityDistribution = Dictionary(grouping: recentErrors, by: { $0.error.severity })
      .mapValues { $0.count }

    let operationDistribution = Dictionary(grouping: recentErrors, by: { $0.operation })
      .mapValues { $0.count }

    return ErrorStatistics(
      totalErrors: recentErrors.count,
      errorsLast24h: recent24h.count,
      errorsLastWeek: recentWeek.count,
      severityDistribution: severityDistribution,
      operationDistribution: operationDistribution,
      mostCommonError: getMostCommonError(),
      lastError: recentErrors.first
    )
  }

  /// Clear error log
  func clearErrorLog() -> CardResult<Void> {
    recentErrors.removeAll()
    return saveErrorLog()
  }

  /// Export error log for debugging
  func exportErrorLog() -> CardResult<String> {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = .prettyPrinted

    do {
      let data = try encoder.encode(recentErrors)
      guard let jsonString = String(data: data, encoding: .utf8) else {
        return .failure(.configurationError("Failed to convert error log to string"))
      }
      return .success(jsonString)
    } catch {
      return .failure(.configurationError("Failed to encode error log: \(error.localizedDescription)"))
    }
  }

  /// Get user-friendly error message with recovery suggestions
  func getUserFriendlyMessage(for error: CardError) -> UserFriendlyErrorMessage {
    return UserFriendlyErrorMessage(
      title: getErrorTitle(for: error),
      message: error.userFriendlyMessage,
      recoverySuggestion: error.recoverySuggestion,
      severity: error.severity,
      canRetry: error.isRecoverable,
      requiresUserAction: error.requiresUserIntervention
    )
  }

  /// Handle offline errors gracefully
  func handleOfflineError(
    _ error: CardError,
    operation: String,
    fallbackAction: (() -> CardResult<Void>)? = nil
  ) -> CardResult<Void> {

    // Log the offline error
    logError(error, operation: operation, additionalInfo: ["context": "offline"])

    // Try fallback action if provided
    if let fallback = fallbackAction {
      let fallbackResult = fallback()

      switch fallbackResult {
      case .success:
        logger.info("Fallback action succeeded for offline operation: \(operation)")
        return .success(())
      case .failure(let fallbackError):
        logError(fallbackError, operation: "\(operation) (fallback)")
        return .failure(fallbackError)
      }
    }

    // Queue operation for later if it requires network
    if case .networkError = error {
      let offlineManager = OfflineManager.shared
      let pendingOperation = PendingOperation(
        type: .syncData,  // Default type, would be determined by operation
        data: ["operation": operation]
      )

      let queueResult = offlineManager.queueOperation(pendingOperation)

      switch queueResult {
      case .success:
        return .success(())
      case .failure(let queueError):
        return .failure(queueError)
      }
    }

    return .failure(error)
  }

  // MARK: - Private Methods

  private func loadErrorLog() {
    let result = storageManager.loadUserPreferences([ErrorLogEntry].self)

    switch result {
    case .success(let entries):
      recentErrors = entries
    case .failure:
      recentErrors = []
    }
  }

  private func saveErrorLog() -> CardResult<Void> {
    return storageManager.saveUserPreferences(recentErrors)
  }

  private func logToSystem(_ entry: ErrorLogEntry) {
    let logMessage = "[\(entry.operation)] \(entry.error.localizedDescription) at \(entry.file):\(entry.line)"

    switch entry.error.severity {
    case .low:
      logger.info("\(logMessage)")
    case .medium:
      logger.notice("\(logMessage)")
    case .high:
      logger.error("\(logMessage)")
    case .critical:
      logger.fault("\(logMessage)")
    }
  }

  private func handleCriticalError(_ entry: ErrorLogEntry) {
    // For critical errors, we might want to:
    // 1. Clear sensitive data
    // 2. Reset app state
    // 3. Notify user to restart app

    logger.fault("Critical error detected: \(entry.error.localizedDescription)")

    // In a production app, you might want to:
    // - Send crash report to analytics
    // - Clear potentially corrupted data
    // - Show user a recovery dialog
  }

  private func getMostCommonError() -> CardError? {
    let errorCounts = Dictionary(grouping: recentErrors, by: { String(describing: type(of: $0.error)) })
      .mapValues { $0.count }

    guard let mostCommon = errorCounts.max(by: { $0.value < $1.value }) else {
      return nil
    }

    return recentErrors.first { String(describing: type(of: $0.error)) == mostCommon.key }?.error
  }

  private func getErrorTitle(for error: CardError) -> String {
    switch error.severity {
    case .low:
      return "Information"
    case .medium:
      return "Warning"
    case .high:
      return "Error"
    case .critical:
      return "Critical Error"
    }
  }
}

// MARK: - Supporting Types

struct ErrorLogEntry: Codable, Identifiable {
  let id: String
  let timestamp: Date
  let error: CardError
  let operation: String
  let additionalInfo: [String: String]
  let file: String
  let function: String
  let line: Int

  init(
    error: CardError,
    operation: String,
    additionalInfo: [String: String] = [:],
    file: String,
    function: String,
    line: Int
  ) {
    self.id = UUID().uuidString
    self.timestamp = Date()
    self.error = error
    self.operation = operation
    self.additionalInfo = additionalInfo
    self.file = file
    self.function = function
    self.line = line
  }
}

struct ErrorStatistics: Codable {
  let totalErrors: Int
  let errorsLast24h: Int
  let errorsLastWeek: Int
  let severityDistribution: [ErrorSeverity: Int]
  let operationDistribution: [String: Int]
  let mostCommonError: CardError?
  let lastError: ErrorLogEntry?

  var errorRate24h: Double {
    return Double(errorsLast24h) / 24.0  // errors per hour
  }

  var errorRateWeek: Double {
    return Double(errorsLastWeek) / (7.0 * 24.0)  // errors per hour over week
  }
}

struct UserFriendlyErrorMessage {
  let title: String
  let message: String
  let recoverySuggestion: String?
  let severity: ErrorSeverity
  let canRetry: Bool
  let requiresUserAction: Bool

  var systemImageName: String {
    return severity.systemImageName
  }

  var color: String {
    return severity.color
  }
}

// MARK: - Error Handling Extensions

extension Result where Failure == CardError {
  /// Handle error with logging
  func handleError(
    operation: String,
    file: String = #file,
    function: String = #function,
    line: Int = #line
  ) -> Result<Success, CardError> {

    if case .failure(let error) = self {
      ErrorHandlingManager.shared.logError(
        error,
        operation: operation,
        file: file,
        function: function,
        line: line
      )
    }

    return self
  }

  /// Convert to async result with error handling
  func async() async -> Result<Success, CardError> {
    return self
  }
}
