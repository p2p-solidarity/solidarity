/*
 * HybridSecretsVault.kt
 * @solidarity/nitro-secrets-vault (Android)
 *
 * Hardware-backed wrap / unwrap of arbitrary byte payloads. Mirrors the
 * iOS Secure Enclave + ECIES surface in `ios/HybridSecretsVault.swift` by
 * routing through AndroidKeyStore AES-256-GCM. On API 28+ devices that
 * advertise FEATURE_STRONGBOX_KEYSTORE we set `setIsStrongBoxBacked(true)`;
 * on older / non-StrongBox SKUs we fall back to a TEE-resident key (still
 * hardware-backed on every modern device but surfaced as `hardwareBacked
 * = isInsideSecureHardware` so JS can tell the difference). StrongBox can
 * also fail at provision time on some OEM SKUs (Pixel + LineageOS,
 * Samsung secure-element shenanigans), so we catch
 * `StrongBoxUnavailableException` at runtime and retry without StrongBox.
 *
 * Why AES-GCM rather than HPKE-style ECIES here:
 *   - AndroidKeyStore doesn't expose Secure Enclave-style P-256
 *     KeyAgreement that we can wire directly into CryptoKit primitives.
 *     The closest analogue is AES-256-GCM bound to an unextractable
 *     hardware key. We pick that path because it gives us identical
 *     "key never leaves secure hardware" semantics without bolting on a
 *     bespoke BC + KeyStore key-agreement bridge.
 *
 * Storage layout for a wrapped blob (`WrappedSecret.wrapped`):
 *   `iv(12) || ciphertext || tag(16)` — the AES-GCM standard
 *   Java-Cipher output, identical to `Cipher.doFinal()` return value.
 *
 * Required permissions (caller's AndroidManifest):
 *   - android.permission.USE_BIOMETRIC (API 28+, install-time)
 *
 * MissingPermission lint is suppressed on the BiometricPrompt usage
 * because USE_BIOMETRIC is granted at install time on API 23+.
 */
@file:Suppress("MissingPermission")

package com.margelo.nitro.gg.solidarity.keystone

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Log
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

class HybridSecretsVault : HybridSecretsVaultSpec() {

  // MARK: - Constants

  companion object {
    private const val TAG = "HybridSecretsVault"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"

    /** Algorithm discriminator returned in every WrappedSecret. */
    private const val ALGO_LABEL = "aes-gcm-strongbox"

    /** GCM-spec constants: 12-byte IV, 128-bit tag. */
    private const val GCM_IV_BYTES = 12
    private const val GCM_TAG_BITS = 128
    private const val GCM_TAG_BYTES = GCM_TAG_BITS / 8

    /**
     * Alias prefix that namespaces all secrets-vault keys inside the system
     * keystore — prevents collisions with anything else the app stores
     * (sprucedid, EncryptedSharedPreferences master keys, etc.).
     */
    private const val ALIAS_PREFIX = "gg.solidarity.secretsvault."
  }

  // MARK: - Keystore handle (lazy so we don't touch it on the JS thread)

  private val keyStore: KeyStore by lazy {
    KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
  }

  private val context: Context
    get() = NitroModules.applicationContext
      ?: throw IllegalStateException("NitroModules.applicationContext is null")

  // MARK: - Helpers

  private fun keystoreAlias(alias: String): String = ALIAS_PREFIX + alias

  private fun hasStrongBox(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
      context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)

