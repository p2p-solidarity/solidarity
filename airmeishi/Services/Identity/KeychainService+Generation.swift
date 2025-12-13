//
//  KeychainService+Generation.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import CryptoKit
import Foundation
import LocalAuthentication
import Security

extension KeychainService {

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
      if let _ = SecKeyCreateRandomKey(attributes as CFDictionary, &error) {
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
}
