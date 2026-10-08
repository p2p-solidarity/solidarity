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

  /// Process-wide native-ACL sign session (Fix D). STATIC on purpose: Face ID
  /// / coreauthd contention is process-wide, and `createHybridObject('SpruceDid')`
  /// mints a new HybridSpruceDid per call (KeystoneAutolinking) — a second
  /// instance (Fast Refresh, a second create call) must share ONE queue and
  /// ONE context, never race its own sheet against ours.
  private enum SignSession {
    /// Every native sign runs on this SERIAL queue (`Promise.parallel`), so two
    /// overlapping signs can never race one Face ID sheet on the same
    /// LAContext — the loser is system-cancelled, and a cancelled context is
    /// dead for the rest of the process. Deliberately off the Swift-concurrency
    /// cooperative pool: `SecKeyCreateSignature` blocks its thread for as long
    /// as the user takes to authenticate.
    static let queue = DispatchQueue(
      label: "gg.solidarity.sprucedid.sign", qos: .userInitiated)

    /// Guards `context` / `armedAt`. Never held across `LAContext.invalidate()`
    /// (an IPC to coreauthd) so event fan-out and keyAuthMode never wait on it.
    static let lock = NSLock()

    /// LAContext attached (kSecUseAuthenticationContext) to native-ACL
    /// sign-path key fetches, so repeated legacy Secure-Enclave `.userPresence`
    /// signs reuse ONE Face ID evaluation inside `reuseWindow` — the native
    /// twin of the JS grace bucket (biometric.ts GRACE_MS). `nil` until the
    /// first native-ACL sign. It is REPLACED, never reused, once a sign on it
    /// cancelled or was rejected, or once the window since its first
    /// successful sign has elapsed. The pre-Fix-D process-lifetime context is
    /// what turned into the prompt-less CryptoTokenKit -5 loop
    /// (`SpruceDidSignFailureKind`).
    static var context: LAContext?
    /// Instant of the first successful sign through `context`; nil = unarmed.
    static var armedAt: Date?
    static let reuseWindow: TimeInterval = 300
  }

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

  // MARK: - Native-ACL sign session (Fix D)

  private static func makeSignContext() -> LAContext {
    let ctx = LAContext()
    // Deliberately NO `touchIDAuthenticationAllowableReuseDuration`: that
    // property lets a recent DEVICE UNLOCK satisfy the ACL with no prompt.
    // For a native-ACL key this context is the ONLY gate (JS steps aside —
    // signingKey.ts resolveKeyAuthMode), so it must not be weaker than the JS
    // bucket, which arms only from a real in-app prompt. Reuse is anchored
    // solely to `SignSession.armedAt`.
    // Keychain-driven prompts read these (evaluatePolicy's reason parameter
    // is never involved on this path); mirrors biometric.ts PROMPT_BY_REASON.
    ctx.localizedReason = "Authorize signing with your identity key"
    ctx.localizedFallbackTitle = "Use device passcode"
    return ctx
  }

  /// Context for the next native-ACL sign: the current one while it is inside
  /// the reuse window after its first successful sign, otherwise a fresh
  /// replacement — an unarmed or expired context needs user interaction
  /// anyway, and a fresh one cannot be stale.
  private func acquireSignContext() -> LAContext {
    SignSession.lock.lock()
    if let ctx = SignSession.context, let armedAt = SignSession.armedAt,
      Date().timeIntervalSince(armedAt) < SignSession.reuseWindow
    {
      SignSession.lock.unlock()
      return ctx
    }
    let outgoing = SignSession.context
    let fresh = Self.makeSignContext()
    SignSession.context = fresh
    SignSession.armedAt = nil
    SignSession.lock.unlock()
    outgoing?.invalidate()
    return fresh
  }

  /// First success on `ctx` opens its reuse window. Later successes do NOT
  /// extend it (same as the JS bucket: 5 minutes from the prompt, not
  /// sliding), so a native-ACL key re-prompts on the same cadence.
  private func armSignContext(_ ctx: LAContext) {
    SignSession.lock.lock()
    defer { SignSession.lock.unlock() }
    if SignSession.context === ctx, SignSession.armedAt == nil {
      SignSession.armedAt = Date()
    }
  }

  /// Drop `ctx` so the next sign starts from a fresh context. Idempotent.
  private func retireSignContext(_ ctx: LAContext) {
    SignSession.lock.lock()
    let owned = SignSession.context === ctx
    if owned {
      SignSession.context = nil
      SignSession.armedAt = nil
    }
    SignSession.lock.unlock()
    if owned { ctx.invalidate() }
  }

  /// A `SecKeyCreateSignature` failure, carrying the raw CFError so the
  /// recovery policy can classify it by domain/code (not by message text).
  private struct SignAttemptFailure: Error {
    let error: CFError?
  }

  /// One attempt: resolve the key (`context` attached to the fetch — nil for
  /// js-gated software keys, see `signSerially`) and sign `input`.
  private func performSign(
    alias: String, algorithm: SecKeyAlgorithm, input: Data, context: LAContext?
  ) throws -> Data {
    let priv = try store.fetchECPrivateKey(alias: alias, context: context)
    guard SecKeyIsAlgorithmSupported(priv, .sign, algorithm) else {
      throw SpruceDidError.signFailed(
        "P-256 signing algorithm is not supported for alias=\(alias)")
    }
    var error: Unmanaged<CFError>?
    guard
      let signature = SecKeyCreateSignature(priv, algorithm, input as CFData, &error)
        as Data?
    else {
      throw SignAttemptFailure(error: error?.takeRetainedValue())
    }
    return signature
  }

  /// The recovery policy. Runs on `SignSession.queue`.
  ///
  /// A js-gated SOFTWARE key gets NO context and NO retry: it is gated in JS,
  /// and an auth rejection there would mean a phantom Secure-Enclave key was
  /// resolved under the tag — re-prompting would then sign with the WRONG key
  /// (the DID public key comes from the software entry), so that must surface,
  /// never self-heal. Pairs with `SpruceDidKeyStore.copyECPrivateKey`.
  ///
  /// A native-ACL key (legacy Secure-Enclave `.userPresence`) signs against
  /// the session context; on an auth rejection that is not a cancel, the
  /// context is retired and the sign retried ONCE with a fresh one.
  private func signSerially(
    alias: String, algorithm: SecKeyAlgorithm, input: Data
  ) throws -> Data {
    guard cachedKeyAuthMode(alias) == "native-acl" else {
      do {
        return try performSign(
          alias: alias, algorithm: algorithm, input: input, context: nil)
      } catch let failure as SignAttemptFailure {
        throw signError(alias: alias, failure, attempt: "software-key sign")
      }
    }

    let first = acquireSignContext()
    do {
      let signature = try performSign(
        alias: alias, algorithm: algorithm, input: input, context: first)
      armSignContext(first)
      return signature
    } catch let failure as SignAttemptFailure {
      retireSignContext(first)
      guard SpruceDidSignFailure.classify(failure.error) == .authRejected else {
        throw signError(alias: alias, failure, attempt: "native-acl sign")
      }
      let fresh = acquireSignContext()
      do {
        let signature = try performSign(
          alias: alias, algorithm: algorithm, input: input, context: fresh)
        armSignContext(fresh)
        return signature
      } catch let retryFailure as SignAttemptFailure {
        retireSignContext(fresh)
        throw signError(
          alias: alias, retryFailure,
          attempt: "native-acl sign retried with a fresh auth context")
      }
    }
  }

  /// Map a failed attempt onto the public error surface: a cancel becomes
  /// `biometricCancelled` (+ event), everything else `signFailed` with the
  /// attempt label and the `domain:code` chain (no key material, no PII).
  private func signError(
    alias: String, _ failure: SignAttemptFailure, attempt: String
  ) -> Error {
    let msg = SpruceDidSignFailure.message(failure.error)
    if SpruceDidSignFailure.classify(failure.error) == .cancelled {
      emit(makeEvent(.biometricpromptcancelled, alias: alias, message: msg))
      return SpruceDidError.biometricCancelled("\(attempt): \(msg)")
    }
    return SpruceDidError.signFailed("\(attempt): \(msg)")
  }

  // MARK: - Sign JWS

  func signJws(alias: String, payload: ArrayBuffer) throws -> Promise<String> {
    // A Nitro `ArrayBuffer` handed in from JS is NON-OWNING: its backing store
    // is only valid for the SYNCHRONOUS duration of this call. Copy it to an
    // owning `Data` HERE, on the caller thread, BEFORE deferring to the sign
    // queue. Touching `payload.size` / `payload.data` inside the deferred
    // closure (a different thread, later) makes Nitro raise an Objective-C
    // exception that traps the whole process (EXC_BREAKPOINT / SIGTRAP) — and a
    // native trap is uncatchable by any JS try/catch, so it reads as a silent
    // 閃退. Latent bug, unmasked once the SpruceID-unavailable error stopped
    // short-circuiting the share / VC-issuance flows before signing.
    let bytes = copyPayload(payload)
    return Promise.parallel(SignSession.queue) {
      // Only P-256 (ES256) signing is wired — matches the legacy app's Swift
      // signer, which only ever produced ES256 JWS. `.ecdsaSignatureMessage…`
      // emits a DER signature we convert to raw r||s for JWS compact form.
      let signingInput = JwsFraming.makeSigningInput(payload: bytes)
      let derSig = try self.signSerially(
        alias: alias, algorithm: .ecdsaSignatureMessageX962SHA256, input: signingInput)
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
    return Promise.parallel(SignSession.queue) {
      let derSig = try self.signSerially(
        alias: alias, algorithm: .ecdsaSignatureDigestX962SHA256, input: bytes)
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
