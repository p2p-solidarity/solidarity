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
 * `rust/build-android.sh` (which runs the local `uniffi-bindgen` binary
 * against the host-built dylib) and lands under
 * `android/src/main/java/uniffi/semaphore_bindings/`. We access those
 * generated classes via reflection so this file compiles even on a CI
 * host that hasn't run the cross-compile yet — at runtime
 * `requireNativeLib()` in `HybridSemaphore` only loads
 * `libsemaphore_bindings.so` when it's actually been bundled.
 *
 * Reflection notes
 *   • uniffi 0.28 maps Rust `u16` → Kotlin `UShort` (a `@JvmInline value
 *     class`), and the JVM erases the param type to `short`. Kotlin
 *     mangles the function name with a 7-char hash (`<name>-<HASH>`),
 *     so we resolve `generateSemaphoreProof` by scanning declared
 *     methods on the package class and matching the un-mangled prefix
 *     + the expected (un-erased) parameter shape.
 *   • Top-level functions in `semaphore_bindings.kt` live on the
 *     synthetic Kotlin file-class `uniffi.semaphore_bindings.Semaphore_bindingsKt`.
 */
package com.margelo.nitro.gg.solidarity.semaphore

import java.lang.reflect.Method

internal object NativeBridge {

  fun commitment(privateKey: ByteArray): String {
    val identity = newIdentity(privateKey)
    val method = identityClass().getMethod("commitment")
    return method.invoke(identity) as String
  }

  fun groupRoot(members: List<ByteArray>): ByteArray {
    val group = newGroup(members)
    val method = groupClass().getMethod("root")
    return (method.invoke(group) as ByteArray?)
      ?: throw IllegalStateException("Group::root returned null")
  }

  fun generateProof(
    privateKey: ByteArray,
    members: List<ByteArray>,
    message: String,
    scope: String,
    merkleTreeDepth: Int,
  ): String {
    val identity = newIdentity(privateKey)
    val group = newGroup(members)
    val pkgClass = loadClass("uniffi.semaphore_bindings.Semaphore_bindingsKt")
    val method = findFunction(
      pkgClass,
      unmangledName = "generateSemaphoreProof",
      paramTypes = arrayOf(
        identityClass(),
        groupClass(),
        String::class.java,
        String::class.java,
        java.lang.Short.TYPE,
      ),
    )
    // Kotlin name-mangles `fun(... UShort)` but the JVM signature carries
    // the underlying primitive `short`, so we hand reflection an unboxed
    // Short directly (no `kotlin.UShort` wrapper needed).
    val args: Array<Any?> = arrayOf(identity, group, message, scope, merkleTreeDepth.toShort())
    return method.invoke(null, *args) as String
  }

  fun verifyProof(proofJson: String): Boolean {
    val pkgClass = loadClass("uniffi.semaphore_bindings.Semaphore_bindingsKt")
    val method = findFunction(
      pkgClass,
      unmangledName = "verifySemaphoreProof",
      paramTypes = arrayOf(String::class.java),
    )
    return method.invoke(null, proofJson) as Boolean
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────────────────

  private fun identityClass(): Class<*> = loadClass("uniffi.semaphore_bindings.Identity")
  private fun groupClass(): Class<*> = loadClass("uniffi.semaphore_bindings.Group")

  private fun newIdentity(privateKey: ByteArray): Any {
    val ctor = identityClass().getDeclaredConstructor(ByteArray::class.java)
    return ctor.newInstance(privateKey)
  }

  private fun newGroup(members: List<ByteArray>): Any {
    val ctor = groupClass().getDeclaredConstructor(List::class.java)
    return ctor.newInstance(members)
  }

  private fun loadClass(fqcn: String): Class<*> = try {
    Class.forName(fqcn)
  } catch (cause: ClassNotFoundException) {
    throw UnsupportedOperationException(
      "uniffi-generated class `$fqcn` not present. " +
        "Run `bash nitro-modules/semaphore/rust/build-android.sh` to regenerate the Kotlin bindings " +
        "and JNI .so files.",
      cause,
    )
  }

  /**
   * Resolve a Kotlin top-level function on the file-class `pkgClass`.
   * Tries the exact name first (works when the function has no value-class
   * params), then falls back to scanning for `<name>-<HASH>` mangled names
   * (Kotlin compiler suffix for value-class parameters) that match the
   * requested parameter shape.
   */
  private fun findFunction(
    pkgClass: Class<*>,
    unmangledName: String,
    paramTypes: Array<Class<*>>,
  ): Method {
    runCatching { return pkgClass.getDeclaredMethod(unmangledName, *paramTypes) }
    val candidates = pkgClass.declaredMethods.filter { m ->
      val matchesName = m.name == unmangledName || m.name.startsWith("$unmangledName-")
      matchesName &&
        m.parameterTypes.size == paramTypes.size &&
        paramTypes.indices.all { i -> m.parameterTypes[i] == paramTypes[i] }
    }
    return candidates.firstOrNull() ?: throw NoSuchMethodException(
      "$unmangledName(${paramTypes.joinToString { it.simpleName }}) not found on ${pkgClass.name}",
    )
  }
}
