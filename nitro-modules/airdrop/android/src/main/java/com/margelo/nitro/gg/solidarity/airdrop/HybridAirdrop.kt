/*
 * HybridAirdrop.kt
 * @solidarity/nitro-airdrop (Android)
 *
 * AirDrop is an iOS-only feature — Apple ships no Android counterpart.
 * Per Nitro best practice we still expose the module on both platforms so
 * the JS surface stays consistent; the Android impl is a clean stub:
 *
 *   - isAvailable() returns false so callers can branch on capability
 *     without trying to invoke share().
 *   - share() rejects with a structured "iOS-only" error so a caller that
 *     ignores isAvailable() still gets a clear, debuggable failure rather
 *     than a silent no-op.
 *
 * Callers that need an Android share path should branch on Platform.OS
 * and use `expo-sharing` (Intent.ACTION_SEND) instead.
 */
package com.margelo.nitro.gg.solidarity.airdrop

import com.margelo.nitro.core.Promise

class HybridAirdrop : HybridAirdropSpec() {

  override fun isAvailable(): Boolean = false

  override fun share(payload: AirdropPayload): Promise<AirdropResult> {
    // Param name must be `errorCode` to match the AirdropException ctor below;
    // earlier draft used `code` which fails Kotlin compile since no such param exists.
    return Promise.async {
      throw AirdropException(
        errorCode = "airdrop_ios_only",
        message = "AirDrop is an iOS-only feature. Use expo-sharing on Android.",
      )
    }
  }
}

/**
 * Typed exception so Promise rejections carry both a stable error code and a
 * human-readable message. Mirrors the iOS `error(code:message:)` helper —
 * the JS layer can switch on `(err as any).errorCode` to map to UX strings.
 */
class AirdropException(
  val errorCode: String,
  message: String,
) : RuntimeException("[$errorCode] $message")
