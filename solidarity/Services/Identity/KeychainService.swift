//
//  KeychainService.swift
//  solidarity
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
  static let legacyMasterAlias: KeyAlias = "airmeishi.did.signing"
  static let modernMasterAlias: KeyAlias = "solidarity.master"
  static let masterAlias: KeyAlias = modernMasterAlias
  static let rpAliasPrefix = "airmeishi.did.rp."
  static let modernRpAliasPrefix = "solidarity.rp."

  /// Serializes key mutation operations to prevent concurrent duplicate generation.
  static let keyLock = NSRecursiveLock()

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
    alias: KeyAlias = KeychainService.masterAlias,
    accessControlFlags: SecAccessControlCreateFlags = [.privateKeyUsage],
    accessPrompt: String = "Authenticate to access your identity key",
    authenticationPolicy: LAPolicy = .deviceOwnerAuthentication
  ) {
    self.alias = alias
    self.keyTag = Data(alias.utf8)
    self.accessControlFlags = accessControlFlags
    self.accessPrompt = accessPrompt
    self.authenticationPolicy = authenticationPolicy

    migrateLegacyKeysIfNeeded()
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
    Self.keyLock.lock()
    defer { Self.keyLock.unlock() }

    // Create a broad query that will match any key with our tag
    // This ensures we clean up keys regardless of their access control settings
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
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
    Self.keyLock.lock()
    defer { Self.keyLock.unlock() }

    print("[KeychainService] Resetting signing key...")

    // Delete must succeed before regenerating — fail fast to avoid duplicate keys
    switch deleteSigningKey() {
    case .failure(let error):
      print("[KeychainService] Reset aborted: failed to delete existing key: \(error)")
      return .failure(error)
    case .success:
      break
    }

    clearInMemoryKey()

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

  /// Checks if a key with our tag exists in the keychain.
  func keyExists() -> Bool {
    // Check if we have an in-memory key first
    #if targetEnvironment(simulator)
      if Self.simulatorInMemoryKey != nil { return true }
    #else
      if Self.deviceInMemoryKey != nil { return true }
    #endif

    // Only match private keys — avoids false positives from orphan public keys
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecReturnRef as String: true,
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let candidate = item else {
      return false
    }
    return CFGetTypeID(candidate) == SecKeyGetTypeID()
  }

  private func privateKey(context: LAContext?) -> CardResult<SecKey> {
    // Check for in-memory key first (works for both simulator and device)
    #if targetEnvironment(simulator)
      if let inMemoryKey = Self.simulatorInMemoryKey {
        print("[KeychainService] Using in-memory simulator key")
        return .success(inMemoryKey)
      }

      // Try to get from keychain — only match private keys
      let query: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
        kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
        kSecReturnRef as String: true,
      ]

      var item: CFTypeRef?
      let status = SecItemCopyMatching(query as CFDictionary, &item)

      if status == errSecSuccess {
        // swiftlint:disable:next force_cast
        let key = item as! SecKey
        return .success(key)
      }

      // Key not found — attempt to generate on the fly
      print("[KeychainService] Simulator key not found (status: \(statusDescription(status))), generating...")
      switch ensureSigningKey() {
      case .failure(let error):
        return .failure(error)
      case .success:
        // Check in-memory key first (ensureSigningKey may have set it)
        if let inMemoryKey = Self.simulatorInMemoryKey {
          return .success(inMemoryKey)
        }
        // Retry keychain
        var retryItem: CFTypeRef?
        let retryStatus = SecItemCopyMatching(query as CFDictionary, &retryItem)
        if retryStatus == errSecSuccess {
          // swiftlint:disable:next force_cast
          return .success(retryItem as! SecKey)
        }
        return .failure(.keyManagementError("Key not found after generation (status: \(statusDescription(retryStatus)))"))
      }

    #else
      // Device code with authentication handling
      let basicQuery: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
        kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
        kSecReturnRef as String: true,
      ]

      var item: CFTypeRef?
      // Try to copy matching item *without* auth context first.
      // If it requires auth, this might fail with errSecAuthFailed or errSecInteractionNotAllowed.
      var status = SecItemCopyMatching(basicQuery as CFDictionary, &item)

      if status == errSecSuccess {
        if let candidate = item, CFGetTypeID(candidate) == SecKeyGetTypeID() {
          print("[KeychainService] Successfully retrieved key without authentication context")
          // swiftlint:disable:next force_cast
          let key = candidate as! SecKey
          return .success(key)
        }

        // Stale entry: status succeeded but item is nil or not a SecKey — cleanup and regenerate
        print("[KeychainService] Stale key detected (empty or wrong type), cleaning up and regenerating...")
        cleanupAllOldKeys()
        clearInMemoryKey()
        switch ensureSigningKey() {
        case .failure(let error):
          return .failure(error)
        case .success:
          var retryItem: CFTypeRef?
          let retryStatus = SecItemCopyMatching(basicQuery as CFDictionary, &retryItem)
          guard retryStatus == errSecSuccess, let retryCandidate = retryItem,
            CFGetTypeID(retryCandidate) == SecKeyGetTypeID()
          else {
            return .failure(
              .keyManagementError("Key not usable after stale cleanup: \(statusDescription(retryStatus))")
            )
          }
          // swiftlint:disable:next force_cast
          return .success(retryCandidate as! SecKey)
        }
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
          if let candidate = item, CFGetTypeID(candidate) == SecKeyGetTypeID() {
            print("[KeychainService] Successfully retrieved key with authentication context")
            // swiftlint:disable:next force_cast
            let key = candidate as! SecKey
            return .success(key)
          }

          // Stale entry with auth context — cleanup and regenerate
          print("[KeychainService] Stale key detected (auth path), cleaning up and regenerating...")
          cleanupAllOldKeys()
          clearInMemoryKey()
          switch ensureSigningKey() {
          case .failure(let error):
            return .failure(error)
          case .success:
            var retryItem: CFTypeRef?
            var retryQuery = basicQuery
            retryQuery[kSecUseAuthenticationContext as String] = authContext
            let retryStatus = SecItemCopyMatching(retryQuery as CFDictionary, &retryItem)
            guard retryStatus == errSecSuccess, let retryCandidate = retryItem,
              CFGetTypeID(retryCandidate) == SecKeyGetTypeID()
            else {
              return .failure(
                .keyManagementError(
                  "Key not usable after stale cleanup (auth): \(statusDescription(retryStatus))"
                )
              )
            }
            // swiftlint:disable:next force_cast
            return .success(retryCandidate as! SecKey)
          }
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
