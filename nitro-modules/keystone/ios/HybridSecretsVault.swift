//
//  HybridSecretsVault.swift
//  @solidarity/nitro-secrets-vault (iOS)
//
//  Hardware-backed wrap / unwrap of arbitrary byte payloads. Mirrors the
//  Secure Enclave key-agreement pattern used by
//  `solidarity/Services/Identity/KeychainService+Generation.swift`:
//
//    - `ensureWrappingKey` provisions (or reuses) a
//      `SecureEnclave.P256.KeyAgreement.PrivateKey` under a keychain alias.
//      Optionally requires biometry via a `SecAccessControl` with
//      `.privateKeyUsage` + `.userPresence`.
//    - `wrap` performs HPKE-flavoured ECIES:
//        1. Generate ephemeral P-256 keypair.
//        2. ECDH(ephemeral.priv, SE.pub) → 32-byte shared secret.
//        3. HKDF-SHA256 over shared secret with salt = ephemeral.pub
//           (X9.63 65-byte form) and info = "solidarity.vault.wrap.v1" →
//           32-byte AES-256 key.
//        4. AES-GCM seal with random 12-byte nonce.
//        5. Output blob = ephemeralPub(65) || nonce(12) || ct || tag(16).
//    - `unwrap` parses the blob back, re-derives the AES key via
//      ECDH(SE.priv, ephemeral.pub), and AES-GCM-opens.
//
//  Security notes (CLAUDE.md Sec rules):
//    - No force-unwrap / fatalError on optional library outputs.
//    - On error we throw a typed NSError that surfaces as Promise rejection
//      on the JS side. Never log plaintext / wrapped bytes.
//    - Simulator path: SE is unavailable, so we fall back to a software
//      P-256 key but still report `hardwareBacked = false` in every
//      response so JS can warn the user.
//

import CryptoKit
import Foundation
import LocalAuthentication
import NitroModules
import Security

final class HybridSecretsVault: HybridSecretsVaultSpec {

  // MARK: - Constants

  /// Domain-separation label so a future caller wrapping non-vault payloads
  /// can't collide with the AES-256 key we derive here. Mirrors the HKDF
  /// info-string pattern used by `ContentKeyExchangeService.swift`.
  private static let hkdfInfo: Data = Data("solidarity.vault.wrap.v1".utf8)

  /// Algorithm discriminator returned in every `WrappedSecret`. The TS layer
  /// pins on this so a future migration to a different scheme can branch.
  private static let algoLabel = "aes-gcm-secure-enclave-ecies"

  /// Keychain item shape — generic-password rows keyed by `(service, account)`.
  private static let keychainService = "gg.solidarity.secretsvault"

  // MARK: - Availability

  func isHardwareAvailable() throws -> Bool {
    return SecureEnclave.isAvailable
  }

  // MARK: - ensureWrappingKey

  func ensureWrappingKey(
    keyAlias: String, requireBiometric: Bool
  ) throws -> Promise<EnsureWrappingKeyResult> {
    return Promise.async {
      if try self.loadStoredKey(alias: keyAlias) != nil {
        return EnsureWrappingKeyResult(hardwareBacked: SecureEnclave.isAvailable)
      }
      let hardware = try self.generateAndStoreKey(
        alias: keyAlias, requireBiometric: requireBiometric)
      return EnsureWrappingKeyResult(hardwareBacked: hardware)
    }
  }

  // MARK: - wrap

  func wrap(keyAlias: String, plaintext: ArrayBuffer) throws -> Promise<WrappedSecret> {
    // Copy the NON-OWNING JS ArrayBuffer synchronously, before Promise.async —
    // touching plaintext.data/.size on the async executor (another thread,
    // later) traps the process (SIGTRAP) and is uncatchable by JS try/catch.
    let plaintextData = copyPayload(plaintext)
    return Promise.async {
      guard let key = try self.loadStoredKey(alias: keyAlias) else {
        throw self.makeError(code: 404, "wrapping key not found for alias=\(keyAlias)")
      }
      guard !plaintextData.isEmpty else {
        throw self.makeError(code: 400, "plaintext is empty")
      }
      let (blob, hardwareBacked) = try self.eciesSeal(plaintext: plaintextData, key: key)
      return WrappedSecret(
        algorithm: Self.algoLabel,
        keyAlias: keyAlias,
        wrapped: self.toArrayBuffer(blob),
        hardwareBacked: hardwareBacked
      )
    }
  }

