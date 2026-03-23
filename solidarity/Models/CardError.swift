//
//  CardError.swift
//  solidarity
//
//  Comprehensive error handling for business card operations with offline-first support
//

import Foundation
import UIKit

/// Comprehensive error types for business card operations
enum CardError: Error, LocalizedError, Equatable, Codable {
  case invalidData(String)
  case storageError(String)
  case encryptionError(String)
  case networkError(String)
  case passGenerationError(String)
  case ocrError(String)
  case sharingError(String)
  case validationError(String)
  case notFound(String)
  case unauthorized(String)
  case rateLimited(String)
  case cryptographicError(String)
  case domainVerificationError(String)
  case proofGenerationError(String)
  case proofVerificationError(String)
  case keyManagementError(String)
  case offlineError(String)
  case syncError(String)
  case configurationError(String)

  var errorDescription: String? {
    switch self {
    case .invalidData(let message):
      return String(localized: "Invalid data: \(message)")
    case .storageError(let message):
      return String(localized: "Storage error: \(message)")
    case .encryptionError(let message):
      return String(localized: "Encryption error: \(message)")
    case .networkError(let message):
      return String(localized: "Network error: \(message)")
    case .passGenerationError(let message):
      return String(localized: "Pass generation error: \(message)")
    case .ocrError(let message):
      return String(localized: "OCR error: \(message)")
    case .sharingError(let message):
      return String(localized: "Sharing error: \(message)")
    case .validationError(let message):
      return String(localized: "Validation error: \(message)")
    case .notFound(let message):
      return String(localized: "Not found: \(message)")
    case .unauthorized(let message):
      return String(localized: "Unauthorized: \(message)")
    case .rateLimited(let message):
      return String(localized: "Rate limited: \(message)")
    case .cryptographicError(let message):
      return String(localized: "Cryptographic error: \(message)")
    case .domainVerificationError(let message):
      return String(localized: "Domain verification error: \(message)")
    case .proofGenerationError(let message):
      return String(localized: "Proof generation error: \(message)")
    case .proofVerificationError(let message):
      return String(localized: "Proof verification error: \(message)")
    case .keyManagementError(let message):
      return String(localized: "Key management error: \(message)")
    case .offlineError(let message):
      return String(localized: "Offline error: \(message)")
    case .syncError(let message):
      return String(localized: "Sync error: \(message)")
    case .configurationError(let message):
      return String(localized: "Configuration error: \(message)")
    }
  }

  var recoverySuggestion: String? {
    switch self {
    case .invalidData:
      return String(localized: "Please check the data format and try again.")
    case .storageError:
      return String(localized: "Please check available storage space and try again.")
    case .encryptionError:
      return String(localized: "Please restart the app and try again.")
    case .networkError:
      return String(localized: "Please check your internet connection and try again.")
    case .passGenerationError:
      return String(localized: "Please check your Apple Wallet settings and try again.")
    case .ocrError:
      return String(localized: "Please ensure the image is clear and try again.")
    case .sharingError:
      return String(localized: "Please check sharing permissions and try again.")
    case .validationError:
      return String(localized: "Please correct the highlighted fields and try again.")
    case .notFound:
      return String(localized: "The requested item could not be found.")
    case .unauthorized:
      return String(localized: "Please check your permissions and try again.")
    case .rateLimited:
      return String(localized: "Please wait a moment before trying again.")
    case .cryptographicError:
      return String(localized: "Please restart the app to reinitialize cryptographic components.")
    case .domainVerificationError:
      return String(localized: "Please check the email domain and try again later.")
    case .proofGenerationError:
      return String(localized: "Please ensure all required fields are present and try again.")
    case .proofVerificationError:
      return String(localized: "The proof may be expired or invalid. Please request a new one.")
    case .keyManagementError:
      return String(localized: "Please restart the app to reinitialize security keys.")
    case .offlineError:
      return String(localized: "This feature requires an internet connection. Please try again when online.")
    case .syncError:
      return String(localized: "Please check your connection and try syncing again.")
    case .configurationError:
      return String(localized: "Please check app settings and configuration.")
    }
  }

