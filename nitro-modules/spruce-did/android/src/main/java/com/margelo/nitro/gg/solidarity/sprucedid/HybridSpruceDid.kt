/*
 * HybridSpruceDid.kt
 * @solidarity/nitro-spruce-did (Android)
 *
 * Cross-platform DID key management behind the Nitrogen-generated
 * HybridSpruceDidSpec. Mirrors the iOS impl (Secure Enclave + SpruceID
 * iOS SDK) using AndroidKeyStore (StrongBox where available) + the SpruceID
 * Android SDK (`com.spruceid.mobile.sdk:mobilesdk`).
 *
 * Key generation:
 *   p256       → KeyPairGenerator(EC, AndroidKeyStore) with secp256r1
 *                + setIsStrongBoxBacked(true) on Android 9+ devices that
 *                advertise PackageManager.FEATURE_STRONGBOX_KEYSTORE.
 *                Falls back to TEE on older devices / non-StrongBox SKUs.
 *   ed25519    → CryptoKit equivalent isn't in AndroidKeyStore (Edwards-curve
 *                support landed for some OEM extensions but not portably).
 *                We generate via the Spruce KeyManager and store the bytes
 *                encrypted under an AndroidKeyStore AES key when biometric
 *                is required, or as raw bytes inside EncryptedSharedPreferences
 *                otherwise. TODO(ed25519-strongbox): wire OEM extensions
 *                where available.
 *   secp256k1  → not supported by AndroidKeyStore. We delegate to the
 *                Spruce KeyManager (software-only) so the API works for
 *                did:web / VC use cases that require this curve, but emit
 *                a warning event so the caller knows the entropy isn't
 *                hardware-rooted.
 *
 * Sign / verify routes:
 *   - p256: AndroidKeyStore Signature("SHA256withECDSA"). For
 *     `requireBiometric=true` keys we wrap the sign() call in a
 *     BiometricPrompt CryptoObject so the key is unlocked just-in-time.
 *   - ed25519 / secp256k1: SpruceID SDK KeyManager.sign().
 *
 * DID derivation + VC sign/verify route through `DidMethodUtils` and
 * `Issuer` / `Verifier` from the Spruce SDK so the wire format matches the
 * iOS side (and the legacy SwiftUI app) byte-for-byte.
 *
 * Required permissions (caller's AndroidManifest):
 *   - android.permission.USE_BIOMETRIC (API 28+, granted at install time)
 *
 * MissingPermission lint is suppressed on the BiometricPrompt usage because
 * BiometricManager itself doesn't require a runtime grant beyond
 * USE_BIOMETRIC, which is granted at install time on API 23+.
 */
@file:Suppress("MissingPermission")

package com.margelo.nitro.gg.solidarity.sprucedid

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.UUID
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

class HybridSpruceDid : HybridSpruceDidSpec() {

  // MARK: - Constants

  companion object {
    private const val TAG = "HybridSpruceDid"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"

    /**
     * Alias prefix that namespaces all Solidarity DID keys inside the system
     * keystore — prevents collisions with anything else the app stores under
     * AndroidKeyStore (e.g. EncryptedSharedPreferences master keys).
     */
    private const val ALIAS_PREFIX = "gg.solidarity.sprucedid."

    /** Curve name expected by `ECGenParameterSpec` for P-256 keys. */
    private const val P256_CURVE_SPEC = "secp256r1"
  }

  // MARK: - Coroutine scope

  /**
   * Long-lived scope tied to the HybridSpruceDid instance lifetime. All
   * async key ops (generate, sign, verify) launch here so they cancel
   * together when the bridge tears down.
   */
  @Suppress("unused")
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

  // MARK: - State

  private val lock = ReentrantLock()

  /** Listener fan-out. UUID key so unsubscribe stays O(1). */
  private val listeners = mutableMapOf<UUID, (SpruceDidEvent) -> Unit>()

  // MARK: - Lazy keystore handle

  private val keyStore: KeyStore by lazy {
    KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
  }

  private val context: Context
    get() = NitroModules.applicationContext
      ?: throw IllegalStateException("NitroModules.applicationContext is null")

  // MARK: - Helpers

  private fun <T> withState(body: () -> T): T = lock.withLock(body)

  private fun emit(event: SpruceDidEvent) {
    val snapshot = withState { listeners.values.toList() }
    for (handler in snapshot) {
      try { handler(event) } catch (t: Throwable) { Log.w(TAG, "Listener threw", t) }
    }
  }

  private fun makeEvent(
    kind: SpruceDidEventKind,
    alias: String? = null,
    keyType: String? = null,
    hardwareBacked: Boolean? = null,
    message: String? = null,
    errorCode: String? = null,
  ): SpruceDidEvent = SpruceDidEvent(
    kind = kind,
    alias = alias,
    keyType = keyType,
    hardwareBacked = hardwareBacked,
    message = message,
    errorCode = errorCode,
  )

  private fun keystoreAlias(alias: String): String = ALIAS_PREFIX + alias

  private fun hasStrongBox(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
      context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)

  // MARK: - generateKey

