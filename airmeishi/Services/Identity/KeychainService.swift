//
//  KeychainService.swift
//  airmeishi
//
//  Secure storage and retrieval of DID signing keys backed by iOS Keychain with biometric access control.
//

import CryptoKit
import Foundation
import LocalAuthentication
import Security
import SpruceIDMobileSdkRs

/// Manages the DID signing key material using the system Keychain.
final class KeychainService {
  static let shared = KeychainService()

  // Use a single session ID that persists for the app instance
  private static let sessionId: String = {
    let defaults = UserDefaults.standard
    if let existingId = defaults.string(forKey: "airmeishi.keychain.session.id") {
      return existingId
    }
    let newId = UUID().uuidString
    defaults.set(newId, forKey: "airmeishi.keychain.session.id")
    return newId
  }()

  #if targetEnvironment(simulator)
    static var simulatorInMemoryKey: SecKey?
  #else
    static var deviceInMemoryKey: SecKey?
  #endif

  let alias: KeyAlias

  var keyTag: Data
  let accessControlFlags: SecAccessControlCreateFlags
  private let accessPrompt: String
  private let authenticationPolicy: LAPolicy

  init(
    alias: KeyAlias = "airmeishi.did.signing",
    accessControlFlags: SecAccessControlCreateFlags = [.privateKeyUsage],
    accessPrompt: String = "Authenticate to access your AirMeishi identity key",
    authenticationPolicy: LAPolicy = .deviceOwnerAuthentication
  ) {
    self.alias = alias
    // Use a unique tag per app session to avoid keychain conflicts
    // This works for both simulator and device
    let uniqueAlias = "airmeishi.did.signing.\(Self.sessionId)"
    print("[KeychainService] Using session tag: \(uniqueAlias)")
    self.keyTag = Data(uniqueAlias.utf8)
    self.accessControlFlags = accessControlFlags
    self.accessPrompt = accessPrompt
    self.authenticationPolicy = authenticationPolicy

    // For device, clean up old keys. For simulator, skip cleanup since we use unique tags
    #if !targetEnvironment(simulator)
      cleanupAllOldKeys()
    #endif
  }

  // MARK: - Public API

  /// Retrieves a signing key conforming to SpruceKit's requirements.
  func signingKey(context: LAContext? = nil) -> CardResult<BiometricSigningKey> {
    switch ensureSigningKey() {
    case .failure(let error):
      return .failure(error)
    case .success:
      break
    }

    switch privateKey(context: context) {
    case .failure(let error):
      return .failure(error)
    case .success(let key):
      switch jwk(for: key) {
      case .failure(let error):
        return .failure(error)
      case .success(let jwk):
        return .success(BiometricSigningKey(privateKey: key, jwk: jwk, alias: alias))
      }
    }
  }

  /// Returns the public JWK representation of the signing key.
  func publicJwk(context: LAContext? = nil) -> CardResult<PublicKeyJWK> {
    switch ensureSigningKey() {
    case .failure(let error):
      return .failure(error)
    case .success:
      break
    }

    switch privateKey(context: context) {
    case .failure(let error):
      return .failure(error)
    case .success(let key):
      return jwk(for: key)
    }
  }

  /// Returns the public JWK serialized to a JSON string.
  func publicJwkString(context: LAContext? = nil, prettyPrinted: Bool = false) -> CardResult<String> {
    switch publicJwk(context: context) {
    case .failure(let error):
      return .failure(error)
    case .success(let jwk):
      do {
        return .success(try jwk.jsonString(prettyPrinted: prettyPrinted))
      } catch {
        return .failure(.keyManagementError("Failed to encode JWK: \(error.localizedDescription)"))
      }
    }
  }