  var failureReason: String? {
    switch self {
    case .invalidData:
      return String(localized: "The provided data is not in the expected format.")
    case .storageError:
      return String(localized: "Unable to read from or write to local storage.")
    case .encryptionError:
      return String(localized: "Failed to encrypt or decrypt data.")
    case .networkError:
      return String(localized: "Network request failed or timed out.")
    case .passGenerationError:
      return String(localized: "Unable to generate Apple Wallet pass.")
    case .ocrError:
      return String(localized: "Text recognition failed or returned low confidence results.")
    case .sharingError:
      return String(localized: "Unable to share business card data.")
    case .validationError:
      return String(localized: "Required fields are missing or invalid.")
    case .notFound:
      return String(localized: "The requested resource does not exist.")
    case .unauthorized:
      return String(localized: "Access denied or insufficient permissions.")
    case .rateLimited:
      return String(localized: "Too many requests in a short time period.")
    case .cryptographicError:
      return String(localized: "Cryptographic operation failed or keys are corrupted.")
    case .domainVerificationError:
      return String(localized: "Unable to verify email domain ownership.")
    case .proofGenerationError:
      return String(localized: "Failed to generate cryptographic proof.")
    case .proofVerificationError:
      return String(localized: "Cryptographic proof verification failed.")
    case .keyManagementError:
      return String(localized: "Unable to manage cryptographic keys.")
    case .offlineError:
      return String(localized: "Operation requires network connectivity.")
    case .syncError:
      return String(localized: "Failed to synchronize data.")
    case .configurationError:
      return String(localized: "App configuration is invalid or missing.")
    }
  }

  /// Indicates if the error is recoverable through retry
  var isRecoverable: Bool {
    switch self {
    case .networkError, .rateLimited, .syncError, .offlineError:
      return true
    case .storageError, .encryptionError, .cryptographicError, .keyManagementError:
      return false
    default:
      return true
    }
  }

  /// Indicates if the error requires user intervention
  var requiresUserIntervention: Bool {
    switch self {
    case .validationError, .unauthorized, .configurationError:
      return true
    default:
      return false
    }
  }

  /// Error severity level
  var severity: ErrorSeverity {
    switch self {
    case .encryptionError, .cryptographicError, .keyManagementError:
      return .critical
    case .storageError, .proofVerificationError:
      return .high
    case .networkError, .offlineError, .syncError:
      return .medium
    case .validationError, .ocrError, .sharingError:
      return .low
    default:
      return .medium
    }
  }
}

/// Result type alias for business card operations
typealias CardResult<T> = Result<T, CardError>

/// Error severity levels for prioritizing error handling
enum ErrorSeverity: Int, Codable, CaseIterable {
  case low = 1
  case medium = 2
  case high = 3
  case critical = 4

  var displayName: String {
    switch self {
    case .low: return String(localized: "Low")
    case .medium: return String(localized: "Medium")
    case .high: return String(localized: "High")
    case .critical: return String(localized: "Critical")
    }
  }

  var systemImageName: String {
    switch self {
    case .low: return "info.circle"
    case .medium: return "exclamationmark.triangle"
    case .high: return "exclamationmark.triangle.fill"
    case .critical: return "xmark.octagon.fill"
    }
  }

  var color: String {
    switch self {
    case .low: return "blue"
    case .medium: return "orange"
    case .high: return "red"
    case .critical: return "red"
    }
  }
}

/// Error context for better debugging and user experience
struct ErrorContext: Codable {
  let timestamp: Date
  let operation: String
  let userId: String?
  let deviceInfo: DeviceInfo
  let additionalInfo: [String: String]

  init(
    operation: String,
    userId: String? = nil,
    additionalInfo: [String: String] = [:]
  ) {
    self.timestamp = Date()
    self.operation = operation
    self.userId = userId
    self.deviceInfo = DeviceInfo.current
    self.additionalInfo = additionalInfo
  }
}

/// Device information for error context
struct DeviceInfo: Codable {
  let model: String
  let systemVersion: String
  let appVersion: String
  let buildNumber: String

  static var current: DeviceInfo {
    return DeviceInfo(
      model: UIDevice.current.model,
      systemVersion: UIDevice.current.systemVersion,
      appVersion: (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "Unknown",
      buildNumber: (Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "Unknown"
    )
  }
}

/// Error handling utilities
extension CardError {

  /// Create error with context
  static func withContext(
    _ error: CardError,
    operation: String,
    additionalInfo: [String: String] = [:]
  ) -> ContextualError {
    return ContextualError(
      error: error,
      context: ErrorContext(
        operation: operation,
        additionalInfo: additionalInfo
      )
    )
  }

  /// Convert to user-friendly message
  var userFriendlyMessage: String {
    switch self.severity {
    case .low:
      return self.errorDescription ?? String(localized: "An error occurred")
    case .medium:
      return String(localized: "Something went wrong. \(self.recoverySuggestion ?? "")")
    case .high:
      return String(localized: "We encountered a problem. \(self.recoverySuggestion ?? "")")
    case .critical:
      return String(localized: "A critical error occurred. Please restart the app and contact support if the problem persists.")
    }
  }
}

/// Contextual error wrapper
struct ContextualError: Error, LocalizedError {
  let error: CardError
  let context: ErrorContext

  var errorDescription: String? {
    return error.errorDescription
  }

  var recoverySuggestion: String? {
    return error.recoverySuggestion
  }

  var failureReason: String? {
    return error.failureReason
  }
}