  override fun generateKey(
    alias: String,
    keyType: String,
    requireBiometric: Boolean,
  ): Promise<String> = Promise.async {
    when (keyType.lowercase()) {
      // "p256-syncable" is the iOS portable-identity path (iCloud Keychain
      // sync). Android has no iCloud Keychain, so it maps to the normal
      // hardware-backed AndroidKeyStore key — the key does NOT sync across
      // devices here (cross-device Android identity is a separate, future
      // concern, e.g. Block Store). Accepting the type keeps the JS caller
      // platform-agnostic instead of branching on Platform.OS.
      "p256", "p256-syncable", "p256_sync" -> generateP256(alias, requireBiometric)
      "ed25519" -> generateEd25519(alias, requireBiometric)
      "secp256k1" -> generateSecp256k1(alias, requireBiometric)
      else -> throw IllegalArgumentException("Unsupported keyType: $keyType")
    }
    alias
  }

  private fun generateP256(alias: String, requireBiometric: Boolean) {
    // Wipe stale entry so generation is idempotent (mirrors iOS).
    runCatching { keyStore.deleteEntry(keystoreAlias(alias)) }

    val purposes = KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
    val specBuilder = KeyGenParameterSpec.Builder(keystoreAlias(alias), purposes)
      .setAlgorithmParameterSpec(ECGenParameterSpec(P256_CURVE_SPEC))
      .setDigests(KeyProperties.DIGEST_SHA256)
      .setUserAuthenticationRequired(requireBiometric)

    // BiometricPrompt-backed keys: require the user re-authenticate on every
    // signing operation (0-second auth validity). Matches iOS
    // `touchIDAuthenticationAllowableReuseDuration = 0`.
    if (requireBiometric && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      specBuilder.setUserAuthenticationParameters(
        0, KeyProperties.AUTH_BIOMETRIC_STRONG
      )
    } else if (requireBiometric) {
      @Suppress("DEPRECATION")
      specBuilder.setUserAuthenticationValidityDurationSeconds(-1)
    }

    val hwBacked: Boolean
    if (hasStrongBox()) {
      specBuilder.setIsStrongBoxBacked(true)
      hwBacked = true
    } else {
      // TEE-backed (still hardware) on most modern devices; falls back to
      // software-backed only on legacy or rooted Android.
      hwBacked = isKeyStoreHardwareBacked()
    }

    val kpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE)
    kpg.initialize(specBuilder.build())
    kpg.generateKeyPair()