  /// Creates an authentication context ready for Keychain access.
  func authenticationContext(reason: String? = nil) -> CardResult<LAContext> {
    let context = LAContext()
    context.localizedCancelTitle = "Cancel"
    context.localizedFallbackTitle = "Use Passcode"

    var evaluationError: NSError?
    guard context.canEvaluatePolicy(authenticationPolicy, error: &evaluationError) else {
      let message = evaluationError?.localizedDescription ?? "Biometric authentication unavailable"
      return .failure(.keyManagementError(message))
    }

    if let reason = reason {
      context.touchIDAuthenticationAllowableReuseDuration = 5
      context.setLocalizedReason(reason)
    }

    return .success(context)
  }

  /// Deletes the signing key from the Keychain.
  func deleteSigningKey() -> CardResult<Void> {
    // Create a broad query that will match any key with our tag
    // This ensures we clean up keys regardless of their access control settings
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag,
    ]

    // First attempt to delete without specifying key type (broader match)
    var status = SecItemDelete(query as CFDictionary)

    // If that didn't work, try with specific key type
    if status != errSecSuccess && status != errSecItemNotFound {
      let specificQuery: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      ]
      status = SecItemDelete(specificQuery as CFDictionary)
    }

    if status == errSecSuccess || status == errSecItemNotFound {
      print("[KeychainService] Successfully deleted signing key or key not found")
      return .success(())
    } else {
      return .failure(.keyManagementError("Failed to delete signing key: \(statusDescription(status))"))
    }
  }

  /// Resets the signing key by deleting and regenerating it
  func resetSigningKey() -> CardResult<Void> {
    print("[KeychainService] Resetting signing key...")

    // First delete any existing key
    _ = deleteSigningKey()

    // Then create a new one
    switch ensureSigningKey() {
    case .failure(let error):
      print("[KeychainService] Failed to reset signing key: \(error)")
      return .failure(error)
    case .success:
      print("[KeychainService] Successfully reset signing key")
      return .success(())
    }
  }

  // MARK: - Private helpers

  /// Checks if a key logic with our tag exists in the keychain.
  func keyExists() -> Bool {
    // Check if we have an in-memory key first
    #if targetEnvironment(simulator)
      if Self.simulatorInMemoryKey != nil { return true }
    #else
      if Self.deviceInMemoryKey != nil { return true }
    #endif

    // Otherwise check keychain
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    return status == errSecSuccess
  }

  private func privateKey(context: LAContext?) -> CardResult<SecKey> {
    // Check for in-memory key first (works for both simulator and device)
    #if targetEnvironment(simulator)
      if let inMemoryKey = Self.simulatorInMemoryKey {
        print("[KeychainService] Using in-memory simulator key")
        return .success(inMemoryKey)
      }

      // Try to get from keychain
      let query: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecReturnRef as String: true,
      ]

      var item: CFTypeRef?
      let status = SecItemCopyMatching(query as CFDictionary, &item)

      if status == errSecSuccess {
        // swiftlint:disable:next force_cast
        let key = item as! SecKey
        return .success(key)
      }

      return .failure(.keyManagementError("Key not found in simulator keychain and no in-memory key available"))

    #else
      // Device code with authentication handling
      let basicQuery: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecReturnRef as String: true,
      ]

      var item: CFTypeRef?
      // Try to copy matching item *without* auth context first.
      // If it requires auth, this might fail with errSecAuthFailed or errSecInteractionNotAllowed.
      var status = SecItemCopyMatching(basicQuery as CFDictionary, &item)

      if status == errSecSuccess {
        guard let candidate = item else {
          return .failure(.keyManagementError("Keychain returned empty result for signing key"))
        }
        guard CFGetTypeID(candidate) == SecKeyGetTypeID() else {
          return .failure(.keyManagementError("Keychain returned unexpected item type for signing key"))
        }
        print("[KeychainService] Successfully retrieved key without authentication context")
        // Since we verified the type ID above, this cast is safe and redundant for CFTypeRef -> SecKey
        // swiftlint:disable:next force_cast
        let key = candidate as! SecKey
        return .success(key)
      }

      // If key requires authentication, try with context
      if status == errSecInteractionNotAllowed || status == errSecAuthFailed {
        var authQuery = basicQuery
        let authContext: LAContext
        if let context = context {
          authContext = context
        } else {
          let newContext = LAContext()
          newContext.touchIDAuthenticationAllowableReuseDuration = 5
          newContext.localizedFallbackTitle = "Use Passcode"
          authContext = newContext
        }
        authQuery[kSecUseAuthenticationContext as String] = authContext

        status = SecItemCopyMatching(authQuery as CFDictionary, &item)
        if status == errSecSuccess {
          guard let candidate = item else {
            return .failure(.keyManagementError("Keychain returned empty result for signing key"))
          }
          guard CFGetTypeID(candidate) == SecKeyGetTypeID() else {
            return .failure(.keyManagementError("Keychain returned unexpected item type for signing key"))
          }
          print("[KeychainService] Successfully retrieved key with authentication context")
          // swiftlint:disable:next force_cast
          let key = candidate as! SecKey
          return .success(key)
        }
      }

      // If key not found, try to create it first
      if status == errSecItemNotFound {
        print("[KeychainService] Key not found, attempting to create...")
        // Try to ensure the key exists
        switch ensureSigningKey() {
        case .failure(let error):
          return .failure(error)
        case .success:
          // Retry fetching the key
          let retryStatus = SecItemCopyMatching(basicQuery as CFDictionary, &item)
          guard retryStatus == errSecSuccess else {
            return .failure(
              .keyManagementError("Failed to retrieve signing key after creation: \(statusDescription(retryStatus))")
            )
          }
          guard let candidate = item else {
            return .failure(.keyManagementError("Keychain returned empty result for signing key after creation"))
          }
          guard CFGetTypeID(candidate) == SecKeyGetTypeID() else {
            return .failure(.keyManagementError("Keychain returned unexpected item type for signing key"))
          }
          print("[KeychainService] Successfully retrieved key after creation")
          // swiftlint:disable:next force_cast
          let key = candidate as! SecKey
          return .success(key)
        }
      }

      print("[KeychainService] Failed to retrieve key with status: \(statusDescription(status))")
      return .failure(.keyManagementError("Failed to retrieve signing key: \(statusDescription(status))"))
    #endif
  }

  private func jwk(for privateKey: SecKey) -> CardResult<PublicKeyJWK> {
    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
      return .failure(.keyManagementError("Failed to derive public key from signing key"))
    }

    var error: Unmanaged<CFError>?
    guard let data = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
      let cfError = error?.takeRetainedValue()
      let message =
        (cfError as Error?)?.localizedDescription
        ?? "Unknown error exporting public key"
      return .failure(.keyManagementError(message))
    }

    guard data.count == 65 else {
      return .failure(.keyManagementError("Unexpected public key length: \(data.count) bytes"))
    }

    let x = data.subdata(in: 1..<33)
    let y = data.subdata(in: 33..<65)
    let jwk = PublicKeyJWK(
      kty: "EC",
      crv: "P-256",
      alg: "ES256",
      x: x.base64URLEncodedString(),
      y: y.base64URLEncodedString()
    )
    return .success(jwk)
  }

  func combine(_ first: CardError, _ second: CardError) -> CardError {
    switch (first, second) {
    case (.keyManagementError(let a), .keyManagementError(let b)):
      return .keyManagementError("\(a); \(b)")
    default:
      return second
    }
  }

  internal func statusDescription(_ status: OSStatus) -> String {
    if let message = SecCopyErrorMessageString(status, nil) as String? {
      return message
    }
    return "OSStatus \(status)"
  }
}

// MARK: - LAContext helpers

extension LAContext {
  fileprivate func setLocalizedReason(_ reason: String) {
    // The localized reason is provided when the system prompt is displayed via Keychain.
    // There is no direct API to set it on the context, so we rely on the Keychain prompt instead.
    // This method exists to make call sites more expressive.
  }
}
