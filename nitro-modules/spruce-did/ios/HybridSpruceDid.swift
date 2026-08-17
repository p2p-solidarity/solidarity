//
//  HybridSpruceDid.swift
//  @solidarity/nitro-spruce-did (iOS)
//
//  Native iOS DID key management backed by Secure Enclave + Apple Keychain.
//  Mirrors the legacy `solidarity/Services/Identity/KeychainService.swift`
//  pipeline but reshapes it into a Nitro HybridObject the Expo client can
//  call from JS.
//
//  Key generation:
//    p256       → SecureEnclave.P256.Signing.PrivateKey on hardware that
//                 supports it; falls back to P256.Signing.PrivateKey on the
//                 simulator (and `requireBiometric=false` warning emitted).
//    ed25519    → CryptoKit Curve25519 stored in Keychain raw bytes (Secure
//                 Enclave does not support ed25519 natively as of iOS 17).
//    secp256k1  → not natively supported on iOS — throws unless the consumer
//                 brings their own implementation. Marked unsupported so the
//                 caller knows to choose a different DID method.
//
//  DID derivation + JWS/VC verification are pure TS in packages/shared
//  (didKeyFromJwk / resolveDidKey / verifyJwtEs256) — this module is only
//  the hardware signing shell. The SpruceID Mobile SDK dependency and its 5
//  wrapper methods were removed in 1.3.3 S7a (they had zero production
//  callers — inventory: docs/ref/notes-sprucekit-slim.md).
//
//  All Apple @objc / NSObject delegate protocols are routed through proxies
//  (LAContextProxy pattern) so the NitroSpec subclass doesn't need to
//  multi-inherit. See `HybridProximity.swift` for the canonical example.
//

import CryptoKit
import Foundation
import LocalAuthentication
import NitroModules
import Security

// MARK: - HybridSpruceDid
//
// Crypto + encoding helpers (`SpruceDidError`, `Base64Url`, `JwkUtils`,
// `EcdsaCodec`, `JwsFraming`) live in the sibling `SpruceDidCryptoHelpers.swift`
// to keep this file under the 500-line CLAUDE.md ceiling.

final class HybridSpruceDid: HybridSpruceDidSpec {

  // MARK: Stored state

  /// Event listener fan-out, indexed by UUID for O(1) unsubscribe.
  private var listeners: [UUID: (SpruceDidEvent) -> Void] = [:]

  private let stateQueue = DispatchQueue(label: "gg.solidarity.sprucedid.state")

  /// Keychain wrapper — holds the `kSecAttrService` / tag prefix conventions
  /// and exposes a small synchronous CRUD API for the SE / ed25519 paths.
  /// All Keychain syntax lives in `SpruceDidKeyStore.swift`.
  private let store = SpruceDidKeyStore(
    keychainService: "gg.solidarity.sprucedid",
    keyTagPrefix: "gg.solidarity.sprucedid."
  )

  /// Probe results per alias — stable for the process lifetime (a key's
  /// ACL cannot change without regenerating the key).
  private var keyAuthModeCache: [String: String] = [:]

  /// Shared signing context: one Face ID evaluation is reused for later
  /// native-ACL signs within the window, mirroring the JS grace bucket
  /// (biometric.ts GRACE_MS). Attached via kSecUseAuthenticationContext in
  /// the sign-path key fetches.
  private let signContext: LAContext = {
    let ctx = LAContext()
    ctx.touchIDAuthenticationAllowableReuseDuration = min(
      300, LATouchIDAuthenticationMaximumAllowableReuseDuration)
    return ctx
  }()

  // MARK: Helpers

  @inline(__always)
  private func withState<T>(_ body: () -> T) -> T { stateQueue.sync(execute: body) }

  fileprivate func emit(_ event: SpruceDidEvent) {
    let snapshot = withState { Array(self.listeners.values) }
    for handler in snapshot { handler(event) }
  }

  private func makeEvent(
    _ kind: SpruceDidEventKind,
    alias: String? = nil,
    keyType: String? = nil,
    hardwareBacked: Bool? = nil,
    message: String? = nil,
    errorCode: String? = nil
  ) -> SpruceDidEvent {
    SpruceDidEvent(
      kind: kind, alias: alias, keyType: keyType,
      hardwareBacked: hardwareBacked, message: message, errorCode: errorCode
    )
  }

  // MARK: - Sign-gate mode

  func keyAuthMode(alias: String) throws -> Promise<String> {
    return Promise.async { self.cachedKeyAuthMode(alias) }
  }

  /// Synchronous, process-cached auth-mode resolution (shared by `keyAuthMode`
  /// and the sign path). A key's ACL cannot change without regenerating it, so
  /// the first probe result is stable for the process lifetime.
  private func cachedKeyAuthMode(_ alias: String) -> String {
    if let cached = withState({ self.keyAuthModeCache[alias] }) { return cached }
    let mode = probeKeyAuthMode(alias: alias)
    withState { self.keyAuthModeCache[alias] = mode }
    return mode
  }

