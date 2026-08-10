/*
 * HybridSemaphore.kt
 * @solidarity/nitro-semaphore (Android)
 *
 * Wraps the Rust `libsemaphore_bindings.so` (semaphore-rs uniffi cdylib)
 * for on-device Semaphore identity + membership proofs.
 *
 * Storage:
 *   - Identity bytes  → EncryptedSharedPreferences (Keychain analogue).
 *   - Nullifier set   → same prefs, JSON-encoded under a single key, so the
 *                       record/lookup contract matches NullifierStore.swift.
 *
 * Field-element semantics:
 *   commitments are DECIMAL-STRING field elements (BN254 scalar field).
 *   We re-implement Swift's `decimalStringToLittleEndian32` + `clampToMax32Bytes`
 *   here so a TS commitment generated on Android matches one generated on
 *   iOS bit-for-bit.
 *
 * Until `rust/build-android.sh` produces the .so files under
 * src/main/jniLibs/<abi>/libsemaphore_bindings.so, every native method on
 * this class throws UnsupportedOperationException; storage + canonicalisation
 * still work so the rest of the app can hydrate UI off cached state.
 */
package com.margelo.nitro.gg.solidarity.semaphore

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import com.facebook.soloader.SoLoader
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

class HybridSemaphore : HybridSemaphoreSpec() {

  // ──────────────────────────────────────────────────────────────────────────
  // Constants (must match Swift Branding.swift + NullifierStore.swift)
  // ──────────────────────────────────────────────────────────────────────────

