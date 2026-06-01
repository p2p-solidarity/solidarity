//
//  SpruceDidKeyStore.swift
//  @solidarity/nitro-spruce-did (iOS)
//
//  Apple Keychain + Secure Enclave wrapper. Extracted from HybridSpruceDid.swift
//  to keep that file under the 500-line CLAUDE.md ceiling. Pure storage
//  layer — no event emission, no async wrapping. The Hybrid class is
//  responsible for spawning Promises / firing events; this struct knows
//  Keychain syntax and CryptoKit only.
//

import CryptoKit
import Foundation
import Security

internal struct SpruceDidKeyStore {

  /// Shared `kSecAttrService` namespace for ed25519 generic-password rows.
  let keychainService: String

  /// `kSecAttrApplicationTag` prefix for EC key entries.
  let keyTagPrefix: String

  // MARK: - Tag helpers

  private func keyTag(for alias: String) -> Data {
    Data((keyTagPrefix + alias).utf8)
  }

  // MARK: - Generation

  /// Hardware-backed P-256. Stores in Secure Enclave on real iOS; falls back
  /// to a software key on the simulator (which doesn't emulate SE). Returns
  /// `true` if the key landed in Secure Enclave, `false` for simulator path.
  func generateP256Key(alias: String, requireBiometric: Bool) throws -> Bool {
    _ = deleteKey(alias: alias)

    let flags: SecAccessControlCreateFlags = requireBiometric
      ? [.privateKeyUsage, .userPresence]
      : [.privateKeyUsage]
    var error: Unmanaged<CFError>?
    guard
      let access = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault,
        kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        flags,
        &error
      )
    else {
      let cfError = error?.takeRetainedValue()
      let msg = (cfError as Error?)?.localizedDescription ?? "unknown"
      throw SpruceDidError.keychainFailure(
        -1, "SecAccessControlCreateWithFlags failed: \(msg)")
    }

    let privateKeyAttributes: [String: Any] = [
      kSecAttrIsPermanent as String: true,
      kSecAttrApplicationTag as String: keyTag(for: alias),
      kSecAttrAccessControl as String: access,
    ]

