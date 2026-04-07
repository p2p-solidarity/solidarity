//
//  KeychainService+KeyUtilities.swift
//  solidarity
//
//  Created by Solidarity Team.
//

import CryptoKit
import Foundation
import Security
import SpruceIDMobileSdkRs

extension KeychainService {

  func cacheExistingPublicJWKIfPossible() -> Bool {
    guard let existingKey = existingPrivateKeyReference() else {
      print("[KeychainService] Unable to find existing key for tag \(alias)")
      return false
    }
    cachePublicJWK(from: existingKey)
    return true
  }

  func existingPrivateKeyReference() -> SecKey? {
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
      return nil
    }
    guard CFGetTypeID(candidate) == SecKeyGetTypeID() else {
      return nil
    }
    return unsafeBitCast(candidate, to: SecKey.self)
  }

  func existingKeyAttributes() -> [String: Any]? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecReturnAttributes as String: true,
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess else {
      return nil
    }
    return item as? [String: Any]
  }

  func isMasterKeyCloudSyncCompatible() -> Bool {
    guard let attributes = existingKeyAttributes() else {
      return false
    }
    let synchronizable = (attributes[kSecAttrSynchronizable as String] as? NSNumber)?.boolValue ?? false
    let tokenId = attributes[kSecAttrTokenID as String] as? String
    guard synchronizable && tokenId != (kSecAttrTokenIDSecureEnclave as String) else {
      return false
    }
    // Verify the private key is actually readable — attributes alone don't guarantee usability
    return existingPrivateKeyReference() != nil
  }

  func clearInMemoryKey() {
    #if targetEnvironment(simulator)
      Self.simulatorInMemoryKey = nil
    #else
      Self.deviceInMemoryKey = nil
    #endif
  }

  func cachePublicJWK(from privateKey: SecKey) {
    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
      print("[KeychainService] cachePublicJWK: failed to derive public key")
      return
    }
    var error: Unmanaged<CFError>?
    guard let data = SecKeyCopyExternalRepresentation(publicKey, &error) as Data?,
          data.count == 65
    else {
      print("[KeychainService] cachePublicJWK: failed to export public key")
      return
    }
    let x = data.subdata(in: 1..<33)
    let y = data.subdata(in: 33..<65)
    let jwk = PublicKeyJWK(
      kty: "EC", crv: "P-256", alg: "ES256",
      x: x.base64URLEncodedString(),
      y: y.base64URLEncodedString()
    )
    do {
      let didUtils = DidMethodUtils(method: .key)
      let did = try didUtils.didFromJwk(jwk: try jwk.jsonString())
      let descriptor = DIDDescriptor(
        did: did,
        verificationMethodId: "\(did)#keys-1",
        jwk: jwk
      )
      IdentityCacheStore().saveDescriptor(descriptor)
      print("[KeychainService] cachePublicJWK: cached DID \(did)")
    } catch {
      print("[KeychainService] cachePublicJWK: DID derivation failed: \(error)")
    }
  }

  func deleteAllKeysWithTag() {
    // Try multiple deletion strategies to ensure complete cleanup
    // Covers: private/public, synchronizable true/false/any, SE/non-SE
    let queries: [[String: Any]] = [
      // Broadest: any key with this tag
      [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
      ],
      // By key type
      [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      ],
      // Private keys only
      [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
      ],
      // Public keys only (orphan cleanup)
      [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrKeyClass as String: kSecAttrKeyClassPublic,
      ],
      // Secure Enclave keys
      [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
      ],
      // Synchronizable true
      [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrSynchronizable as String: kCFBooleanTrue as Any,
      ],
      // Synchronizable false (local-only)
      [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
      ],
      // Synchronizable any + specific type + size
      [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits as String: 256,
        kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
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
