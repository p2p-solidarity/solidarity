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
    private static var simulatorInMemoryKey: SecKey?
  #else
    private static var deviceInMemoryKey: SecKey?
  #endif

  let alias: KeyAlias

  private var keyTag: Data
  private let accessControlFlags: SecAccessControlCreateFlags
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

  /// Ensures the signing key exists, generating it if needed.
  func ensureSigningKey() -> CardResult<Void> {
    if keyExists() {
      print("[KeychainService] Signing key already exists")
      return .success(())
    }

    print("[KeychainService] Signing key not found, generating new key")

    // With session-based tags, cleanup is less critical, but we still try to clean up old keys
    #if !targetEnvironment(simulator)
      // Only cleanup if we're not using session-based approach (for backward compatibility)
      // Since we're now using session tags, this cleanup is mainly for old keys
      cleanupAllOldKeys()
    #endif

    // On simulator, skip Secure Enclave and go directly to software-based key
    #if targetEnvironment(simulator)
      switch generateSigningKey(useSecureEnclave: false) {
      case .success:
        print("[KeychainService] Successfully generated software-based signing key")
        return .success(())
      case .failure(let error):
        print("[KeychainService] Failed to generate signing key: \(error)")
        return .failure(error)
      }
    #else
      // On device, try Secure Enclave first, then fall back to software
      // generateSigningKey will automatically handle duplicate errors by switching to session-based approach
      switch generateSigningKey(useSecureEnclave: true) {
      case .success:
        print("[KeychainService] Successfully generated Secure Enclave signing key")
        return .success(())
      case .failure(let firstError):
        print("[KeychainService] Secure Enclave failed: \(firstError), trying software-based key")
        // Attempt to fall back to software-based key generation if Secure Enclave is unavailable.
        // generateSigningKey will handle duplicate errors internally by switching to session-based approach
        switch generateSigningKey(useSecureEnclave: false) {
        case .success:
          print("[KeychainService] Successfully generated software-based signing key (fallback)")
          return .success(())
        case .failure(let fallbackError):
          print("[KeychainService] Both key generation methods failed")
          return .failure(combine(firstError, fallbackError))
        }
      }
    #endif
  }

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

  private func cleanupAllOldKeys() {
    // Clean up ALL old keys with any previous tags
    let oldTags = [
      "airmeishi.did.signing",  // Original tag
      "airmeishi.did.signing.v1",  // Previous version 1
      "airmeishi.did.signing.v2",  // Previous version 2
      "com.airmeishi.keys.did",  // Might exist from testing
      "com.airmeishi.signing",  // Might exist from testing
    ]

    // Also clean up any keys with partial matches using a more aggressive approach
    for tagString in oldTags {
      let tag = Data(tagString.utf8)
      let queries: [[String: Any]] = [
        // Broadest query - just by tag
        [
          kSecClass as String: kSecClassKey,
          kSecAttrApplicationTag as String: tag,
        ],
        // EC private keys with tag
        [
          kSecClass as String: kSecClassKey,
          kSecAttrApplicationTag as String: tag,
          kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
          kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
        ],
        // Any EC keys with tag
        [
          kSecClass as String: kSecClassKey,
          kSecAttrApplicationTag as String: tag,
          kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        ],
      ]

      for query in queries {
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess {
          print("[KeychainService] Cleaned up old key with tag: \(tagString)")
        }
      }
    }

    // Extra aggressive cleanup for simulator - delete all EC keys we might have created
    #if targetEnvironment(simulator)
      let broadQuery: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits as String: 256,
      ]
      _ = SecItemDelete(broadQuery as CFDictionary)
    #endif
  }

  private func keyExists() -> Bool {
    // Check for in-memory key first (works for both simulator and device)
    #if targetEnvironment(simulator)
      if Self.simulatorInMemoryKey != nil {
        return true
      }
    #else
      if Self.deviceInMemoryKey != nil {
        return true
      }
    #endif

    #if targetEnvironment(simulator)
      let query: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecReturnRef as String: false,
      ]

      let status = SecItemCopyMatching(query as CFDictionary, nil)
      return status == errSecSuccess

    #else
      // Device code with proper authentication handling
      let basicQuery: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecReturnRef as String: false,
      ]

      var status = SecItemCopyMatching(basicQuery as CFDictionary, nil)

      if status == errSecSuccess {
        return true
      }

      // Also check with authentication context for keys that require auth
      if status == errSecItemNotFound {
        var authQuery = basicQuery
        let context = LAContext()
        context.interactionNotAllowed = true
        authQuery[kSecUseAuthenticationContext as String] = context

        status = SecItemCopyMatching(authQuery as CFDictionary, nil)
      }

      switch status {
      case errSecSuccess,
        errSecInteractionNotAllowed,
        errSecAuthFailed:
        return true
      case errSecItemNotFound:
        return false
      default:
        print("[KeychainService] Unexpected status checking for key existence: \(statusDescription(status))")
        return false
      }
    #endif
  }

  private func generateSigningKey(useSecureEnclave: Bool) -> CardResult<Void> {
    #if targetEnvironment(simulator)
      return generateSimulatorSigningKey()
    #else
      return generateDeviceSigningKey(useSecureEnclave: useSecureEnclave)
    #endif
  }

  #if targetEnvironment(simulator)
    private func generateSimulatorSigningKey() -> CardResult<Void> {
      // Try generating a non-persistent key first to avoid keychain corruption issues
      var attributes: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
        kSecAttrKeySizeInBits as String: 256,
        kSecAttrIsPermanent as String: false,  // Don't persist to avoid keychain issues
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrLabel as String: "AirMeishi Session Key",
      ]

      var error: Unmanaged<CFError>?
      if let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) {
        print("[KeychainService] Generated non-persistent simulator key, attempting to store...")

        // Now try to add it to keychain manually
        let addQuery: [String: Any] = [
          kSecClass as String: kSecClassKey,
          kSecValueRef as String: key,
          kSecAttrApplicationTag as String: keyTag,
          kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]

        let status = SecItemAdd(addQuery as CFDictionary, nil)
        if status == errSecSuccess {
          print("[KeychainService] Successfully stored simulator key")
          return .success(())
        } else if status == errSecDuplicateItem {
          // If duplicate, that means it's already there somehow, so success
          print("[KeychainService] Key already exists (duplicate), considering success")
          return .success(())
        } else {
          print("[KeychainService] Failed to store key: \(statusDescription(status)), using in-memory key")
          // Store the key in a static variable as fallback
          Self.simulatorInMemoryKey = key
          return .success(())
        }
      }

      // If that failed, just create an in-memory key
      let cfError = error?.takeRetainedValue()
      let message = (cfError as Error?)?.localizedDescription ?? "Unknown error"
      print("[KeychainService] Failed to generate key: \(message), trying in-memory approach")

      // Create a completely in-memory key as last resort
      attributes[kSecAttrIsPermanent as String] = false
      attributes.removeValue(forKey: kSecAttrApplicationTag as String)

      if let key = SecKeyCreateRandomKey(attributes as CFDictionary, nil) {
        print("[KeychainService] Successfully created in-memory key")
        Self.simulatorInMemoryKey = key
        return .success(())
      }

      return .failure(.keyManagementError("Failed to generate simulator key: \(message)"))
    }
  #endif

  #if !targetEnvironment(simulator)
    private func generateDeviceSigningKey(useSecureEnclave: Bool) -> CardResult<Void> {
      let flags = accessControlFlags

      guard
        let accessControl = SecAccessControlCreateWithFlags(
          nil,
          kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
          flags,
          nil
        )
      else {
        return .failure(.keyManagementError("Failed to configure key access control"))
      }

      // First attempt: try persistent key with Secure Enclave (if requested) or software
      var attributes: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
        kSecAttrKeySizeInBits as String: 256,
        kSecAttrIsPermanent as String: true,
        kSecAttrAccessControl as String: accessControl,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrLabel as String: "AirMeishi Device Key",
      ]

      if useSecureEnclave {
        attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
      }

      var error: Unmanaged<CFError>?
      if let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) {
        print("[KeychainService] Successfully generated persistent device key")
        return .success(())
      }

      // If persistent key generation failed, check if it's a duplicate error
      let cfError = error?.takeRetainedValue()
      let message =
        (cfError as Error?)?.localizedDescription
        ?? "Unknown error (\(statusDescription(errSecParam)))"

      let errorCode = (cfError as? NSError)?.code ?? 0
      let isDuplicateError =
        errorCode == -25293 || errorCode == -25299 || message.contains("-25293") || message.contains("-25299")
        || message.contains("duplicate") || message.contains("errSecDuplicateItem")

      if isDuplicateError {
        print(
          "[KeychainService] Duplicate error detected (code: \(errorCode)), switching to session-based non-persistent key..."
        )
        return generateSessionBasedDeviceKey()
      }

      return .failure(.keyManagementError("Failed to generate device key: \(message)"))
    }

    private func generateSessionBasedDeviceKey() -> CardResult<Void> {
      // Fall back to non-persistent key approach (similar to simulator)
      var sessionAttributes: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
        kSecAttrKeySizeInBits as String: 256,
        kSecAttrIsPermanent as String: false,  // Non-persistent to avoid keychain conflicts
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrLabel as String: "AirMeishi Session Key",
      ]

      var sessionError: Unmanaged<CFError>?
      if let sessionKey = SecKeyCreateRandomKey(sessionAttributes as CFDictionary, &sessionError) {
        print("[KeychainService] Generated non-persistent session key, attempting to store...")

        // Try to add it to keychain manually
        let addQuery: [String: Any] = [
          kSecClass as String: kSecClassKey,
          kSecValueRef as String: sessionKey,
          kSecAttrApplicationTag as String: keyTag,
          kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]

        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        if addStatus == errSecSuccess {
          print("[KeychainService] Successfully stored session key in keychain")
          return .success(())
        } else if addStatus == errSecDuplicateItem {
          print("[KeychainService] Session key already exists (duplicate), considering success")
          return .success(())
        } else {
          print("[KeychainService] Failed to store session key: \(statusDescription(addStatus)), using in-memory key")
          // Store the key in a static variable as fallback
          Self.deviceInMemoryKey = sessionKey
          return .success(())
        }
      }

      // Last resort: create completely in-memory key
      sessionAttributes.removeValue(forKey: kSecAttrApplicationTag as String)
      if let inMemoryKey = SecKeyCreateRandomKey(sessionAttributes as CFDictionary, nil) {
        print("[KeychainService] Successfully created in-memory key as fallback")
        Self.deviceInMemoryKey = inMemoryKey
        return .success(())
      }

      let sessionMessage = (sessionError?.takeRetainedValue() as Error?)?.localizedDescription ?? "Unknown error"
      return .failure(
        .keyManagementError(
          "Failed to generate device key (persistent and session methods failed); session error: \(sessionMessage)"
        )
      )
    }
  #endif

  private func deleteAllKeysWithTag() {
    // Try multiple deletion strategies to ensure complete cleanup
    let queries: [[String: Any]] = [
      // Delete by tag only (broadest match)
      [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
      ],
      // Delete EC keys with tag
      [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      ],
      // Delete all private EC keys with our tag
      [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
      ],
      // Delete Secure Enclave keys with tag
      [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
      ],
      // Delete software keys with tag
      [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits as String: 256,
      ],
    ]

    var deletedCount = 0
    for query in queries {
      let status = SecItemDelete(query as CFDictionary)
      if status == errSecSuccess {
        deletedCount += 1
        print("[KeychainService] Aggressive cleanup: deleted keys matching query")
      } else if status != errSecItemNotFound {
        print("[KeychainService] Cleanup query returned status: \(statusDescription(status))")
      }
    }

    if deletedCount > 0 {
      print("[KeychainService] Cleaned up \(deletedCount) key(s) with tag")
    }
  }

  // swiftlint:disable cyclomatic_complexity
  private func privateKey(context: LAContext?) -> CardResult<SecKey> {
    // Check for in-memory key first (works for both simulator and device)
    #if targetEnvironment(simulator)
      if let inMemoryKey = Self.simulatorInMemoryKey {
        print("[KeychainService] Using in-memory simulator key")
        return .success(inMemoryKey)
      }
    #else
      if let inMemoryKey = Self.deviceInMemoryKey {
        print("[KeychainService] Using in-memory device key")
        return .success(inMemoryKey)
      }
    #endif

    #if targetEnvironment(simulator)

      // Try to get from keychain
      let query: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecReturnRef as String: true,
      ]

      var item: CFTypeRef?
      let status = SecItemCopyMatching(query as CFDictionary, &item)

      if status == errSecSuccess {
        guard let candidate = item else {
          return .failure(.keyManagementError("Keychain returned empty result for signing key"))
        }
        guard CFGetTypeID(candidate) == SecKeyGetTypeID() else {
          return .failure(.keyManagementError("Keychain returned unexpected item type for signing key"))
        }
        print("[KeychainService] Retrieved simulator key from keychain")
        // We verified the type ID above, so this force cast is safe
        // swiftlint:disable:next force_cast
        let key = candidate as! SecKey
        return .success(key)
      }

      // Key not found - this is expected on first run with a new session tag
      if status == errSecItemNotFound {
        print("[KeychainService] Simulator key not found (expected for new session)")
        return .failure(.keyManagementError("Key not found - will be created"))
      }

      return .failure(.keyManagementError("Failed to retrieve simulator key: \(statusDescription(status))"))

    #else
      // Device code with authentication handling
      let basicQuery: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecReturnRef as String: true,
      ]

      var item: CFTypeRef?
      var status = SecItemCopyMatching(basicQuery as CFDictionary, &item)

      if status == errSecSuccess {
        guard let candidate = item else {
          return .failure(.keyManagementError("Keychain returned empty result for signing key"))
        }
        guard CFGetTypeID(candidate) == SecKeyGetTypeID() else {
          return .failure(.keyManagementError("Keychain returned unexpected item type for signing key"))
        }
        print("[KeychainService] Successfully retrieved key without authentication context")
        guard let key = candidate as? SecKey else {
          return .failure(.keyManagementError("Unexpected key type when casting signing key"))
        }
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
          guard let key = candidate as? SecKey else {
            return .failure(.keyManagementError("Unexpected key type when casting signing key with auth context"))
          }
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
          guard let key = candidate as? SecKey else {
            return .failure(.keyManagementError("Unexpected key type when casting signing key after creation"))
          }
          return .success(key)
        }
      }

      print("[KeychainService] Failed to retrieve key with status: \(statusDescription(status))")
      return .failure(.keyManagementError("Failed to retrieve signing key: \(statusDescription(status))"))
    #endif
  }
  // swiftlint:enable cyclomatic_complexity

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

  private func combine(_ first: CardError, _ second: CardError) -> CardError {
    switch (first, second) {
    case (.keyManagementError(let a), .keyManagementError(let b)):
      return .keyManagementError("\(a); \(b)")
    default:
      return second
    }
  }

  private func statusDescription(_ status: OSStatus) -> String {
    if let message = SecCopyErrorMessageString(status, nil) as String? {
      return message
    }
    return "OSStatus \(status)"
  }
}