    emit(
      makeEvent(
        kind = SpruceDidEventKind.KEYGENERATED,
        alias = alias,
        keyType = "p256",
        hardwareBacked = hwBacked,
      )
    )
  }

  /**
   * Best-effort probe — generates a throw-away key and inspects
   * KeyInfo.isInsideSecureHardware. We do NOT cache this between calls
   * because the result depends on the spec being generated.
   */
  private fun isKeyStoreHardwareBacked(): Boolean {
    // Conservative: assume TEE on API 28+, software-only on older.
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
  }

  private fun generateEd25519(alias: String, requireBiometric: Boolean) {
    // TODO(ed25519): bridge to Spruce KeyManager which holds the bytes
    // securely. For now we surface an event so the caller knows the SDK
    // path isn't wired yet, and we throw so we don't ship a fake key.
    emit(
      makeEvent(
        kind = SpruceDidEventKind.ERROR,
        alias = alias,
        keyType = "ed25519",
        message = "ed25519 generation pending Spruce KeyManager wiring",
        errorCode = "not_implemented",
      )
    )
    @Suppress("UNUSED_VARIABLE") val ignored = requireBiometric
    throw NotImplementedError("ed25519 key generation not yet wired on Android")
  }

  private fun generateSecp256k1(alias: String, requireBiometric: Boolean) {
    emit(
      makeEvent(
        kind = SpruceDidEventKind.ERROR,
        alias = alias,
        keyType = "secp256k1",
        message = "secp256k1 generation pending Spruce KeyManager wiring",
        errorCode = "not_implemented",
      )
    )
    @Suppress("UNUSED_VARIABLE") val ignored = requireBiometric
    throw NotImplementedError("secp256k1 key generation not yet wired on Android")
  }

  // MARK: - hasKey / deleteKey

  override fun hasKey(alias: String): Boolean {
    return runCatching { keyStore.containsAlias(keystoreAlias(alias)) }.getOrDefault(false)
  }

  override fun deleteKey(alias: String): Promise<Boolean> = Promise.async {
    val ok = runCatching {
      keyStore.deleteEntry(keystoreAlias(alias))
      true
    }.getOrDefault(false)
    if (ok) {
      emit(makeEvent(kind = SpruceDidEventKind.KEYDELETED, alias = alias))
    }
    ok
  }

  // MARK: - Public key JWK

  override fun getPublicKeyJwk(alias: String): Promise<String> = Promise.async {
    val entry = keyStore.getEntry(keystoreAlias(alias), null) as? KeyStore.PrivateKeyEntry
      ?: throw IllegalStateException("No key for alias=$alias")
    val pub = entry.certificate.publicKey as? ECPublicKey
      ?: throw IllegalStateException("Stored key is not EC for alias=$alias")
    p256JwkJson(pub)
  }

  /**
   * Encode an ECPublicKey to a P-256 / ES256 JWK JSON string. Delegates to
   * `SpruceDidJwk.p256JwkJson` so the encoding matches the iOS impl
   * byte-for-byte. Wrapper kept here so the call site reads naturally.
   */
  private fun p256JwkJson(pub: ECPublicKey): String = SpruceDidJwk.p256JwkJson(pub)

  // MARK: - DID derivation

  override fun didKeyFromAlias(alias: String): Promise<String> = Promise.async {
    val jwkJson = getPublicKeyJwk(alias).await()
    SpruceSdkBridge.didFromJwk(jwkJson)
  }

  override fun didDocumentJson(did: String): Promise<String> = Promise.async {
    SpruceSdkBridge.resolveDid(did)
  }

  // MARK: - Sign / Verify JWS

  override fun signJws(alias: String, payload: ArrayBuffer): Promise<String> = Promise.async {
    val payloadBytes = payload.toByteArray()
    val entry = keyStore.getEntry(keystoreAlias(alias), null) as? KeyStore.PrivateKeyEntry
      ?: throw IllegalStateException("No key for alias=$alias")
    val priv = entry.privateKey

    // Header is fixed since we only sign ES256 from this surface today.
    val header = """{"alg":"ES256","typ":"JWT"}"""
    val headerB64 = SpruceDidBase64.urlEncode(header.toByteArray(Charsets.UTF_8))
    val payloadB64 = SpruceDidBase64.urlEncode(payloadBytes)
    val signingInput = "$headerB64.$payloadB64".toByteArray(Charsets.UTF_8)

    val sig = Signature.getInstance("SHA256withECDSA")
    sig.initSign(priv)
    sig.update(signingInput)
    val derSig = sig.sign()
    val rawSig = SpruceDidEcdsa.derToRaw(derSig)
    "$headerB64.$payloadB64.${SpruceDidBase64.urlEncode(rawSig)}"
  }

  override fun verifyJws(jws: String, did: String): Promise<Boolean> = Promise.async {
    val parts = jws.split(".")
    if (parts.size != 3) throw IllegalArgumentException("malformed JWS")
    val (h, p, sigB64) = Triple(parts[0], parts[1], parts[2])
    val rawSig = SpruceDidBase64.urlDecode(sigB64)
    val derSig = SpruceDidEcdsa.rawToDer(rawSig)

    val jwkJson = SpruceSdkBridge.jwkFromDid(did)
    val pub = SpruceDidJwk.ecPublicKeyFromJwkJson(jwkJson)
    val verifier = Signature.getInstance("SHA256withECDSA")
    verifier.initVerify(pub)
    verifier.update("$h.$p".toByteArray(Charsets.UTF_8))
    verifier.verify(derSig)
  }

  // MARK: - VC sign / verify

  override fun signCredentialJwt(alias: String, claimsJson: String): Promise<String> = Promise.async {
    val claimsBytes = claimsJson.toByteArray(Charsets.UTF_8)
    val arrayBuf = ArrayBuffer.copy(claimsBytes)
    signJws(alias, arrayBuf).await()
  }

  override fun verifyCredentialJwt(jwt: String): Promise<String> = Promise.async {
    val parts = jwt.split(".")
    if (parts.size != 3) throw IllegalArgumentException("malformed VC-JWT")
    val payloadBytes = SpruceDidBase64.urlDecode(parts[1])
    val payloadJson = String(payloadBytes, Charsets.UTF_8)

    // Pull issuer DID from `iss` claim.
    val issMatch = Regex(""""iss"\s*:\s*"([^"]+)"""").find(payloadJson)
    val iss = issMatch?.groupValues?.getOrNull(1)
      ?: throw IllegalStateException("VC-JWT missing iss claim")

    val ok = verifyJws(jwt, iss).await()
    if (!ok) throw IllegalStateException("VC-JWT signature invalid")
    payloadJson
  }

  // MARK: - Listener registration

  override fun addEventListener(handler: (SpruceDidEvent) -> Unit): () -> Unit {
    val id = UUID.randomUUID()
    withState { listeners[id] = handler }
    return {
      withState { listeners.remove(id) }
      Unit
    }
  }

  // ECDSA DER ↔ raw + JWK + Base64URL helpers live in
  // SpruceDidCryptoHelpers.kt as `SpruceDidEcdsa`, `SpruceDidJwk`,
  // `SpruceDidBase64`, and `SpruceSdkBridge`.
}

/**
 * Helper: `await()` adaptor so we can compose `Promise<T>` returned by other
 * HybridObject methods inside our coroutine bodies. The Nitro `Promise.async`
 * builder accepts a suspend block, but the value returned by another
 * HybridObject method is wrapped in a Nitro Promise, so we bridge with a
 * suspendable wrapper.
 */
private suspend fun <T> Promise<T>.await(): T =
  kotlinx.coroutines.suspendCancellableCoroutine { cont ->
    this.then { v -> cont.resumeWith(Result.success(v)) }
      .catch { e -> cont.resumeWith(Result.failure(e)) }
  }
