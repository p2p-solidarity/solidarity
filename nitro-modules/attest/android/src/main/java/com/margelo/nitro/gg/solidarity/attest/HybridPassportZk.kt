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
package com.margelo.nitro.gg.solidarity.attest

import android.content.Context
import android.util.Log
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import uniffi.mopro.MoproException
import uniffi.mopro.buildOpenAcV3WitnessBundle as moproBuildOpenAcV3WitnessBundle
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
    Log.d(TAG, "generateNoirProof: enter (inputsJson=${inputsJson.length}B)")
    try {
      val resolvedCircuit = resolveCircuitPath(circuitPath)
      val resolvedSrs = resolveSrsPath(srsPath)
      Log.d(TAG, "generateNoirProof: circuit=$resolvedCircuit srs=$resolvedSrs")
      val inputs = parseInputs(inputsJson)
      Log.d(
        TAG,
        "generateNoirProof: parsed ${inputs.size} witness slots — calling mopro…",
      )
      val result = moproGenerateNoirProof(resolvedCircuit, resolvedSrs, inputs)
      Log.d(
        TAG,
        "generateNoirProof: mopro ok in ${System.currentTimeMillis() - started}ms " +
          "(proof=${result.proof.size}B vk=${result.vk.size}B)",
      )
      NitroNoirProof(
        proof = ArrayBuffer.copy(result.proof),
        vk = ArrayBuffer.copy(result.vk),
      )
    } catch (e: MoproException) {
      Log.e(
        TAG,
        "generateNoirProof: MoproException ${e::class.simpleName} — ${e.message ?: "(no message)"}",
      )
      throw RuntimeException(friendlyMoproMessage(e))
    } catch (e: IllegalArgumentException) {
      Log.e(TAG, "generateNoirProof: inputsJson malformed — ${e.message ?: "(no message)"}")
      throw RuntimeException("inputsJson malformed: ${e.message ?: "unknown"}")
    } catch (e: UnsatisfiedLinkError) {
      // JNA / dlopen failure — most common cause is .so for wrong ABI or
      // missing libc++_shared.so. Surface a specific, actionable message
      // instead of falling through to the generic "unknown error" path.
      Log.e(TAG, "generateNoirProof: UnsatisfiedLinkError — ${e.message ?: "(no message)"}")
      throw RuntimeException(
        "Native ZK library failed to load: ${e.message ?: "see logcat"}. " +
          "Likely cause: libpassport_zk_mopro.so is missing the device's ABI.",
      )
    } catch (e: Throwable) {
      Log.e(
        TAG,
        "generateNoirProof: unexpected ${e::class.simpleName} — ${e.message ?: "(no message)"}",
        e,
      )
      throw RuntimeException(
        "ZK prover crashed: ${e::class.simpleName}: ${e.message ?: "(no message)"}",
      )
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

  override fun buildOpenAcV3WitnessBundle(
    requestJson: String,
  ): Promise<OpenAcV3WitnessBuildResult> = Promise.async {
    try {
      decodeWitnessResult(moproBuildOpenAcV3WitnessBundle(requestJson))
    } catch (e: MoproException) {
      throw RuntimeException(friendlyMoproMessage(e))
    }
  }

  companion object {
    private const val TAG = "HybridPassportZk"
    // NOTE: An earlier iteration of this companion object preloaded a
    // `libcxx_stream_shim.so` to inject `std::__1::basic_ostringstream`
    // and ~18 other RTTI/VTT symbols via `.set` asm aliases mapping
    // `__1` → `__ndk1`. That experiment is preserved under
    // `android/src/main/cpp/cxx_stream_shim.cpp` because the build
    // pipeline works and the discovery is valuable, but the preload was
    // removed: AztecProtocol's prebuilt `libbb-external.a` references
    // ~3978 `__1`-namespaced libc++ symbols (not just stream RTTI), so
    // alias-shimming is not maintainable. See `KNOWN_ISSUES.md` for the
    // full story and the real-fix paths.

    private const val DEFAULT_CIRCUIT_ALIAS = "passport_adapter"

    // Single merged SRS for the whole OpenAC v3 passport set. barretenberg's
    // SRS is a prefix, so one blob sized to the largest circuit serves all
    // three — every circuit alias resolves to the same `passport.srs.bin`.
    private const val MERGED_SRS_ASSET = "passport.srs.bin"

    private val CIRCUIT_ASSETS = mapOf(
      "dsc_chain" to "dsc_chain.json",
      "dsc_chain.json" to "dsc_chain.json",
      "passport_adapter" to "passport_adapter.json",
      "passport_adapter.json" to "passport_adapter.json",
      "openac_show" to "openac_show.json",
      "openac_show.json" to "openac_show.json",
    )

    // Every known circuit/SRS alias maps to the one merged SRS asset.
    private val SRS_ASSETS = mapOf(
      "dsc_chain" to MERGED_SRS_ASSET,
      "dsc_chain.srs.bin" to MERGED_SRS_ASSET,
      "passport_adapter" to MERGED_SRS_ASSET,
      "passport_adapter.srs.bin" to MERGED_SRS_ASSET,
      "openac_show" to MERGED_SRS_ASSET,
      "openac_show.srs.bin" to MERGED_SRS_ASSET,
      "passport" to MERGED_SRS_ASSET,
      "passport.srs.bin" to MERGED_SRS_ASSET,
    )

    /**
     * Resolve a JS-supplied circuit path. Empty → extract the bundled
     * passport-noir 0.3.0 passport adapter into `filesDir/passport_zk/`.
     * Known aliases resolve to bundled assets; unknown values pass through
     * as external filesystem paths. UniFFI's
     * `generate_noir_proof` reads from `std::fs`, so the asset has to live
     * on a real filesystem path, not inside the APK's `assets/` zip).
     */
    private fun resolveCircuitPath(supplied: String): String {
      val key = if (supplied.isEmpty()) DEFAULT_CIRCUIT_ALIAS else supplied
      val assetName = CIRCUIT_ASSETS[key] ?: return supplied
      return extractAsset(assetName).absolutePath
    }

    private fun resolveSrsPath(supplied: String?): String? {
      // Empty or any known circuit alias → the single merged SRS; unknown
      // values pass through as external filesystem paths.
      val key = if (supplied.isNullOrEmpty()) MERGED_SRS_ASSET else supplied
      val assetName = SRS_ASSETS[key] ?: return supplied
      return extractAsset(assetName).absolutePath
    }

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
      if (dest.exists() && dest.length() == bundledSize) {
        Log.d(TAG, "extractAsset: $assetName already cached (${dest.length()}B)")
        return dest
      }
      val started = System.currentTimeMillis()
      ctx.assets.open(assetName).use { input ->
        dest.outputStream().use { out -> input.copyTo(out) }
      }
      Log.d(
        TAG,
        "extractAsset: $assetName extracted (${dest.length()}B) in " +
          "${System.currentTimeMillis() - started}ms",
      )
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
     * Decode the Rust builder's result JSON
     * (`gg.solidarity.passport.openac-v3.witness-build-result.v1`) into the
     * Nitro struct the JS layer consumes.
     */
    private fun decodeWitnessResult(resultJson: String): OpenAcV3WitnessBuildResult {
      val result = try {
        JSONObject(resultJson)
      } catch (e: Throwable) {
        throw RuntimeException(
          "OpenAC v3 witness result malformed: ${e.message ?: e.javaClass.simpleName}",
        )
      }
      return OpenAcV3WitnessBuildResult(
        schema = result.getString("schema"),
        passportNoirVersion = result.getString("passportNoirVersion"),
        ready = result.getBoolean("ready"),
        reason = if (result.isNull("reason")) null else result.optString("reason", null),
        bundleJson = if (result.isNull("bundleJson")) null else result.optString("bundleJson", null),
      )
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
