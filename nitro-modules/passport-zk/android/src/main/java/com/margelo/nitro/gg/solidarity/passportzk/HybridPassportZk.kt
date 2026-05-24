/*
 * HybridPassportZk.kt
 * @solidarity/nitro-passport-zk (Android)
 *
 * Wraps the Rust `passport_zk_mopro` cdylib via JNI. Implements the
 * Nitrogen-generated `HybridPassportZkSpec` abstract class. Package must
 * live under `com.margelo.nitro.gg.solidarity.passportzk` so the JNI
 * lookup hits the same FQCN as JHybridPassportZkSpec::initHybrid expects
 * — the earlier `gg.solidarity.passportzk` placement failed at runtime
 * with `NoClassDefFoundError`.
 *
 * TODO: build cdylib for aarch64-linux-android + x86_64-linux-android
 * via `cargo ndk` from passport-noir/mopro-binding/, drop into
 * android/src/main/jniLibs/<abi>/libpassport_zk_mopro.so, then call
 * native methods here.
 */
package com.margelo.nitro.gg.solidarity.passportzk

import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise

class HybridPassportZk : HybridPassportZkSpec() {

  override fun generateNoirProof(
    circuitPath: String,
    srsPath: String?,
    inputsJson: String,
  ): Promise<NitroNoirProof> = Promise.async {
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
