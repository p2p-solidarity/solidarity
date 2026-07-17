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
import LocalAuthentication
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
    // T7: clear only NON-synced leftovers (stale SE / software keys under the
    // tag). The previous full `deleteKey` used `kSecAttrSynchronizableAny`,
    // which destroyed the iCloud copy of the user's REAL identity key when it
    // replicated in between the caller's `hasKey` probe and this call.
    let staleQuery: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag(for: alias),
      kSecAttrSynchronizable as String: false,
    ]
    SecItemDelete(staleQuery as CFDictionary)

    // Last-instant adopt: if a synced key replicated in since the caller's
    // probe, use it — minting a competitor forks the identity until the
    // deterministic resolver converges, and leaves an orphan item behind.
    if resolveECKey(alias: alias, synchronizable: true, context: nil) != nil { return }

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

  /// Builds the EC private-key query for `alias`, scoped to a SPECIFIC
  /// synchronizable class (never `kSecAttrSynchronizableAny`). Pinning the
  /// class is what makes resolution deterministic — see `copyECPrivateKey`.
  /// `MatchLimitAll` + attributes so the caller can order MULTIPLE items in
  /// the same class deterministically (see `resolveECKey`).
  private func ecPrivateKeyQuery(
    alias: String, synchronizable: Bool, context: LAContext?
  ) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag(for: alias),
      kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
      kSecMatchLimit as String: kSecMatchLimitAll,
      kSecReturnRef as String: true,
      kSecReturnAttributes as String: true,
      kSecAttrSynchronizable as String: synchronizable,
    ]
    if let context {
      query[kSecUseAuthenticationContext as String] = context
    }
    return query
  }

  /// Deterministically resolve the EC private key for `alias`. The
  /// synchronizable SOFTWARE identity key (`generateSyncableP256Key`) is
  /// preferred over any non-synced / Secure-Enclave entry under the same tag.
  ///
  /// This is the core of the CryptoTokenKit -5 fix: the previous lookups used
  /// `kSecAttrSynchronizableAny` + `kSecMatchLimitOne`, which returns an
  /// UNSPECIFIED item when several share the tag (an iCloud-synced copy, or a
  /// stale Secure-Enclave key under the same alias). That let a token-backed
  /// phantom be signed against a non-authenticated LAContext → SE auth failure
  /// (`authenticationFailed`, CryptoTokenKit -5). A synchronizable item is
  /// ALWAYS software (SE keys cannot sync), so preferring it can never resolve
  /// a token phantom, and it keeps the DID public key and the signing key on
  /// the SAME entry. Falls back to the non-synced class for legacy device-only
  /// SE aliases. Returns nil when neither class matches.
  private func copyECPrivateKey(alias: String, context: LAContext?) -> SecKey? {
    for synchronizable in [true, false] {
      if let winner = resolveECKey(alias: alias, synchronizable: synchronizable, context: context) {
        return winner
      }
    }
    return nil
  }

  /// Resolve WITHIN one synchronizable class. Multiple items can share the
  /// tag inside the synced class — the T7 double-mint: two devices each
  /// minted a syncable key before iCloud Keychain replication converged, and
  /// because `kSecAttrApplicationLabel` (public-key hash) is part of a key
  /// item's primary key, BOTH items sync to every device instead of one
  /// overwriting the other. `MatchLimitOne` then returns an UNSPECIFIED item
  /// per process — flip-flopping DIDs across launches and devices. Order by
  /// ascending application label instead: the label is derived from the key
  /// material itself and syncs verbatim, so every device sorts the same
  /// candidate set identically and converges on the SAME key. (The losing
  /// item is never deleted here — an explicit user-driven resolver in
  /// settings owns that; see `listSyncableP256Keys`.)
  private func resolveECKey(
    alias: String, synchronizable: Bool, context: LAContext?
  ) -> SecKey? {
    let query = ecPrivateKeyQuery(
      alias: alias, synchronizable: synchronizable, context: context)
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let entries = item as? [[String: Any]] else { return nil }
    var best: (label: Data, key: SecKey)?
    for entry in entries {
      guard let refAny = entry[kSecValueRef as String],
        CFGetTypeID(refAny as CFTypeRef) == SecKeyGetTypeID()
      else { continue }
      // The CFGetTypeID equality guard above makes this cast provably safe
      // (cannot crash) — matches the established pattern in this file.
      let key = refAny as! SecKey  // swiftlint:disable:this force_cast
      let label = entry[kSecAttrApplicationLabel as String] as? Data ?? Data()
      if let current = best {
        if label.lexicographicallyPrecedes(current.label) { best = (label, key) }
      } else {
        best = (label, key)
      }
    }
    return best?.key
  }

  func hasKey(alias: String) -> Bool {
    if copyECPrivateKey(alias: alias, context: nil) != nil { return true }
    let genQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: alias,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    return SecItemCopyMatching(genQuery as CFDictionary, nil) == errSecSuccess
  }

  func fetchECPrivateKey(alias: String) throws -> SecKey {
    try fetchECPrivateKey(alias: alias, context: nil)
  }

  /// Context-aware variant: `kSecUseAuthenticationContext` binds the key's
  /// later `SecKeyCreateSignature` evaluation to the supplied LAContext —
  /// a context with `touchIDAuthenticationAllowableReuseDuration` set lets
  /// repeated ACL-gated signs within the window skip re-prompting, and a
  /// context with `interactionNotAllowed = true` turns "would prompt" into
  /// a detectable error (the keyAuthMode probe).
  func fetchECPrivateKey(alias: String, context: LAContext?) throws -> SecKey {
    guard let key = copyECPrivateKey(alias: alias, context: context) else {
      throw SpruceDidError.keyNotFound(alias)
    }
    return key
  }

  /// Resolves the alias to its public-key JWK JSON string. Tries EC first
  /// (the primary path), then ed25519, then throws `keyNotFound`.
  func publicKeyJwk(alias: String) throws -> String {
    // Resolve via the same deterministic path as signing so the DID public
    // key and the signing key are guaranteed to be the SAME entry (never a
    // phantom under the shared tag).
    if let priv = copyECPrivateKey(alias: alias, context: nil) {
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

  // MARK: - Syncable-key conflict surface (T7)

  /// JSON array of every synchronizable P-256 item under `alias`:
  /// `[{"label":"<hex>","publicKeyHex":"<hex 04||X||Y>"}]`. More than one
  /// entry = the T7 double-mint; the JS layer renders an explicit conflict
  /// resolver from this. Values are hex-only, so the hand-built JSON needs
  /// no escaping.
  func listSyncableP256Keys(alias: String) -> String {
    let query = ecPrivateKeyQuery(alias: alias, synchronizable: true, context: nil)
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let entries = item as? [[String: Any]]
    else { return "[]" }
    var rows: [String] = []
    for entry in entries {
      guard let refAny = entry[kSecValueRef as String],
        CFGetTypeID(refAny as CFTypeRef) == SecKeyGetTypeID()
      else { continue }
      let key = refAny as! SecKey  // swiftlint:disable:this force_cast
      guard let label = entry[kSecAttrApplicationLabel as String] as? Data,
        let pub = SecKeyCopyPublicKey(key),
        let pubData = SecKeyCopyExternalRepresentation(pub, nil) as Data?
      else { continue }
      rows.append(
        "{\"label\":\"\(Self.hexString(label))\",\"publicKeyHex\":\"\(Self.hexString(pubData))\"}")
    }
    return "[" + rows.joined(separator: ",") + "]"
  }

  /// Delete ONE synchronizable P-256 item by its application-label hex — the
  /// user-approved loser of a T7 conflict (settings resolver; never called
  /// automatically). Scoped hard: never touches the non-synced class or any
  /// other label. Returns true iff an item was actually deleted.
  func deleteSyncableP256Key(alias: String, labelHex: String) -> Bool {
    guard let label = Self.dataFromHex(labelHex), !label.isEmpty else { return false }
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag(for: alias),
      kSecAttrSynchronizable as String: true,
      kSecAttrApplicationLabel as String: label,
    ]
    return SecItemDelete(query as CFDictionary) == errSecSuccess
  }

  private static func hexString(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
  }

  private static func dataFromHex(_ hex: String) -> Data? {
    let chars = Array(hex.lowercased())
    guard chars.count % 2 == 0 else { return nil }
    var bytes = Data(capacity: chars.count / 2)
    var index = 0
    while index < chars.count {
      guard let byte = UInt8(String(chars[index...index + 1]), radix: 16) else { return nil }
      bytes.append(byte)
      index += 2
    }
    return bytes
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