  /// LAContext to attach to a sign for `alias`, or nil. Only a native-ACL key
  /// (legacy Secure-Enclave `.userPresence`) gets `signContext`, so repeated
  /// ACL-gated signs reuse one Face ID evaluation. A js-gated SOFTWARE key gets
  /// NO context: it is gated in JS, and attaching `kSecUseAuthenticationContext`
  /// to it would drive Secure-Enclave auth — which, if a stale phantom key were
  /// ever resolved, fails with CryptoTokenKit -5. Pairs with the deterministic
  /// resolution in `SpruceDidKeyStore.copyECPrivateKey`.
  private func signingContext(for alias: String) -> LAContext? {
    cachedKeyAuthMode(alias) == "native-acl" ? signContext : nil
  }

  /// Probe: attempt a signature over 32 random bytes under an
  /// `interactionNotAllowed` context. A key whose ACL demands user
  /// presence fails with an interaction-required error → 'native-acl'.
  /// A silent success (probe signature discarded; the digest is random,
  /// so it attests nothing) or any other failure → 'js-gated' —
  /// fail-safe: the worst case is the legacy double prompt, never a
  /// missing gate.
  private func probeKeyAuthMode(alias: String) -> String {
    let probeContext = LAContext()
    probeContext.interactionNotAllowed = true
    guard
      let priv = try? store.fetchECPrivateKey(alias: alias, context: probeContext)
    else {
      return "js-gated"
    }
    var digestBytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, 32, &digestBytes) == errSecSuccess else {
      return "js-gated"
    }
    var error: Unmanaged<CFError>?
    let signature = SecKeyCreateSignature(
      priv, .ecdsaSignatureDigestX962SHA256,
      Data(digestBytes) as CFData, &error
    )
    if signature != nil { return "js-gated" }
    guard let cfError = error?.takeRetainedValue() else { return "js-gated" }
    let nsError = cfError as Error as NSError
    let interactionNotAllowedCodes = [
      Int(errSecInteractionNotAllowed),
      LAError.notInteractive.rawValue,
    ]
    if interactionNotAllowedCodes.contains(nsError.code)
      || nsError.localizedDescription.lowercased().contains("interaction")
    {
      return "native-acl"
    }
    return "js-gated"
  }

  // MARK: - Key generation

  func generateKey(
    alias: String, keyType: String, requireBiometric: Bool
  ) throws -> Promise<String> {
    return Promise.async {
      let normalized = keyType.lowercased()
      let hardware: Bool
      switch normalized {
      case "p256":
        hardware = try self.store.generateP256Key(
          alias: alias, requireBiometric: requireBiometric)
      case "p256-syncable", "p256_sync":
        // Portable identity key — software P-256 stored as a synchronizable
        // keychain item so iCloud Keychain replicates the DID across devices.
        // Not hardware-backed (Secure Enclave keys cannot sync). Biometric
        // gating is enforced in JS, not via a keychain ACL. See
        // SpruceDidKeyStore.generateSyncableP256Key.
        try self.store.generateSyncableP256Key(alias: alias)
        hardware = false
      case "ed25519":
        try self.store.generateEd25519Key(
          alias: alias, requireBiometric: requireBiometric)
        hardware = false
      case "secp256k1":
        // iOS Secure Enclave doesn't expose secp256k1. The Spruce SDK does
        // provide secp256k1 helpers but only as software keys; we don't
        // ship a software fallback because the whole point of this module
        // is hardware-backed entropy. Caller should choose p256 instead.
        throw SpruceDidError.unsupportedKeyType(
          "secp256k1 not supported on iOS — use 'p256' (Secure Enclave) instead")
      default:
        throw SpruceDidError.unsupportedKeyType(normalized)
      }
      self.emit(
        self.makeEvent(
          .keygenerated, alias: alias, keyType: normalized,
          hardwareBacked: hardware))
      return alias
    }
  }

  // MARK: - hasKey / deleteKey

  func hasKey(alias: String) throws -> Bool { store.hasKey(alias: alias) }

  func deleteKey(alias: String) throws -> Promise<Bool> {
    return Promise.async {
      let ok = try self.store.deleteKey(alias: alias)
      if ok { self.emit(self.makeEvent(.keydeleted, alias: alias)) }
      return ok
    }
  }

  // MARK: - Syncable-key conflict surface (T7)

  func listSyncableP256Keys(alias: String) throws -> Promise<String> {
    return Promise.async { self.store.listSyncableP256Keys(alias: alias) }
  }

  func deleteSyncableP256Key(alias: String, labelHex: String) throws -> Promise<Bool> {
    return Promise.async {
      let ok = self.store.deleteSyncableP256Key(alias: alias, labelHex: labelHex)
      if ok { self.emit(self.makeEvent(.keydeleted, alias: alias)) }
      return ok
    }
  }

  // MARK: - Public key JWK

  func getPublicKeyJwk(alias: String) throws -> Promise<String> {
    return Promise.async { try self.store.publicKeyJwk(alias: alias) }
  }

  // MARK: - Sign JWS

  func signJws(alias: String, payload: ArrayBuffer) throws -> Promise<String> {
    // A Nitro `ArrayBuffer` handed in from JS is NON-OWNING: its backing store
    // is only valid for the SYNCHRONOUS duration of this call. Copy it to an
    // owning `Data` HERE, on the caller thread, BEFORE deferring to
    // `Promise.async`. Touching `payload.size` / `payload.data` inside the async
    // closure (a different thread, later) makes Nitro raise an Objective-C
    // exception that traps the whole process (EXC_BREAKPOINT / SIGTRAP) — and a
    // native trap is uncatchable by any JS try/catch, so it reads as a silent
    // 閃退. Latent bug, unmasked once the SpruceID-unavailable error stopped
    // short-circuiting the share / VC-issuance flows before signing.
    let bytes = copyPayload(payload)
    return Promise.async {

      // Currently only P-256 (ES256) signing is wired — matches the
      // legacy app's Swift signer which only ever produced ES256 JWS.
      // Ed25519 (EdDSA) signing is gated until the Spruce SDK side is
      // confirmed to accept arbitrary CryptoKit-signed payloads.
      let priv = try self.store.fetchECPrivateKey(
        alias: alias, context: self.signingContext(for: alias))
      var error: Unmanaged<CFError>?
      // The legacy code uses `.ecdsaSignatureMessageX962SHA256` — it
      // emits a DER-encoded signature which we then have to convert to raw
      // r||s for JWS compact serialisation.
      let signingInput = JwsFraming.makeSigningInput(payload: bytes)
      guard
        let derSig = SecKeyCreateSignature(
          priv, .ecdsaSignatureMessageX962SHA256,
          signingInput as CFData, &error
        ) as Data?
      else {
        let cfError = error?.takeRetainedValue()
        let msg = (cfError as Error?)?.localizedDescription ?? "unknown"
        if msg.contains("cancel") || msg.contains("Cancel") {
          self.emit(
            self.makeEvent(
              .biometricpromptcancelled, alias: alias, message: msg))
          throw SpruceDidError.biometricCancelled
        }
        throw SpruceDidError.signFailed(msg)
      }
      let raw = try EcdsaCodec.derToRaw(derSig)
      return JwsFraming.compactSerialisation(payload: bytes, rawSignature: raw)
    }
  }

  func signRawP256(alias: String, digest: ArrayBuffer) throws -> Promise<ArrayBuffer> {
    let bytes = copyPayload(digest)
    guard bytes.count == 32 else {
      throw SpruceDidError.invalidInput(
        "signRawP256 expects a 32-byte SHA-256 digest, got \(bytes.count)")
    }
    return Promise.async {
      let priv = try self.store.fetchECPrivateKey(
        alias: alias, context: self.signingContext(for: alias))
      let algorithm = SecKeyAlgorithm.ecdsaSignatureDigestX962SHA256
      guard SecKeyIsAlgorithmSupported(priv, .sign, algorithm) else {
        throw SpruceDidError.signFailed("P-256 digest signing is not supported for alias=\(alias)")
      }

      var error: Unmanaged<CFError>?
      guard
        let derSig = SecKeyCreateSignature(
          priv, algorithm, bytes as CFData, &error
        ) as Data?
      else {
        let cfError = error?.takeRetainedValue()
        let msg = (cfError as Error?)?.localizedDescription ?? "unknown"
        if msg.contains("cancel") || msg.contains("Cancel") {
          self.emit(
            self.makeEvent(
              .biometricpromptcancelled, alias: alias, message: msg))
          throw SpruceDidError.biometricCancelled
        }
        throw SpruceDidError.signFailed(msg)
      }
      let raw = try EcdsaCodec.derToRaw(derSig)
      return try ArrayBuffer.copy(data: raw)
    }
  }

  // MARK: - Listener registration

  func addEventListener(handler: @escaping (SpruceDidEvent) -> Void) -> () -> Void {
    let id = UUID()
    withState { self.listeners[id] = handler }
    return { [weak self] in
      self?.withState { self?.listeners.removeValue(forKey: id) }
    }
  }

  // MARK: - Misc helpers

  private func copyPayload(_ buffer: ArrayBuffer) -> Data {
    let count = buffer.size
    guard count > 0 else { return Data() }
    return Data(bytes: buffer.data, count: count)
  }
}
