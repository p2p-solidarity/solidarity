/*
 * HybridPassportZk.kt
 * @solidarity/nitro-passport-zk (Android)
 *
 * Wraps the Rust `passport_zk_mopro` cdylib via JNI. Implements the
 * Nitrogen-generated `HybridPassportZkSpec` abstract class.
 *
 * TODO: build cdylib for aarch64-linux-android + x86_64-linux-android
 * via `cargo ndk` from passport-noir/mopro-binding/, drop into
 * android/src/main/jniLibs/<abi>/libpassport_zk_mopro.so, then call
 * `nativeGenerateNoirProof` / `nativeGetVk` / `nativeVerify` via JNI
 * here. Returning errors today so the JS fallback path runs.
 */
package gg.solidarity.passportzk

import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import com.margelo.nitro.gg.solidarity.passportzk.HybridPassportZkSpec
import com.margelo.nitro.gg.solidarity.passportzk.NoirProofResult

class HybridPassportZk : HybridPassportZkSpec() {

  override fun generateNoirProof(
    circuitPath: String,
    srsPath: String?,
    inputsJson: String,
  ): Promise<NoirProofResult> = Promise.async {
    throw UnsupportedOperationException(
      "passport-zk Android impl not linked yet — build libpassport_zk_mopro.so first"
    )
  }

  override fun getNoirVerificationKey(
    circuitPath: String,
    srsPath: String?,
  ): Promise<ArrayBuffer> = Promise.async {
    throw UnsupportedOperationException("not linked yet")
  }

  override fun verifyNoirProof(
    proof: ArrayBuffer,
    vk: ArrayBuffer,
  ): Promise<Boolean> = Promise.async { false }
}