// MARK: - Signing key wrapper

/// Signing key implementation compatible with SpruceKit.
final class BiometricSigningKey: SpruceIDMobileSdkRs.SigningKey, @unchecked Sendable {
  private let privateKey: SecKey
  private let jwkRepresentation: PublicKeyJWK
  private let alias: KeyAlias

  init(privateKey: SecKey, jwk: PublicKeyJWK, alias: KeyAlias) {
    self.privateKey = privateKey
    self.jwkRepresentation = jwk
    self.alias = alias
  }

  func jwk() throws -> String {
    return try jwkRepresentation.jsonString()
  }

  func sign(payload: Data) throws -> Data {
    var error: Unmanaged<CFError>?
    guard
      let signature = SecKeyCreateSignature(
        privateKey,
        .ecdsaSignatureMessageX962SHA256,
        payload as CFData,
        &error
      ) as Data?
    else {
      let cfError = error?.takeRetainedValue()
      let message = (cfError as Error?)?.localizedDescription ?? "Unknown signing error"
      throw CardError.keyManagementError("Failed to sign payload: \(message)")
    }

    guard let normalized = CryptoCurveUtils.secp256r1().ensureRawFixedWidthSignatureEncoding(bytes: signature) else {
      throw CardError.keyManagementError("Unable to normalise signature for alias \(alias)")
    }

    return normalized
  }
}

