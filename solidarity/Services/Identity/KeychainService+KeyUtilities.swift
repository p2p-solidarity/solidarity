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
      kSecAttrSynchronizable as String: preferredSyncQueryValue,
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
      kSecAttrSynchronizable as String: preferredSyncQueryValue,
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
      Self.simulatorInMemoryKeys.removeValue(forKey: alias)
    #else
      Self.deviceInMemoryKeys.removeValue(forKey: alias)
    #endif
  }

  func persistentDeviceKeyAttributes(
    useSecureEnclave: Bool,
    accessControl: SecAccessControl? = nil
  ) -> [String: Any] {
    var attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
    ]

    var privateAttributes: [String: Any] = [
      kSecAttrIsPermanent as String: true,
      kSecAttrApplicationTag as String: keyTag,
      kSecAttrLabel as String: "Solidarity DID Key",
    ]

    if useSecureEnclave {
      attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
      if let accessControl {
        privateAttributes[kSecAttrAccessControl as String] = accessControl
      }
    } else {
      privateAttributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
      privateAttributes[kSecAttrSynchronizable as String] = preferredSyncWriteValue
    }

    attributes[kSecPrivateKeyAttrs as String] = privateAttributes
    return attributes
  }

  func privateKeyImportQuery(privateData: Data) -> [String: Any] {
    [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
      kSecAttrKeySizeInBits as String: 256,
      kSecAttrLabel as String: "Solidarity DID Key",
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked,
      kSecAttrSynchronizable as String: preferredSyncWriteValue,
      kSecValueData as String: privateData,
    ]
  }

  /// Diagnostic dump of the keychain state for the current alias.
  ///
  /// Surfaces three classes of failure that all manifest as
  /// "Key not usable after generation": (a) duplicate entries from an iCloud
  /// Keychain race after a wipe; (b) a synced entry whose private key is
  /// findable but not actually usable on this device (no `SecKeyCopyPublicKey`,
  /// no exportable representation); (c) a stale entry under the same tag with
  /// attributes that disagree with the lookup query.
  func dumpMasterKeyState(label: String) {
    let prefix = "[KeychainService][diag:\(label)]"
    print("\(prefix) alias=\(alias)")

    let waitMarker = UserDefaults.standard.bool(forKey: Self.iCloudKeychainSyncWaitMarker)
    let migrationMarker = UserDefaults.standard.bool(
      forKey: "solidarity.migration.completed.\(alias)"
    )
    print("\(prefix) iCloudWaitMarker=\(waitMarker) migrationMarker=\(migrationMarker)")

    #if targetEnvironment(simulator)
      print("\(prefix) inMemoryKey=\(Self.simulatorInMemoryKeys[alias] != nil)")
    #else
      print("\(prefix) inMemoryKey=\(Self.deviceInMemoryKeys[alias] != nil)")
    #endif

    let allQuery: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
      kSecMatchLimit as String: kSecMatchLimitAll,
      kSecReturnAttributes as String: true,
    ]
    var allItems: CFTypeRef?
    let allStatus = SecItemCopyMatching(allQuery as CFDictionary, &allItems)
    if allStatus == errSecSuccess, let items = allItems as? [[String: Any]] {
      print("\(prefix) entriesMatchingTag=\(items.count)")
      for (i, attrs) in items.enumerated() {
        let sync = (attrs[kSecAttrSynchronizable as String] as? NSNumber)?.boolValue ?? false
        let tokenId = attrs[kSecAttrTokenID as String] as? String ?? "(none)"
        let keyClass = attrs[kSecAttrKeyClass as String] as? String ?? "(none)"
        let keyType = attrs[kSecAttrKeyType as String] as? String ?? "(none)"
        let accessible = attrs[kSecAttrAccessible as String] as? String ?? "(none)"
        let keyLabel = attrs[kSecAttrLabel as String] as? String ?? "(none)"
        let isPerm = (attrs[kSecAttrIsPermanent as String] as? NSNumber)?.boolValue ?? false
        print(
          "\(prefix) entry[\(i)] sync=\(sync) tokenId=\(tokenId) keyClass=\(keyClass) "
            + "keyType=\(keyType) accessible=\(accessible) label=\(keyLabel) permanent=\(isPerm)"
        )
      }
    } else {
      print("\(prefix) entriesMatchingTag=status:\(statusDescription(allStatus))")
    }

    if let privateRef = existingPrivateKeyReference() {
      if let publicKey = SecKeyCopyPublicKey(privateRef) {
        var error: Unmanaged<CFError>?
        let exported = SecKeyCopyExternalRepresentation(publicKey, &error) as Data?
        let errMsg = (error?.takeRetainedValue() as Error?)?.localizedDescription ?? "(none)"
        print(
          "\(prefix) existingPrivateKeyReference=found copyPublicKey=ok "
            + "exportBytes=\(exported?.count ?? 0) exportError=\(errMsg)"
        )
      } else {
        print("\(prefix) existingPrivateKeyReference=found copyPublicKey=failed")
      }
    } else {
      print("\(prefix) existingPrivateKeyReference=nil")
    }
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
      #if DEBUG
      print("[KeychainService] cachePublicJWK: cached DID \(did)")
      #endif
    } catch {
      #if DEBUG
      print("[KeychainService] cachePublicJWK: DID derivation failed: \(error)")
      #endif
    }
  }

  func deleteAllKeysWithTag() {
    // Try multiple deletion strategies to ensure complete cleanup.
    // Default `kSecAttrSynchronizable` is `kCFBooleanFalse` (local-only) — for
    // tag-based delete to also reach iCloud-synced phantoms we have to spell
    // out `kSecAttrSynchronizableAny`. Covers: private/public, synchronizable
    // true/false/any, SE/non-SE.
    let queries: [[String: Any]] = [
      // Broadest: any key with this tag (incl. synced)
      [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
      ],
      // By key type (incl. synced)
      [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
      ],
      // Private keys only (incl. synced)
      [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
        kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
      ],
      // Public keys only — orphan cleanup (incl. synced)
      [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrKeyClass as String: kSecAttrKeyClassPublic,
        kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
      ],
      // Secure Enclave keys (SE keys never sync; sync filter omitted)
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