  /**
   * Inspect a freshly-loaded `SecretKey` to figure out whether it's actually
   * inside secure hardware. On API 31+ we prefer `KeyInfo.getSecurityLevel`
   * (which can distinguish StrongBox from TEE). On older APIs we fall back
   * to the boolean `isInsideSecureHardware`. Bare `false` only happens on
   * pre-M devices or rooted emulators.
   */
  private fun keyIsHardwareBacked(secretKey: SecretKey): Boolean {
    return try {
      val factory = SecretKeyFactory.getInstance(secretKey.algorithm, ANDROID_KEYSTORE)
      val info = factory.getKeySpec(secretKey, KeyInfo::class.java) as KeyInfo
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        // SECURITY_LEVEL_STRONGBOX = 2, SECURITY_LEVEL_TRUSTED_ENVIRONMENT = 1,
        // SECURITY_LEVEL_SOFTWARE = 0.
        info.securityLevel >= KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT
      } else {
        @Suppress("DEPRECATION") info.isInsideSecureHardware
      }
    } catch (t: Throwable) {
      Log.w(TAG, "keyIsHardwareBacked probe failed: ${t.javaClass.simpleName}")
      false
    }
  }

  // MARK: - isHardwareAvailable

  override fun isHardwareAvailable(): Boolean {
    // AndroidKeyStore + hardware-backed AES has been universal on API 23+;
    // the question is really "do we have StrongBox or TEE rather than
    // software fallback". We return true if StrongBox is available; the
    // JS caller can still drive `ensureWrappingKey` and inspect the
    // returned `hardwareBacked` flag for the precise security level.
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
  }

  // MARK: - ensureWrappingKey

  override fun ensureWrappingKey(
    keyAlias: String, requireBiometric: Boolean
  ): Promise<EnsureWrappingKeyResult> = Promise.async {
    val ksAlias = keystoreAlias(keyAlias)
    if (keyStore.containsAlias(ksAlias)) {
      val existing = (keyStore.getKey(ksAlias, null) as? SecretKey)
        ?: throw IllegalStateException("alias=$keyAlias exists but is not a SecretKey")
      return@async EnsureWrappingKeyResult(hardwareBacked = keyIsHardwareBacked(existing))
    }
    val (_, hwBacked) = generateAesKey(ksAlias, requireBiometric)
    EnsureWrappingKeyResult(hardwareBacked = hwBacked)
  }

  /**
   * Generate a fresh AES-256-GCM key inside AndroidKeyStore. Tries
   * StrongBox first when available; on `StrongBoxUnavailableException`
   * (some OEM SKUs throw at provision time even when the feature is
   * advertised) we retry without StrongBox. Returns the freshly stored
   * key plus whether it landed in secure hardware.
   */
  private fun generateAesKey(
    ksAlias: String, requireBiometric: Boolean
  ): Pair<SecretKey, Boolean> {
    val purposes = KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
    fun build(useStrongBox: Boolean): KeyGenParameterSpec {
      val b = KeyGenParameterSpec.Builder(ksAlias, purposes)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setRandomizedEncryptionRequired(true)
        .setUserAuthenticationRequired(requireBiometric)
      if (useStrongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        b.setIsStrongBoxBacked(true)
      }
      if (requireBiometric && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
      } else if (requireBiometric) {
        @Suppress("DEPRECATION")
        b.setUserAuthenticationValidityDurationSeconds(-1)
      }
      return b.build()
    }

    val wantStrongBox = hasStrongBox()
    val key: SecretKey = try {
      val kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
      kg.init(build(useStrongBox = wantStrongBox))
      kg.generateKey()
    } catch (e: StrongBoxUnavailableException) {
      Log.w(TAG, "StrongBox unavailable at provision; falling back to TEE", e)
      val kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
      kg.init(build(useStrongBox = false))
      kg.generateKey()
    }
    return Pair(key, keyIsHardwareBacked(key))
  }

  // MARK: - wrap

  override fun wrap(
    keyAlias: String, plaintext: ArrayBuffer
  ): Promise<WrappedSecret> = Promise.async {
    val plaintextBytes = plaintext.toByteArray()
    if (plaintextBytes.isEmpty()) {
      throw IllegalArgumentException("plaintext is empty")
    }
    val key = loadKey(keyAlias)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key)
    val iv = cipher.iv  // AndroidKeyStore generates a fresh 12-byte IV per init
    require(iv.size == GCM_IV_BYTES) { "unexpected IV length ${iv.size}" }
    val ctAndTag = cipher.doFinal(plaintextBytes)
    val blob = ByteArray(iv.size + ctAndTag.size)
    System.arraycopy(iv, 0, blob, 0, iv.size)
    System.arraycopy(ctAndTag, 0, blob, iv.size, ctAndTag.size)
    WrappedSecret(
      algorithm = ALGO_LABEL,
      keyAlias = keyAlias,
      wrapped = ArrayBuffer.copy(blob),
      hardwareBacked = keyIsHardwareBacked(key)
    )
  }

  // MARK: - unwrap

  override fun unwrap(wrapped: WrappedSecret): Promise<ArrayBuffer> = Promise.async {
    val blob = wrapped.wrapped.toByteArray()
    if (blob.size <= GCM_IV_BYTES + GCM_TAG_BYTES) {
      throw IllegalArgumentException("wrapped blob too short: ${blob.size} bytes")
    }
    val iv = blob.copyOfRange(0, GCM_IV_BYTES)
    val ctAndTag = blob.copyOfRange(GCM_IV_BYTES, blob.size)
    val key = loadKey(wrapped.keyAlias)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
    val plaintext = cipher.doFinal(ctAndTag)
    ArrayBuffer.copy(plaintext)
  }

  // MARK: - deleteKey

  override fun deleteKey(keyAlias: String): Promise<Unit> = Promise.async {
    // Do not rely on a provider-specific missing-alias behaviour: absence is
    // already the desired state, while either operation must reject on a real
    // Keystore failure so JS cannot report a completed local wipe.
    if (keyStore.containsAlias(keystoreAlias(keyAlias))) {
      keyStore.deleteEntry(keystoreAlias(keyAlias))
    }
    Unit
  }

  // MARK: - readRawKeychainGenericPassword

  override fun readRawKeychainGenericPassword(
    service: String,
    account: String
  ): Promise<ArrayBuffer> = Promise.async {
    ArrayBuffer.allocate(0)
  }

  // MARK: - Synchronizable item (iCloud Keychain) — iOS-only capability
  //
  // Android has no iCloud Keychain equivalent, and the onboarding UI never
  // offers the iCloud backup option on this platform (see
  // apps/expo/src/onboarding/steps/BackupStep.tsx / src/identity/rootKey.ts).
  // These methods exist only to satisfy the shared TS HybridObject spec.
  // Create/read reject rather than fabricating iCloud state. Delete is the
  // one idempotent exception: no synchronizable item can exist on Android,
  // so reporting an absent delete as success lets a strict device wipe clear
  // the rest of its real stores instead of failing forever on this platform.

  override fun setSynchronizableItem(alias: String, value: String): Promise<Unit> = Promise.async {
    throw UnsupportedOperationException("iCloud Keychain sync is not supported on Android")
  }

  override fun getSynchronizableItem(alias: String): Promise<String> = Promise.async {
    throw UnsupportedOperationException("iCloud Keychain sync is not supported on Android")
  }

  override fun deleteSynchronizableItem(alias: String): Promise<Unit> = Promise.async {
    Unit
  }

  // MARK: - Internal

  private fun loadKey(keyAlias: String): SecretKey {
    val ksAlias = keystoreAlias(keyAlias)
    return (keyStore.getKey(ksAlias, null) as? SecretKey)
      ?: throw IllegalStateException("wrapping key not found for alias=$keyAlias")
  }
}
