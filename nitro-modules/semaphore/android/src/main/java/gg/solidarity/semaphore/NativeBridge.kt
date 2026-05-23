/*
 * NativeBridge.kt
 * @solidarity/nitro-semaphore (Android)
 *
 * Thin Kotlin wrapper around the uniffi-generated `uniffi.semaphore_bindings`
 * package. We isolate it here so HybridSemaphore.kt depends on a small,
 * stable surface — when the Rust UDL changes only this file needs to be
 * touched.
 *
 * The uniffi Kotlin package is generated at build time by
 * `rust/build-android.sh` (which runs `uniffi-bindgen generate --language kotlin`)
 * and lands under `android/src/main/java/uniffi/semaphore_bindings/`. Until
 * that script has been run, this object falls back to a stub that throws
 * `UnsupportedOperationException`, so the rest of the Kotlin module still
 * compiles + Gradle assembleDebug succeeds.
 */
package gg.solidarity.semaphore

import java.lang.reflect.Method

internal object NativeBridge {

  // ──────────────────────────────────────────────────────────────────────────
  // High-level entry points — every native method goes through reflection so
  // the module still builds without the uniffi-generated Kotlin in place.
  // The reflection cache is populated lazily; once warm the cost is a single
  // hash-lookup per call.
  // ──────────────────────────────────────────────────────────────────────────

  fun commitment(privateKey: ByteArray): String {
    val identityClass = loadClass("uniffi.semaphore_bindings.Identity")
    val ctor = identityClass.getDeclaredConstructor(ByteArray::class.java)
    val identity = ctor.newInstance(privateKey)
    val method = identityClass.getMethod("commitment")
    return method.invoke(identity) as String
  }

  fun groupRoot(members: List<ByteArray>): ByteArray {
    val groupClass = loadClass("uniffi.semaphore_bindings.Group")
    val ctor = groupClass.getDeclaredConstructor(List::class.java)
    val group = ctor.newInstance(members)
    val method = groupClass.getMethod("root")
    val result = method.invoke(group) as ByteArray?
    return result ?: throw IllegalStateException("Group::root returned null")
  }

  fun generateProof(
    privateKey: ByteArray,
    members: List<ByteArray>,
    message: String,
    scope: String,
    merkleTreeDepth: Int,
  ): String {
    val identityClass = loadClass("uniffi.semaphore_bindings.Identity")
    val groupClass = loadClass("uniffi.semaphore_bindings.Group")
    val identity = identityClass.getDeclaredConstructor(ByteArray::class.java)
      .newInstance(privateKey)
    val group = groupClass.getDeclaredConstructor(List::class.java)
      .newInstance(members)
    val pkgClass = loadClass("uniffi.semaphore_bindings.Semaphore_bindingsKt")
    val method: Method = pkgClass.getDeclaredMethod(
      "generateSemaphoreProof",
      identityClass,
      groupClass,
      String::class.java,
      String::class.java,
      java.lang.Short.TYPE,
    )
    return method.invoke(null, identity, group, message, scope, merkleTreeDepth.toShort()) as String
  }

  fun verifyProof(proofJson: String): Boolean {
    val pkgClass = loadClass("uniffi.semaphore_bindings.Semaphore_bindingsKt")
    val method = pkgClass.getDeclaredMethod("verifySemaphoreProof", String::class.java)
    return method.invoke(null, proofJson) as Boolean
  }

  private fun loadClass(fqcn: String): Class<*> {
    return try {
      Class.forName(fqcn)
    } catch (cause: ClassNotFoundException) {
      throw UnsupportedOperationException(
        "uniffi-generated class `$fqcn` not present. " +
          "Run `bash nitro-modules/semaphore/rust/build-android.sh` to regenerate the Kotlin bindings " +
          "and JNI .so files.",
        cause,
      )
    }
  }
}