  // MARK: - unwrap

  func unwrap(wrapped: WrappedSecret) throws -> Promise<ArrayBuffer> {
    return Promise.async {
      guard let key = try self.loadStoredKey(alias: wrapped.keyAlias) else {
        throw self.makeError(code: 404, "wrapping key not found for alias=\(wrapped.keyAlias)")
      }
      let blob = self.copyPayload(wrapped.wrapped)
      let plaintext = try self.eciesOpen(blob: blob, key: key)
      return self.toArrayBuffer(plaintext)
    }
  }

  // MARK: - deleteKey

  func deleteKey(keyAlias: String) throws -> Promise<Void> {
    return Promise.async {
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: Self.keychainService,
        kSecAttrAccount as String: keyAlias,
      ]
      let status = SecItemDelete(query as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else {
        throw self.makeError(code: Int(status), "keychain delete failed status=\(status)")
      }
    }
  }

  // MARK: - readRawKeychainGenericPassword

  func readRawKeychainGenericPassword(service: String, account: String) throws -> Promise<ArrayBuffer> {
    return Promise.async {
      guard !service.isEmpty, !account.isEmpty else {
        return ArrayBuffer.allocate(size: 0)
      }
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
        kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
        kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne,
      ]
      var item: AnyObject?
      let status = SecItemCopyMatching(query as CFDictionary, &item)
      if status == errSecItemNotFound {
        return ArrayBuffer.allocate(size: 0)
      }
      guard status == errSecSuccess, let data = item as? Data else {
        if status == errSecSuccess {
          return ArrayBuffer.allocate(size: 0)
        }
        throw self.makeError(code: Int(status), "legacy keychain read failed status=\(status)")
      }
      return self.toArrayBuffer(data)
    }
  }

  // MARK: - Synchronizable item (iCloud Keychain) — root-key seed backup
  //
  // A SEPARATE keychain namespace from the wrapping-key rows above
  // (`keychainService`): these items are plain generic passwords with
  // `kSecAttrSynchronizable = true`, so they must never collide with (or be
  // swept by a delete query targeting) the non-synced wrapping-key rows.
  // Ported from the working precedent in
  // `nitro-modules/spruce-did/ios/SpruceDidKeyStore.swift:112`
  // (`generateSyncableP256Key`) — same accessibility choice (`WhenUnlocked`,
  // NOT `…ThisDeviceOnly`, which would opt the item out of sync) and same
  // "no biometry ACL" rule (synchronizable items can't carry a
  // device-specific SecAccessControl; any Face ID gate belongs one layer up
  // at the JS call site — see `apps/expo/src/identity/rootKey.ts`).

  private static let syncableItemService = "gg.solidarity.secretsvault.sync"

  func setSynchronizableItem(alias: String, value: String) throws -> Promise<Void> {
    return Promise.async {
      guard !alias.isEmpty else {
        throw self.makeError(code: 400, "alias is empty")
      }
      let data = Data(value.utf8)

      // Idempotent: overwrite any stale entry under the same alias. Delete
      // across BOTH synchronizable states first so a prior non-synced
      // leftover under the same (service, account) can never collide with
      // the add below.
      let deleteQuery: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: Self.syncableItemService,
        kSecAttrAccount as String: alias,
        kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
      ]
      SecItemDelete(deleteQuery as CFDictionary)

      let addQuery: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: Self.syncableItemService,
        kSecAttrAccount as String: alias,
        kSecValueData as String: data,
        kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked,
        kSecAttrSynchronizable as String: true,
      ]
      let status = SecItemAdd(addQuery as CFDictionary, nil)
      guard status == errSecSuccess else {
        throw self.makeError(
          code: Int(status), "synchronizable keychain add failed status=\(status)")
      }
    }
  }

  func getSynchronizableItem(alias: String) throws -> Promise<String> {
    return Promise.async {
      guard !alias.isEmpty else { return "" }
      // Pin `kSecAttrSynchronizable = true` (NOT `…SynchronizableAny`): the
      // item is only ever written with `synchronizable = true` (see
      // `setSynchronizableItem`), so a `SynchronizableAny` + `kSecMatchLimitOne`
      // read could non-deterministically resolve a STALE non-synced leftover
      // under the same (service, account) instead of the real synced value —
      // the exact ambiguous-lookup class the Spruce keystore fix eliminated
      // (see `nitro-modules/spruce-did/ios/SpruceDidKeyStore.swift`,
      // `copyECPrivateKey`). The recovered value is persisted as the active
      // Root Identity, so a wrong pick would silently switch identities.
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: Self.syncableItemService,
        kSecAttrAccount as String: alias,
        kSecAttrSynchronizable as String: true,
        kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne,
      ]
      var item: AnyObject?
      let status = SecItemCopyMatching(query as CFDictionary, &item)
      if status == errSecItemNotFound { return "" }
      guard status == errSecSuccess, let data = item as? Data,
        let value = String(data: data, encoding: .utf8)
      else {
        if status == errSecSuccess { return "" }
        throw self.makeError(
          code: Int(status), "synchronizable keychain read failed status=\(status)")
      }
      return value
    }
  }

  func deleteSynchronizableItem(alias: String) throws -> Promise<Void> {
    return Promise.async {
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: Self.syncableItemService,
        kSecAttrAccount as String: alias,
        kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
      ]
      let status = SecItemDelete(query as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else {
        throw self.makeError(
          code: Int(status), "synchronizable keychain delete failed status=\(status)")
      }
    }
  }

  // MARK: - Key store (Secure Enclave preferred, software fallback on sim)

  /// Stored shape: opaque `dataRepresentation` of the SE / software P-256
  /// key. We persist via a generic-password row keyed by `(service, alias)`.
  /// On simulator we store the software key's raw representation under the
  /// same row; the discriminant lives in the leading byte of the blob.
  private func loadStoredKey(alias: String) throws -> P256KeyAgreementKey? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: Self.keychainService,
      kSecAttrAccount as String: alias,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let blob = item as? Data, blob.count > 1 else {
      if status == errSecSuccess { return nil }
      throw makeError(code: Int(status), "keychain read failed status=\(status)")
    }
    let discriminator = blob[0]
    let body = blob.dropFirst()
    switch discriminator {
    case 0x01:
      if SecureEnclave.isAvailable {
        let seKey = try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: body)
        return .secureEnclave(seKey)
      }
      throw makeError(code: 500, "stored SE key but Secure Enclave unavailable")
    case 0x02:
      let swKey = try P256.KeyAgreement.PrivateKey(rawRepresentation: body)
      return .software(swKey)
    default:
      throw makeError(code: 500, "unknown key discriminator \(discriminator)")
    }
  }

  private func generateAndStoreKey(alias: String, requireBiometric: Bool) throws -> Bool {
    var blob: Data
    let hardware: Bool

    if SecureEnclave.isAvailable {
      let access = try makeAccessControl(requireBiometric: requireBiometric)
      let seKey = try SecureEnclave.P256.KeyAgreement.PrivateKey(
        accessControl: access, authenticationContext: nil)
      blob = Data([0x01])
      blob.append(seKey.dataRepresentation)
      hardware = true
    } else {
      let swKey = P256.KeyAgreement.PrivateKey()
      blob = Data([0x02])
      blob.append(swKey.rawRepresentation)
      hardware = false
    }

    // Idempotent: blow away any stale entry under the same alias first so
    // `ensureWrappingKey` after a `deleteKey` round-trip always succeeds.
    let deleteQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: Self.keychainService,
      kSecAttrAccount as String: alias,
    ]
    SecItemDelete(deleteQuery as CFDictionary)

    let addQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: Self.keychainService,
      kSecAttrAccount as String: alias,
      kSecValueData as String: blob,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
    ]
    let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
    guard addStatus == errSecSuccess else {
      throw makeError(code: Int(addStatus), "keychain add failed status=\(addStatus)")
    }
    return hardware
  }

  private func makeAccessControl(requireBiometric: Bool) throws -> SecAccessControl {
    let flags: SecAccessControlCreateFlags = requireBiometric
      ? [.privateKeyUsage, .userPresence] : [.privateKeyUsage]
    var error: Unmanaged<CFError>?
    guard
      let access = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        flags, &error)
    else {
      let cfError = error?.takeRetainedValue()
      let message = (cfError as Error?)?.localizedDescription ?? "unknown"
      throw makeError(code: -1, "SecAccessControlCreateWithFlags failed: \(message)")
    }
    return access
  }

  // MARK: - ECIES

  private func eciesSeal(plaintext: Data, key: P256KeyAgreementKey) throws -> (Data, Bool) {
    let ephemeral = P256.KeyAgreement.PrivateKey()
    let ephemeralPubData = ephemeral.publicKey.x963Representation  // 65 bytes
    let shared: SharedSecret
    switch key {
    case .secureEnclave(let seKey):
      shared = try ephemeral.sharedSecretFromKeyAgreement(with: seKey.publicKey)
    case .software(let swKey):
      shared = try ephemeral.sharedSecretFromKeyAgreement(with: swKey.publicKey)
    }
    let aesKey = shared.hkdfDerivedSymmetricKey(
      using: SHA256.self,
      salt: ephemeralPubData,
      sharedInfo: Self.hkdfInfo,
      outputByteCount: 32
    )
    let nonce = AES.GCM.Nonce()
    let sealed = try AES.GCM.seal(plaintext, using: aesKey, nonce: nonce)
    guard let combined = sealed.combined else {
      throw makeError(code: 500, "AES-GCM seal returned nil combined")
    }
    // combined = nonce(12) || ct || tag(16); prepend ephemeral pub.
    var blob = Data(capacity: ephemeralPubData.count + combined.count)
    blob.append(ephemeralPubData)
    blob.append(combined)
    return (blob, key.isHardwareBacked)
  }

  private func eciesOpen(blob: Data, key: P256KeyAgreementKey) throws -> Data {
    // X9.63 uncompressed point: 1 (0x04) + 32 (x) + 32 (y) = 65 bytes.
    let ephemeralPubLen = 65
    guard blob.count > ephemeralPubLen + 12 + 16 else {
      throw makeError(code: 400, "wrapped blob too short: \(blob.count) bytes")
    }
    let ephemeralPubData = blob.prefix(ephemeralPubLen)
    let combined = blob.suffix(from: blob.startIndex + ephemeralPubLen)
    let ephemeralPub = try P256.KeyAgreement.PublicKey(x963Representation: ephemeralPubData)
    let shared: SharedSecret
    switch key {
    case .secureEnclave(let seKey):
      shared = try seKey.sharedSecretFromKeyAgreement(with: ephemeralPub)
    case .software(let swKey):
      shared = try swKey.sharedSecretFromKeyAgreement(with: ephemeralPub)
    }
    let aesKey = shared.hkdfDerivedSymmetricKey(
      using: SHA256.self,
      salt: ephemeralPubData,
      sharedInfo: Self.hkdfInfo,
      outputByteCount: 32
    )
    let sealedBox = try AES.GCM.SealedBox(combined: combined)
    return try AES.GCM.open(sealedBox, using: aesKey)
  }

  // MARK: - Helpers

  private func copyPayload(_ buffer: ArrayBuffer) -> Data {
    let count = buffer.size
    guard count > 0 else { return Data() }
    return Data(bytes: buffer.data, count: count)
  }

  private func toArrayBuffer(_ data: Data) -> ArrayBuffer {
    return (try? ArrayBuffer.copy(data: data)) ?? ArrayBuffer.allocate(size: 0)
  }

  private func makeError(code: Int, _ message: String) -> NSError {
    return NSError(
      domain: "gg.solidarity.secretsvault",
      code: code,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }
}

// MARK: - Key wrapper

/// Discriminated union so wrap/unwrap can branch on the storage path. The
/// Secure Enclave key uses opaque token operations; the software key on
/// the simulator goes through the standard CryptoKit P256 API.
private enum P256KeyAgreementKey {
  case secureEnclave(SecureEnclave.P256.KeyAgreement.PrivateKey)
  case software(P256.KeyAgreement.PrivateKey)

  var isHardwareBacked: Bool {
    switch self {
    case .secureEnclave: return true
    case .software: return false
    }
  }
}