  companion object {
    private const val DEFAULT_IDENTITY_ALIAS = "com.kidneyweakx.solidarity.semaphore.identity"
    private const val LEGACY_IDENTITY_ALIAS = "com.kidneyweakx.airmeishi.semaphore.identity"
    private const val NULLIFIER_STORE_KEY   = "solidarity.zk.nullifiers"
    private const val PREFS_FILE_NAME       = "solidarity_semaphore_v1"
    private const val NATIVE_LIB_NAME       = "semaphore_bindings"

    @Volatile private var nativeLoaded: Boolean = false
    @Synchronized
    private fun ensureNative(): Boolean {
      if (nativeLoaded) return true
      return try {
        SoLoader.loadLibrary(NATIVE_LIB_NAME)
        nativeLoaded = true
        true
      } catch (_: Throwable) {
        false
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // In-memory cache (single active identity)
  // ──────────────────────────────────────────────────────────────────────────

  private val cacheLock = ReentrantLock()
  private var cachedPrivateKey: ByteArray? = null
  private var cachedCommitment: String = ""

  // ──────────────────────────────────────────────────────────────────────────
  // Identity
  // ──────────────────────────────────────────────────────────────────────────

  override fun generateIdentity(): Promise<String> = Promise.async {
    val secret = ByteArray(32).also { SecureRandom().nextBytes(it) }
    installIdentity(secret)
  }

  override fun identityFromSeed(seed: ArrayBuffer): Promise<String> = Promise.async {
    val bytes = arrayBufferToBytes(seed)
    require(bytes.size == 32) { "Seed must be exactly 32 bytes (got ${bytes.size})" }
    installIdentity(bytes)
  }

  override fun getCommitment(): String = cacheLock.withLock { cachedCommitment }

  override fun loadIdentityFromKeychain(alias: String): Promise<Boolean> = Promise.async {
    val resolvedAlias = alias.ifEmpty { DEFAULT_IDENTITY_ALIAS }
    val prefs = securePrefs()
    val storedB64 = prefs.getString(resolvedAlias, null)
    if (storedB64 != null) {
      adoptStoredKey(decodeBase64(storedB64))
      return@async true
    }
    // Mirror SemaphoreIdentityManager's legacy-alias migration.
    if (alias.isEmpty()) {
      val legacyB64 = prefs.getString(LEGACY_IDENTITY_ALIAS, null) ?: return@async false
      val bytes = decodeBase64(legacyB64)
      adoptStoredKey(bytes)
      prefs.edit().putString(DEFAULT_IDENTITY_ALIAS, encodeBase64(bytes)).apply()
      return@async true
    }
    false
  }

  override fun storeIdentityToKeychain(alias: String): Promise<Unit> = Promise.async {
    val resolvedAlias = alias.ifEmpty { DEFAULT_IDENTITY_ALIAS }
    val bytes = cacheLock.withLock { cachedPrivateKey }
      ?: throw IllegalStateException("Semaphore identity not loaded")
    securePrefs().edit().putString(resolvedAlias, encodeBase64(bytes)).apply()
  }

  override fun deleteIdentity(): Promise<Unit> = Promise.async {
    val deleted = securePrefs().edit()
      .remove(DEFAULT_IDENTITY_ALIAS)
      .remove(LEGACY_IDENTITY_ALIAS)
      .remove(NULLIFIER_STORE_KEY)
      .commit()
    check(deleted) { "Failed to delete Semaphore identity" }
    cacheLock.withLock {
      cachedPrivateKey = null
      cachedCommitment = ""
    }
  }

  override fun exportPrivateKey(): Promise<ArrayBuffer> = Promise.async {
    val bytes = cacheLock.withLock { cachedPrivateKey }
      ?: throw IllegalStateException("Semaphore identity not loaded")
    bytesToArrayBuffer(bytes)
  }

  override fun importPrivateKey(bytes: ArrayBuffer): Promise<String> = Promise.async {
    val raw = arrayBufferToBytes(bytes)
    require(raw.size == 32) { "Seed must be exactly 32 bytes (got ${raw.size})" }
    installIdentity(raw)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Group root
  // ──────────────────────────────────────────────────────────────────────────

  override fun groupRootFromCommitments(commitments: Array<String>): Promise<String> =
    Promise.async {
      val canonical = canonicalCommitments(commitments.toList())
      if (canonical.isEmpty()) return@async "0"
      requireNativeLib()
      val elements = canonical.map { decimalStringToLittleEndian32(it) }
      val rootBytes = NativeBridge.groupRoot(elements)
      littleEndian32ToDecimalString(rootBytes)
    }

  // ──────────────────────────────────────────────────────────────────────────
  // Proof gen + verify
  // ──────────────────────────────────────────────────────────────────────────

  override fun generateProof(
    commitments: Array<String>,
    scope: String,
    signal: String,
  ): Promise<SemaphoreProof> = Promise.async {
    requireNativeLib()
    val privateKey = cacheLock.withLock { cachedPrivateKey }
      ?: throw IllegalStateException("Semaphore identity not loaded")
    val ownCommitment = cacheLock.withLock { cachedCommitment }
    val merged = commitments.toMutableList().apply { add(ownCommitment) }
    val canonical = canonicalCommitments(merged)
    require(canonical.size > 1) {
      "Proof requires at least 2 distinct member commitments."
    }
    val normalisedScope = clampToMax32Bytes(scope)
    val normalisedSignal = clampToMax32Bytes(signal)
    val proofJson = NativeBridge.generateProof(
      privateKey = privateKey,
      members = canonical.map { decimalStringToLittleEndian32(it) },
      message = normalisedSignal,
      scope = normalisedScope,
      merkleTreeDepth = 16,
    )
    parseProof(proofJson, fallbackScope = normalisedScope, fallbackSignal = normalisedSignal)
  }

  override fun verifyProof(proof: SemaphoreProof, merkleTreeDepth: Double): Promise<Boolean> =
    Promise.async {
      requireNativeLib()
      NativeBridge.verifyProof(proof.proofJson)
    }

  override fun extractNullifier(proof: SemaphoreProof): String = proof.nullifier

  // ──────────────────────────────────────────────────────────────────────────
  // Nullifier store (EncryptedSharedPreferences-backed, sync)
  // ──────────────────────────────────────────────────────────────────────────

  override fun hasNullifier(scope: String, nullifier: String): Boolean {
    return loadNullifierSet().contains(nullifierKey(scope, nullifier))
  }

  override fun recordNullifier(scope: String, nullifier: String) {
    val set = loadNullifierSet().toMutableSet()
    if (set.add(nullifierKey(scope, nullifier))) {
      persistNullifierSet(set)
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private — identity lifecycle
  // ──────────────────────────────────────────────────────────────────────────

  private fun installIdentity(secret: ByteArray): String {
    requireNativeLib()
    val commitment = NativeBridge.commitment(secret)
    cacheLock.withLock {
      cachedPrivateKey = secret
      cachedCommitment = commitment
    }
    securePrefs().edit().putString(DEFAULT_IDENTITY_ALIAS, encodeBase64(secret)).apply()
    return commitment
  }

  private fun adoptStoredKey(bytes: ByteArray) {
    requireNativeLib()
    val commitment = NativeBridge.commitment(bytes)
    cacheLock.withLock {
      cachedPrivateKey = bytes
      cachedCommitment = commitment
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private — EncryptedSharedPreferences
  // ──────────────────────────────────────────────────────────────────────────

  private fun securePrefs(): SharedPreferences {
    val ctx = requireContext()
    val masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
    return EncryptedSharedPreferences.create(
      PREFS_FILE_NAME,
      masterKeyAlias,
      ctx,
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
  }

  private fun requireContext(): Context {
    val ctx = NitroModules.applicationContext
      ?: throw IllegalStateException("NitroModules.applicationContext missing — was the package autolinked?")
    return ctx.applicationContext ?: ctx
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private — encoding helpers (KEEP IN SYNC with SemaphoreShim.swift)
  // ──────────────────────────────────────────────────────────────────────────

  private fun canonicalCommitments(commitments: List<String>): List<String> =
    commitments
      .asSequence()
      .map { it.trim() }
      .filter { it.isNotEmpty() }
      .toSet()
      .sorted()

  /** UTF-8 truncate to 32 bytes. Mirrors Swift clampToMax32Bytes. */
  private fun clampToMax32Bytes(input: String): String {
    val bytes = input.toByteArray(Charsets.UTF_8)
    if (bytes.size <= 32) return input
    val truncated = bytes.copyOfRange(0, 32)
    // Drop any trailing partial code point so we still get valid UTF-8.
    for (cut in truncated.size downTo 0) {
      val candidate = truncated.copyOfRange(0, cut).toString(Charsets.UTF_8)
      if (candidate.toByteArray(Charsets.UTF_8).size == cut) return candidate
    }
    return ""
  }

  /**
   * Decimal-string field element → 32-byte little-endian bytes.
   * KEEP IN SYNC with SemaphoreShim.swift::decimalStringToLittleEndian32
   * and SemaphoreIdentityManager.swift:436-453.
   */
  private fun decimalStringToLittleEndian32(value: String): ByteArray {
    val normalized = value.trim()
    require(normalized.isNotEmpty()) { "Commitment is empty." }
    require(normalized.all { it.isDigit() }) {
      "Commitment must be a decimal field element string."
    }
    val bytes = IntArray(32)
    for (ch in normalized) {
      val digit = ch.digitToInt()
      var carry = digit
      for (i in bytes.indices) {
        val total = bytes[i] * 10 + carry
        bytes[i] = total and 0xff
        carry = total ushr 8
      }
      if (carry > 0) {
        throw IllegalArgumentException("Commitment exceeds 256-bit field element size.")
      }
    }
    return ByteArray(32) { bytes[it].toByte() }
  }

  /** Inverse: 32-byte little-endian → decimal string. */
  private fun littleEndian32ToDecimalString(bytes: ByteArray): String {
    require(bytes.size <= 32)
    val digits = ArrayList<Int>(80)
    digits.add(0)
    for (i in bytes.indices.reversed()) {
      var carry = bytes[i].toInt() and 0xff
      for (j in digits.indices) {
        val total = digits[j] * 256 + carry
        digits[j] = total % 10
        carry = total / 10
      }
      while (carry > 0) {
        digits.add(carry % 10)
        carry /= 10
      }
    }
    return digits.reversed()
      .joinToString("")
      .trimStart('0')
      .ifEmpty { "0" }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private — proof + nullifier JSON
  // ──────────────────────────────────────────────────────────────────────────

  private fun parseProof(
    json: String,
    fallbackScope: String,
    fallbackSignal: String,
  ): SemaphoreProof {
    val obj = JSONObject(json)
    val root = obj.optString("merkle_tree_root", obj.optString("merkleTreeRoot", ""))
    val nullifier = obj.optString("nullifier", obj.optString("nullifierHash", ""))
    val scope = obj.optString("scope", fallbackScope)
    val message = obj.optString("message", obj.optString("signal", fallbackSignal))
    val depth = obj.optDouble(
      "merkle_tree_depth",
      obj.optDouble("merkleTreeDepth", 16.0)
    )
    // Re-emit so JS gets a canonical key set.
    val out = JSONObject()
      .put("merkle_tree_depth", depth.toInt())
      .put("merkle_tree_root", root)
      .put("nullifier", nullifier)
      .put("message", message)
      .put("scope", scope)
    obj.optJSONArray("points")?.let { out.put("points", it) }
    return SemaphoreProof(
      nullifier = nullifier,
      merkleRoot = root,
      scope = scope,
      signal = message,
      proofJson = out.toString(),
      merkleTreeDepth = depth,
    )
  }

  private fun nullifierKey(scope: String, nullifier: String): String = "$scope|$nullifier"

  private fun loadNullifierSet(): Set<String> {
    val payload = securePrefs().getString(NULLIFIER_STORE_KEY, null) ?: return emptySet()
    return try {
      val arr = JSONArray(payload)
      buildSet {
        for (i in 0 until arr.length()) add(arr.optString(i))
      }
    } catch (_: Throwable) {
      emptySet()
    }
  }

  private fun persistNullifierSet(set: Set<String>) {
    val arr = JSONArray()
    set.forEach { arr.put(it) }
    securePrefs().edit().putString(NULLIFIER_STORE_KEY, arr.toString()).apply()
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private — ArrayBuffer interop
  // ──────────────────────────────────────────────────────────────────────────

  private fun arrayBufferToBytes(ab: ArrayBuffer): ByteArray {
    val buf = ab.getBuffer(false)
    val out = ByteArray(buf.remaining())
    buf.get(out)
    return out
  }

  private fun bytesToArrayBuffer(bytes: ByteArray): ArrayBuffer {
    val ab = ArrayBuffer.allocate(bytes.size)
    val buf = ab.getBuffer(true)
    buf.put(bytes)
    return ab
  }

  private fun encodeBase64(bytes: ByteArray): String =
    android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)

  private fun decodeBase64(s: String): ByteArray =
    android.util.Base64.decode(s, android.util.Base64.NO_WRAP)

  private fun requireNativeLib() {
    if (!ensureNative()) {
      throw UnsupportedOperationException(
        "libsemaphore_bindings.so is not bundled in this build. Run " +
          "`bash nitro-modules/semaphore/rust/build-android.sh` to produce " +
          "the JNI artefacts under android/src/main/jniLibs/<abi>/."
      )
    }
  }
}
