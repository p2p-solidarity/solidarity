//
//  KeychainService+Generation.swift
//  solidarity
//
//  Created by Solidarity Team.
//

import CryptoKit
import Foundation
import LocalAuthentication
import Security
import SpruceIDMobileSdkRs

extension KeychainService {

  /// Ensures the signing key exists, generating it if needed.
  func ensureSigningKey() -> CardResult<Void> {
    Self.keyLock.lock()
    defer { Self.keyLock.unlock() }

    if alias == Self.masterAlias {
      return ensureCloudSyncedMasterSigningKey()
    }

    if keyExists() {
      print("[KeychainService] Signing key already exists")
      return .success(())
    }

    print("[KeychainService] Signing key not found, generating new key")

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
        // Try software-based key as backup
        switch generateSigningKey(useSecureEnclave: false) {
        case .success:
          print("[KeychainService] Successfully generated software-based signing key (fallback)")
          return .success(())
        case .failure(let secondError):
          print("[KeychainService] Software key also failed: \(secondError)")
          return .failure(combine(firstError, secondError))
        }
      }
    #endif
  }

  private func ensureCloudSyncedMasterSigningKey() -> CardResult<Void> {
    if keyExists() {
      // keyExists() confirmed a private key is present — now verify it's cloud-sync compatible
      // AND the private key is actually retrievable (not just metadata)
      if isMasterKeyCloudSyncCompatible(), existingPrivateKeyReference() != nil {
        print("[KeychainService] Cloud-synced master signing key already exists and is usable")
        return .success(())
      }

      // Key exists but is either not cloud-sync compatible or private key is not retrievable
      print(
        "[KeychainService] Existing master key is not usable (incompatible or private key not retrievable). "
        + "Rotating to shared iCloud key."
      )
      clearInMemoryKey()
      switch deleteSigningKey() {
      case .success:
        break
      case .failure(let error):
        return .failure(error)
      }
    }

    print("[KeychainService] Generating cloud-synced master signing key")
    switch generateSigningKey(useSecureEnclave: false) {
    case .success:
      print("[KeychainService] Successfully prepared cloud-synced master signing key")
      return .success(())
    case .failure(let error):
      print("[KeychainService] Failed to prepare cloud-synced master signing key: \(error)")
      return .failure(error)
    }
  }

  func cleanupAllOldKeys() {
    print("[KeychainService] Cleaning up old/stale keys...")
    deleteAllKeysWithTag()
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
          kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked,
          kSecAttrSynchronizable as String: kCFBooleanTrue as Any,
        ]

        let status = SecItemAdd(addQuery as CFDictionary, nil)
        if status == errSecSuccess {
          print("[KeychainService] Successfully stored simulator key")
          cachePublicJWK(from: key)
          return .success(())
        } else if status == errSecDuplicateItem {
          print("[KeychainService] Key already exists (duplicate), reusing existing key")
          return cacheExistingPublicJWKIfPossible()
            ? .success(())
            : .failure(.keyManagementError("Duplicate simulator key exists but could not load it"))
        } else {
          print("[KeychainService] Failed to store key: \(statusDescription(status)), using in-memory key")
          // Store per-alias as fallback so pairwise RP instances don't collide.
          Self.simulatorInMemoryKeys[alias] = key
          cachePublicJWK(from: key)
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
        Self.simulatorInMemoryKeys[alias] = key
        cachePublicJWK(from: key)
        return .success(())
      }

      return .failure(.keyManagementError("Failed to generate simulator key: \(message)"))
    }
  #endif

  #if !targetEnvironment(simulator)
    private func generateDeviceSigningKey(useSecureEnclave: Bool) -> CardResult<Void> {
      var attributes: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
        kSecAttrKeySizeInBits as String: 256,
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrLabel as String: "Solidarity DID Key",
      ]

      if useSecureEnclave {
        // Secure Enclave requires kSecAttrAccessControl with .privateKeyUsage
        guard
          let accessControl = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlocked,
            accessControlFlags,
            nil
          )
        else {
          return .failure(.keyManagementError("Failed to configure key access control"))
        }
        attributes[kSecAttrAccessControl as String] = accessControl
        attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
      } else {
        // Software keys with iCloud sync: .privateKeyUsage is incompatible with
        // kSecAttrSynchronizable — use kSecAttrAccessible instead of kSecAttrAccessControl
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
        attributes[kSecAttrSynchronizable as String] = kCFBooleanTrue as Any
      }

      var error: Unmanaged<CFError>?
      if let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) {
        print("[KeychainService] Successfully generated persistent device key")
        cachePublicJWK(from: key)
        return .success(())
      }

      // If persistent key generation failed, check if it's a duplicate error
      let cfError = error?.takeRetainedValue()
      let message =
        (cfError as Error?)?.localizedDescription
        ?? "Unknown error (\(statusDescription(errSecParam)))"

      let errorCode = (cfError as? NSError)?.code ?? 0
      let isDuplicateOrConflict =
        errorCode == -25293 || errorCode == -25299 || errorCode == -50
        || message.contains("-25293") || message.contains("-25299")
        || message.contains("duplicate") || message.contains("errSecDuplicateItem")
        || message.contains("-50")

      if isDuplicateOrConflict {
        print("[KeychainService] Duplicate/conflict key detected (code: \(errorCode)), trying to reuse existing key")
        if cacheExistingPublicJWKIfPossible() {
          return .success(())
        }

        // Existing key can't be loaded — aggressive cleanup of ALL key variants before retry
        print("[KeychainService] Stale key detected, running aggressive cleanup before retry...")
        cleanupAllOldKeys()
        clearInMemoryKey()

        // Build clean attributes from scratch (no SE tokens carried over from original)
        let retryAttributes: [String: Any] = [
          kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
          kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
          kSecAttrKeySizeInBits as String: 256,
          kSecAttrIsPermanent as String: true,
          kSecAttrApplicationTag as String: keyTag,
          kSecAttrLabel as String: "Solidarity DID Key",
          kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked,
          kSecAttrSynchronizable as String: kCFBooleanTrue as Any,
        ]

        var retryError: Unmanaged<CFError>?
        if let retryKey = SecKeyCreateRandomKey(retryAttributes as CFDictionary, &retryError) {
          print("[KeychainService] Successfully regenerated key after aggressive cleanup")
          cachePublicJWK(from: retryKey)
          return .success(())
        }

        // Persistent retry also failed — fall back to session-based (in-memory) key
        let retryMessage = (retryError?.takeRetainedValue() as Error?)?.localizedDescription ?? "Unknown error"
        print("[KeychainService] Persistent retry failed (\(retryMessage)), falling back to session-based key...")
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
          kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked,
          kSecAttrSynchronizable as String: kCFBooleanTrue as Any,
        ]

        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        if addStatus == errSecSuccess {
          print("[KeychainService] Successfully stored session key in keychain")
          cachePublicJWK(from: sessionKey)
          return .success(())
        } else if addStatus == errSecDuplicateItem {
          print("[KeychainService] Session key already exists (duplicate), reusing existing key")
          return cacheExistingPublicJWKIfPossible()
            ? .success(())
            : .failure(.keyManagementError("Duplicate session key exists but could not load it"))
        } else {
          print("[KeychainService] Failed to store session key: \(statusDescription(addStatus)), using in-memory key")
          // Scope the fallback by alias so pairwise RP keys never collapse
          // onto the master key or each other.
          Self.deviceInMemoryKeys[alias] = sessionKey
          cachePublicJWK(from: sessionKey)
          return .success(())
        }
      }

      // Last resort: create completely in-memory key
      sessionAttributes.removeValue(forKey: kSecAttrApplicationTag as String)
      if let inMemoryKey = SecKeyCreateRandomKey(sessionAttributes as CFDictionary, nil) {
        print("[KeychainService] Successfully created in-memory key as fallback")
        Self.deviceInMemoryKeys[alias] = inMemoryKey
        cachePublicJWK(from: inMemoryKey)
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
}