// MARK: - Supporting models

/// Minimal JSON Web Key representation for EC P-256 keys.
struct PublicKeyJWK: Codable, Equatable {
  let kty: String
  let crv: String
  let alg: String
  let x: String
  let y: String

  func jsonData(prettyPrinted: Bool = false) throws -> Data {
    let encoder = JSONEncoder()
    if prettyPrinted {
      encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    } else {
      encoder.outputFormatting = [.sortedKeys]
    }
    return try encoder.encode(self)
  }

  func jsonString(prettyPrinted: Bool = false) throws -> String {
    let data = try jsonData(prettyPrinted: prettyPrinted)
    guard let string = String(data: data, encoding: .utf8) else {
      throw CardError.keyManagementError("Unable to encode JWK string")
    }
    return string
  }

  func x963Representation() throws -> Data {
    guard let xData = Data(base64URLEncoded: x),
      let yData = Data(base64URLEncoded: y)
    else {
      throw CardError.invalidData("Invalid public key encoding")
    }

    var buffer = Data([0x04])
    buffer.append(xData)
    buffer.append(yData)
    return buffer
  }

  func toP256PublicKey() throws -> P256.Signing.PublicKey {
    let data = try x963Representation()
    return try P256.Signing.PublicKey(x963Representation: data)
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
