/*
 * HybridPassportZk.kt
 * @solidarity/nitro-passport-zk (Android)
 *
 * Wraps the Rust `passport_zk_mopro` cdylib via UniFFI's generated Kotlin
 * bindings (`uniffi.mopro.*`) — see android/src/main/java/uniffi/mopro/mopro.kt
 * and the matching `libpassport_zk_mopro.so` in android/src/main/jniLibs/.
 *
 * Build pipeline:
 *   1. ../../scripts/build-passport-zk-android.sh runs
 *      `cargo run --bin android --release` in passport-noir/mopro-binding
 *      with ANDROID_ARCHS=aarch64-linux-android,x86_64-linux-android.
 *   2. The script copies the produced .so files + UniFFI Kotlin bindings
 *      into this module so gradle's normal `app:assembleDebug` picks them
 *      up via the jniLibs + java source-set conventions.
 *
 * Inputs handling:
 *   The Nitro spec keeps the surface as `inputsJson: String` (matches iOS
 *   `MoproShim.swift`); we decode it locally into the
 *   `Map<String, List<String>>` shape that uniffi's `generateNoirProof`
 *   expects (witness-name → BN254 field elements as decimal strings).
 *
 * Threading:
 *   `Promise.async` lifts us off the JS thread; the UniFFI call itself
 *   blocks while Barretenberg crunches, which is correct — we want the
 *   proof to complete before resolving. No coroutine cancellation
 *   plumbing yet; the underlying Rust call isn't cancellable mid-prove.
 *
 * Security (per CLAUDE.md):
 *   - No `!!` / force-unwrap outside guarded checks.
 *   - No PII logs — only `Log.d(TAG, "started", "done in Nms", "error: kind")`.
 *   - MoproException surfaces as a typed Kotlin error chain; we wrap it
 *     in a RuntimeException so JS receives a flat message string instead
 *     of the raw Java exception class noise (rule 8 spirit).
 */
package com.margelo.nitro.gg.solidarity.passportzk

import android.content.Context
import android.util.Log
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import uniffi.mopro.MoproException
import uniffi.mopro.generateNoirProof as moproGenerateNoirProof
import uniffi.mopro.getNoirVerificationKey as moproGetNoirVerificationKey
import uniffi.mopro.verifyNoirProof as moproVerifyNoirProof

class HybridPassportZk : HybridPassportZkSpec() {

  override fun generateNoirProof(
    circuitPath: String,
    srsPath: String?,
    inputsJson: String,
  ): Promise<NitroNoirProof> = Promise.async {
    val started = System.currentTimeMillis()
    try {
      val resolvedCircuit = resolveCircuitPath(circuitPath)
      val resolvedSrs = resolveSrsPath(srsPath)
      val inputs = parseInputs(inputsJson)
      val result = moproGenerateNoirProof(resolvedCircuit, resolvedSrs, inputs)
      Log.d(TAG, "generateNoirProof ok in ${System.currentTimeMillis() - started}ms")
      NitroNoirProof(
        proof = ArrayBuffer.copy(result.proof),
        vk = ArrayBuffer.copy(result.vk),
      )
    } catch (e: MoproException) {
      Log.d(TAG, "generateNoirProof failed: ${e::class.simpleName}")
      throw RuntimeException(friendlyMoproMessage(e))
    } catch (e: IllegalArgumentException) {
      throw RuntimeException("inputsJson malformed: ${e.message ?: "unknown"}")
    }
  }

  override fun getNoirVerificationKey(
    circuitPath: String,
    srsPath: String?,
  ): Promise<ArrayBuffer> = Promise.async {
    try {
      ArrayBuffer.copy(
        moproGetNoirVerificationKey(
          resolveCircuitPath(circuitPath),
          resolveSrsPath(srsPath),
        ),
      )
    } catch (e: MoproException) {
      throw RuntimeException(friendlyMoproMessage(e))
    }
  }