    var attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecPrivateKeyAttrs as String: privateKeyAttributes,
    ]

    let hardware: Bool
    if Self.isSimulator() {
      hardware = false
      // Drop the SE token attribute — software P-256 keys still go through
      // SecKeyCreateRandomKey and live in the keychain under the same tag.
    } else {
      attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
      hardware = true
    }

    var keyError: Unmanaged<CFError>?
    guard SecKeyCreateRandomKey(attributes as CFDictionary, &keyError) != nil else {
      let cfError = keyError?.takeRetainedValue()
      let msg = (cfError as Error?)?.localizedDescription ?? "unknown"
      throw SpruceDidError.keychainFailure(-2, "SecKeyCreateRandomKey failed: \(msg)")
    }
    return hardware
  }

  /// Software (NON-Secure-Enclave) P-256 key stored as a SYNCHRONISABLE
  /// keychain item, so iCloud Keychain replicates it across the user's devices
  /// on the same Apple ID. This is the *portable identity* path used by the
  /// master signing alias (see `apps/expo/src/keychain/signingKey.ts`): the
  /// did:key derived from this key survives a wipe / reinstall / device
  /// migration, which a Secure Enclave key fundamentally cannot — an SE
  /// private key never leaves hardware, so it can be neither backed up nor
  /// synced, and a restore-from-iCloud therefore always orphaned the user's
  /// credentials (the bug this fixes).
  ///
  /// Tradeoffs vs `generateP256Key`, by deliberate design choice:
  ///   • The private key is software-resident (weaker extraction resistance
  ///     than Secure Enclave).
  ///   • It carries NO biometric access-control flag — iCloud-syncable items
  ///     cannot be biometric-bound (the ACL is device-specific). The biometric
  ///     gate is enforced one layer up in JS (`requireBiometric('sign')`)
  ///     before every sign, so the Face ID UX is unchanged.
  ///   • Accessibility is `WhenUnlocked` (NOT `…ThisDeviceOnly`, which would
  ///     opt the item out of sync) — the closest syncable equivalent to the
  ///     SE key's `WhenUnlockedThisDeviceOnly`.
  ///
  /// No special entitlement is required: synchronizable items replicate within
  /// the app's own default keychain access group when the user has iCloud
  /// Keychain enabled. iOS-only — Android has no iCloud Keychain.
  func generateSyncableP256Key(alias: String) throws {
    _ = deleteKey(alias: alias)

    let privateKeyAttributes: [String: Any] = [
      kSecAttrIsPermanent as String: true,
      kSecAttrApplicationTag as String: keyTag(for: alias),
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked,
      kSecAttrSynchronizable as String: true,
    ]

    // No `kSecAttrTokenID` → software key. Secure Enclave keys cannot be
    // marked synchronizable, so the SE path is intentionally not taken here.
    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecPrivateKeyAttrs as String: privateKeyAttributes,
    ]

    var keyError: Unmanaged<CFError>?
    guard SecKeyCreateRandomKey(attributes as CFDictionary, &keyError) != nil else {
      let cfError = keyError?.takeRetainedValue()
      let msg = (cfError as Error?)?.localizedDescription ?? "unknown"
      throw SpruceDidError.keychainFailure(
        -4, "SecKeyCreateRandomKey (syncable) failed: \(msg)")
    }
  }

  /// Generates a fresh Curve25519 keypair, stored as a Keychain generic
  /// password protected by `userPresence` when biometrics required.
  func generateEd25519Key(alias: String, requireBiometric: Bool) throws {
    let key = Curve25519.Signing.PrivateKey()
    let raw = key.rawRepresentation

    let access: SecAccessControl?
    if requireBiometric {
      var err: Unmanaged<CFError>?
      access = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        [.userPresence], &err
      )
      if access == nil {
        let cfError = err?.takeRetainedValue()
        let msg = (cfError as Error?)?.localizedDescription ?? "unknown"
        throw SpruceDidError.keychainFailure(
          -3, "SecAccessControlCreateWithFlags failed: \(msg)")
      }
    } else {
      access = nil
    }

    // Tear down stale entry so generation is idempotent.
    let deleteQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: alias,
    ]
    SecItemDelete(deleteQuery as CFDictionary)

    var addQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: alias,
      kSecAttrLabel as String: "ed25519",
      kSecValueData as String: raw,
    ]
    if let access = access {
      addQuery[kSecAttrAccessControl as String] = access
    } else {
      addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    }

    let status = SecItemAdd(addQuery as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw SpruceDidError.keychainFailure(status, "SecItemAdd (ed25519) failed")
    }
  }

  // MARK: - Lookup

  func hasKey(alias: String) -> Bool {
    let ecQuery: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag(for: alias),
      kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecReturnRef as String: true,
      // Match both the legacy non-synced SE key AND the synchronizable
      // software key (`generateSyncableP256Key`) so iCloud-synced identities
      // are found on a second device.
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
    ]
    var item: CFTypeRef?
    if SecItemCopyMatching(ecQuery as CFDictionary, &item) == errSecSuccess {
      return true
    }
    let genQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: alias,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    return SecItemCopyMatching(genQuery as CFDictionary, nil) == errSecSuccess
  }

  func fetchECPrivateKey(alias: String) throws -> SecKey {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag(for: alias),
      kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecReturnRef as String: true,
      // Match both the legacy non-synced SE key AND the synchronizable
      // software key (`generateSyncableP256Key`) so iCloud-synced identities
      // are found on a second device.
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let candidate = item,
      CFGetTypeID(candidate) == SecKeyGetTypeID()
    else {
      throw SpruceDidError.keyNotFound(alias)
    }
    return candidate as! SecKey  // swiftlint:disable:this force_cast
  }

  /// Resolves the alias to its public-key JWK JSON string. Tries EC first
  /// (the primary path), then ed25519, then throws `keyNotFound`.
  func publicKeyJwk(alias: String) throws -> String {
    let ecQuery: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag(for: alias),
      kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecReturnRef as String: true,
      // Match both the legacy non-synced SE key AND the synchronizable
      // software key (`generateSyncableP256Key`) so iCloud-synced identities
      // are found on a second device.
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
    ]
    var item: CFTypeRef?
    if SecItemCopyMatching(ecQuery as CFDictionary, &item) == errSecSuccess,
      let candidate = item, CFGetTypeID(candidate) == SecKeyGetTypeID()
    {
      let priv = candidate as! SecKey  // swiftlint:disable:this force_cast
      guard let pub = SecKeyCopyPublicKey(priv) else {
        throw SpruceDidError.signFailed("SecKeyCopyPublicKey returned nil")
      }
      var error: Unmanaged<CFError>?
      guard let data = SecKeyCopyExternalRepresentation(pub, &error) as Data? else {
        let cfError = error?.takeRetainedValue()
        let msg = (cfError as Error?)?.localizedDescription ?? "unknown"
        throw SpruceDidError.signFailed("SecKeyCopyExternalRepresentation failed: \(msg)")
      }
      return try JwkUtils.p256JwkJsonString(uncompressedPoint: data)
    }

    let genQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: alias,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var raw: CFTypeRef?
    if SecItemCopyMatching(genQuery as CFDictionary, &raw) == errSecSuccess,
      let bytes = raw as? Data
    {
      let priv = try Curve25519.Signing.PrivateKey(rawRepresentation: bytes)
      let pubBytes = priv.publicKey.rawRepresentation
      return try JwkUtils.ed25519JwkJsonString(rawPublic: pubBytes)
    }
    throw SpruceDidError.keyNotFound(alias)
  }

  // MARK: - Deletion

  /// Deletes both EC and ed25519 entries for the alias. Returns true iff
  /// at least one entry was actually present.
  @discardableResult
  func deleteKey(alias: String) -> Bool {
    var anySuccess = false
    let ecQuery: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag(for: alias),
      // Delete both the non-synced SE key and a synchronizable software key,
      // so regenerating a syncable key is idempotent.
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
    ]
    if SecItemDelete(ecQuery as CFDictionary) == errSecSuccess { anySuccess = true }

    let genQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: alias,
    ]
    if SecItemDelete(genQuery as CFDictionary) == errSecSuccess { anySuccess = true }
    return anySuccess
  }

  // MARK: - Misc

  static func isSimulator() -> Bool {
    #if targetEnvironment(simulator)
      return true
    #else
      return false
    #endif
  }
}
