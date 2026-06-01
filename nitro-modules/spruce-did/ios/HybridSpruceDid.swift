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
//  DID derivation + JWS / VC sign + verify are routed through the SpruceID
//  Mobile SDK (`SpruceIDMobileSdkRs`) so the wire format matches whatever
//  did:key / VC-JWT shape the SpruceID resolver emits — the same library the
//  legacy Swift app and the Spruce verifier infra speak. The SpruceID SDK is
//  added as a Swift Package by the consuming app (config plugin in
//  apps/expo/plugins/withSpruceIdSpmPackage.js — see podspec for details).
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

#if canImport(SpruceIDMobileSdkRs)
  import SpruceIDMobileSdkRs
#endif

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
      let ok = self.store.deleteKey(alias: alias)
      if ok { self.emit(self.makeEvent(.keydeleted, alias: alias)) }
      return ok
    }
  }

  // MARK: - Public key JWK

  func getPublicKeyJwk(alias: String) throws -> Promise<String> {
    return Promise.async { try self.store.publicKeyJwk(alias: alias) }
  }

  // MARK: - DID derivation

  func didKeyFromAlias(alias: String) throws -> Promise<String> {
    return Promise.async {
      let jwkString = try self.store.publicKeyJwk(alias: alias)
      #if canImport(SpruceIDMobileSdkRs)
        // Spruce SDK exposes `DidMethodUtils(method: .key)` whose
        // `didFromJwk(jwk:)` returns the canonical did:key string. This is the
        // exact API the legacy KeychainService uses.
        let utils = DidMethodUtils(method: .key)
        do {
          return try utils.didFromJwk(jwk: jwkString)
        } catch {
          throw SpruceDidError.spruceSdkError(error.localizedDescription)
        }
      #else
        throw SpruceDidError.spruceSdkUnavailable
      #endif
    }
  }

  func didDocumentJson(did: String) throws -> Promise<String> {
    return Promise.async {
      #if canImport(SpruceIDMobileSdkRs)
        // Spruce's DID resolver returns a JSON-serialised document. The
        // resolver covers did:key / did:web / did:jwk natively.
        let resolver = DidResolver()
        do {
          let document = try await resolver.resolve(did: did)
          // The Rust binding returns the document as JSON via a stringified
          // method. Fall back to a manual encode if `toJsonString()` isn't
          // present in the linked version.
          if let str = (document as AnyObject).value(forKey: "json") as? String {
            return str
          }
          return String(describing: document)
        } catch {
          throw SpruceDidError.spruceSdkError(error.localizedDescription)
        }
      #else
        throw SpruceDidError.spruceSdkUnavailable
      #endif
    }
  }

  // MARK: - Sign / Verify JWS

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
      let priv = try self.store.fetchECPrivateKey(alias: alias)
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

  func verifyJws(jws: String, did: String) throws -> Promise<Bool> {
    return Promise.async {
      let parts = jws.split(separator: ".")
      guard parts.count == 3,
        let sigBytes = Base64Url.decode(String(parts[2]))
      else {
        throw SpruceDidError.verifyFailed("malformed JWS")
      }
      let signingInput = "\(parts[0]).\(parts[1])".data(using: .utf8) ?? Data()
      let digest = SHA256.hash(data: signingInput)

      #if canImport(SpruceIDMobileSdkRs)
        // Resolve the DID to find the verification method, then call
        // CryptoKit verify with the extracted JWK. Doing the verification
        // locally (rather than the Spruce SDK's `Verifier`) keeps the API
        // permissive for did:key / did:web inputs that the SDK doesn't
        // round-trip-verify out of the box.
        do {
          let utils = DidMethodUtils(method: .key)
          // For did:key we can extract the JWK directly without resolving.
          let jwkString: String
          if did.hasPrefix("did:key:") {
            jwkString = try utils.jwkFromDid(did: did)
          } else {
            let docJson = try await DidResolver().resolve(did: did)
            jwkString = String(describing: docJson)
          }
          guard let jwkData = jwkString.data(using: .utf8),
            let jwk = try JSONSerialization.jsonObject(with: jwkData) as? [String: Any]
          else {
            throw SpruceDidError.verifyFailed("could not parse resolved JWK")
          }
          let pubKey = try JwkUtils.p256PublicKeyFromJwk(jwk)
          let r = sigBytes.prefix(32)
          let s = sigBytes.suffix(32)
          let signature = try P256.Signing.ECDSASignature(rawRepresentation: r + s)
          return pubKey.isValidSignature(signature, for: digest)
        } catch let e as SpruceDidError {
          throw e
        } catch {
          throw SpruceDidError.verifyFailed(error.localizedDescription)
        }
      #else
        // No Spruce SDK linked — fall back to a strict reject so callers
        // know hardware-backed verification is unavailable.
        throw SpruceDidError.spruceSdkUnavailable
      #endif
    }
  }

  // MARK: - VC sign / verify

  func signCredentialJwt(alias: String, claimsJson: String) throws -> Promise<String> {
    return Promise.async {
      guard let payload = claimsJson.data(using: .utf8) else {
        throw SpruceDidError.invalidInput("claimsJson is not valid UTF-8")
      }
      // VC-JWT is structurally identical to a regular JWS — same compact
      // serialisation, just with a `vc` claim inside the payload. We can
      // reuse signJws and let the caller embed the required claims.
      return try await self.signJwsBytes(alias: alias, payload: payload)
    }
  }

  func verifyCredentialJwt(jwt: String) throws -> Promise<String> {
    return Promise.async {
      let parts = jwt.split(separator: ".")
      guard parts.count == 3,
        let payloadData = Base64Url.decode(String(parts[1]))
      else {
        throw SpruceDidError.verifyFailed("malformed VC-JWT")
      }
      let payloadJson = String(data: payloadData, encoding: .utf8) ?? "{}"
      // Pull issuer DID out of the payload's `iss` claim.
      let claims = (try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any]) ?? [:]
      guard let iss = claims["iss"] as? String else {
        throw SpruceDidError.verifyFailed("VC-JWT missing iss claim")
      }
      let ok = try await self.verifyJwsString(jws: jwt, did: iss)
      guard ok else { throw SpruceDidError.verifyFailed("VC-JWT signature invalid") }
      return payloadJson
    }
  }

  // MARK: - Internal helpers (sign/verify reuse)

  private func signJwsBytes(alias: String, payload: Data) async throws -> String {
    let arrayBuf: ArrayBuffer
    do { arrayBuf = try ArrayBuffer.copy(data: payload) }
    catch { throw SpruceDidError.signFailed(error.localizedDescription) }
    let promise = try signJws(alias: alias, payload: arrayBuf)
    return try await promise.await()
  }

  private func verifyJwsString(jws: String, did: String) async throws -> Bool {
    let promise = try verifyJws(jws: jws, did: did)
    return try await promise.await()
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

// MARK: - Promise composition note
//
// Nitro's `Promise<T>` already exposes `await()` (see NitroModules/Promise.swift),
// so signCredentialJwt / verifyCredentialJwt compose by `try await
// otherPromise.await()` — no local extension needed.