  override fun verifyNoirProof(
    proof: ArrayBuffer,
    vk: ArrayBuffer,
  ): Promise<Boolean> = Promise.async {
    try {
      moproVerifyNoirProof(proof.toByteArray(), vk.toByteArray())
    } catch (e: MoproException) {
      throw RuntimeException(friendlyMoproMessage(e))
    }
  }

  companion object {
    private const val TAG = "HybridPassportZk"

    /** Assets we ship inside the AAR for the default v3 passport flow. */
    private const val DEFAULT_CIRCUIT_ASSET = "passport_verifier.json"
    private const val DEFAULT_SRS_ASSET = "passport_verifier.srs.bin"

    /**
     * Resolve a JS-supplied circuit path. Empty → extract the bundled
     * `passport_verifier.json` into `filesDir/passport_zk/` once and reuse
     * the extracted path on subsequent calls (UniFFI's
     * `generate_noir_proof` reads from `std::fs`, so the asset has to live
     * on a real filesystem path, not inside the APK's `assets/` zip).
     */
    private fun resolveCircuitPath(supplied: String): String =
      if (supplied.isEmpty()) extractAsset(DEFAULT_CIRCUIT_ASSET).absolutePath else supplied

    private fun resolveSrsPath(supplied: String?): String? =
      if (supplied.isNullOrEmpty()) extractAsset(DEFAULT_SRS_ASSET).absolutePath else supplied

    /**
     * Idempotent asset → filesDir copy. The cache key is uncompressed size
     * (`InputStream.available()` returns uncompressed bytes for asset
     * streams regardless of AGP compression). When the user reinstalls a
     * new APK with refreshed circuits, `extractedSize != bundledSize` and
     * the file gets rewritten.
     */
    private fun extractAsset(assetName: String): File {
      val ctx: Context = NitroModules.applicationContext
        ?: throw IllegalStateException(
          "NitroModules.applicationContext is null — cannot extract $assetName",
        )
      val dest = File(ctx.filesDir, "passport_zk/$assetName").apply {
        parentFile?.mkdirs()
      }
      val bundledSize = ctx.assets.open(assetName).use { it.available().toLong() }
      if (dest.exists() && dest.length() == bundledSize) return dest
      ctx.assets.open(assetName).use { input ->
        dest.outputStream().use { out -> input.copyTo(out) }
      }
      return dest
    }

    /**
     * Parse the JS-side `{ [name]: string[] }` witness map. We trust the
     * shape because the iOS sibling validates it identically — anything
     * malformed surfaces as `IllegalArgumentException` and a friendly
     * "inputsJson malformed" message at the JS boundary.
     */
    private fun parseInputs(json: String): Map<String, List<String>> {
      if (json.isEmpty() || json == "{}") return emptyMap()
      val root = JSONObject(json)
      val out = HashMap<String, List<String>>(root.length())
      val keys = root.keys()
      while (keys.hasNext()) {
        val key = keys.next()
        val arr = root.get(key)
        if (arr !is JSONArray) {
          throw IllegalArgumentException("expected array for key \"$key\"")
        }
        val list = ArrayList<String>(arr.length())
        for (i in 0 until arr.length()) list.add(arr.getString(i))
        out[key] = list
      }
      return out
    }

    /**
     * Turn MoproException's typed variants into a single-line message
     * that's safe to surface in a toast. Never leaks the raw Java
     * exception class chain (see screenshot in issue — that's how
     * `UnsupportedOperationException` used to land in front of the user).
     */
    private fun friendlyMoproMessage(e: MoproException): String {
      val kind = when (e) {
        is MoproException.CircuitException -> "Circuit error"
        is MoproException.ProofGenerationException -> "Proof generation failed"
        is MoproException.VerificationException -> "Verification error"
        is MoproException.InvalidInput -> "Invalid input"
      }
      val detail = e.message?.takeIf { it.isNotBlank() } ?: ""
      return if (detail.isEmpty()) kind else "$kind — $detail"
    }
  }
}

