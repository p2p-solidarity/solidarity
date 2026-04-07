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
    #if targetEnvironment(simulator)
      return privateKeyForSimulator()
    #else
      return privateKeyForDevice(context: context)
    #endif
  }

  // MARK: - Private Key Retrieval Helpers

  #if targetEnvironment(simulator)
  private func privateKeyForSimulator() -> CardResult<SecKey> {
    if let inMemoryKey = Self.simulatorInMemoryKey {
      print("[KeychainService] Using in-memory simulator key")
      return .success(inMemoryKey)
    }

    let query = basePrivateKeyQuery()
    if let key = fetchSecKey(query: query) { return .success(key) }

    print("[KeychainService] Simulator key not found, generating...")
    switch ensureSigningKey() {
    case .failure(let error):
      return .failure(error)
    case .success:
      if let inMemoryKey = Self.simulatorInMemoryKey { return .success(inMemoryKey) }
      if let key = fetchSecKey(query: query) { return .success(key) }
      return .failure(.keyManagementError("Key not found after generation"))
    }
  }
  #else
  private func privateKeyForDevice(context: LAContext?) -> CardResult<SecKey> {
    var basicQuery = basePrivateKeyQuery()
    basicQuery[kSecAttrKeyType as String] = kSecAttrKeyTypeECSECPrimeRandom

    // Try without auth context first
    if let result = fetchOrRecoverKey(query: basicQuery, label: "without authentication context") {
      return result
    }

    // Try with auth context if required
    var item: CFTypeRef?
    let status = SecItemCopyMatching(basicQuery as CFDictionary, &item)
    if status == errSecInteractionNotAllowed || status == errSecAuthFailed {
      var authQuery = basicQuery
      let authContext = context ?? {
        let ctx = LAContext()
        ctx.touchIDAuthenticationAllowableReuseDuration = 5
        ctx.localizedFallbackTitle = "Use Passcode"
        return ctx
      }()
      authQuery[kSecUseAuthenticationContext as String] = authContext
      if let result = fetchOrRecoverKey(query: authQuery, label: "with authentication context") {
        return result
      }
    }

    // Key not found — create it
    if status == errSecItemNotFound {
      print("[KeychainService] Key not found, attempting to create...")
      return generateAndFetchKey(query: basicQuery)
    }

    print("[KeychainService] Failed to retrieve key with status: \(statusDescription(status))")
    return .failure(.keyManagementError("Failed to retrieve signing key: \(statusDescription(status))"))
  }
  #endif

  private func basePrivateKeyQuery() -> [String: Any] {
    [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag,
      kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
      kSecReturnRef as String: true,
    ]
  }

  private func fetchSecKey(query: [String: Any]) -> SecKey? {
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let candidate = item,
      CFGetTypeID(candidate) == SecKeyGetTypeID()
    else { return nil }
    return (candidate as! SecKey) // swiftlint:disable:this force_cast
  }

  private func fetchOrRecoverKey(query: [String: Any], label: String) -> CardResult<SecKey>? {
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess else { return nil }

    if let candidate = item, CFGetTypeID(candidate) == SecKeyGetTypeID() {
      print("[KeychainService] Successfully retrieved key \(label)")
      // swiftlint:disable:next force_cast
      return .success(candidate as! SecKey)
    }

    // Stale entry — cleanup and regenerate
    print("[KeychainService] Stale key detected (\(label)), cleaning up and regenerating...")
    cleanupAllOldKeys()
    clearInMemoryKey()
    return generateAndFetchKey(query: query)
  }

  private func generateAndFetchKey(query: [String: Any]) -> CardResult<SecKey> {
    switch ensureSigningKey() {
    case .failure(let error):
      return .failure(error)
    case .success:
      if let key = fetchSecKey(query: query) { return .success(key) }
      return .failure(.keyManagementError("Key not usable after generation"))
    }
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
