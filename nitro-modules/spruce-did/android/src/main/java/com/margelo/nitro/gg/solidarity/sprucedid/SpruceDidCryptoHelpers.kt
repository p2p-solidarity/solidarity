/*
 * SpruceDidCryptoHelpers.kt
 * @solidarity/nitro-spruce-did (Android)
 *
 * Crypto + encoding helpers extracted from HybridSpruceDid.kt to keep the
 * Hybrid class under the 500-line CLAUDE.md ceiling. Pure functions: no
 * state, no Keystore access.
 *
 * Mirrors `nitro-modules/spruce-did/ios/SpruceDidCryptoHelpers.swift` so
 * any wire-format changes land in both files together.
 */
package com.margelo.nitro.gg.solidarity.sprucedid

import android.util.Base64
import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec

internal object SpruceDidBase64 {
  fun urlEncode(bytes: ByteArray): String =
    Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

  fun urlDecode(s: String): ByteArray =
    Base64.decode(s, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}

internal object SpruceDidJwk {
  /**
   * Encode an ECPublicKey to a P-256 / ES256 JWK JSON string. Byte order
   * matches Apple's SecKey x963 representation: 0x04 || X(32) || Y(32), so
   * DIDs derived from this JWK round-trip with the iOS implementation.
   */
  fun p256JwkJson(pub: ECPublicKey): String {
    val x = bigIntToFixedWidth(pub.w.affineX, 32)
    val y = bigIntToFixedWidth(pub.w.affineY, 32)
    val xB64 = SpruceDidBase64.urlEncode(x)
    val yB64 = SpruceDidBase64.urlEncode(y)
    return """{"alg":"ES256","crv":"P-256","kty":"EC","x":"$xB64","y":"$yB64"}"""
  }

  /**
   * Re-hydrate an ECPublicKey from a JWK JSON string. Uses regex extraction
   * (vs a full JSON parser) because the JWK shape is tightly constrained:
   * we only need `x` and `y`, both URL-safe-base64 strings.
   */
  fun ecPublicKeyFromJwkJson(jwkJson: String): ECPublicKey {
    val xMatch = Regex(""""x"\s*:\s*"([A-Za-z0-9_-]+)"""").find(jwkJson)
    val yMatch = Regex(""""y"\s*:\s*"([A-Za-z0-9_-]+)"""").find(jwkJson)
    val xB64 = xMatch?.groupValues?.getOrNull(1)
      ?: throw IllegalArgumentException("JWK missing x")
    val yB64 = yMatch?.groupValues?.getOrNull(1)
      ?: throw IllegalArgumentException("JWK missing y")
    val x = SpruceDidBase64.urlDecode(xB64)
    val y = SpruceDidBase64.urlDecode(yB64)
    require(x.size == 32 && y.size == 32) { "JWK x/y must be 32 bytes each" }

    val params = ECPoint(BigInteger(1, x), BigInteger(1, y))
    val keyFactory = KeyFactory.getInstance("EC")
    val parameters = AlgorithmParameters.getInstance("EC")
    parameters.init(ECGenParameterSpec("secp256r1"))
    val ecSpec = parameters.getParameterSpec(ECParameterSpec::class.java)
    val pubSpec = ECPublicKeySpec(params, ecSpec)
    return keyFactory.generatePublic(pubSpec) as ECPublicKey
  }

  /**
   * Pad/strip a Java `BigInteger` to a fixed-width unsigned byte array.
   * BigInteger may emit a leading 0x00 sign byte for two's-complement
   * representation; we strip it then left-pad to `width` bytes.
   */
  private fun bigIntToFixedWidth(value: BigInteger, width: Int): ByteArray {
    val raw = value.toByteArray()
    val stripped = if (raw.size > width && raw[0] == 0.toByte()) {
      raw.copyOfRange(1, raw.size)
    } else raw
    if (stripped.size == width) return stripped
    val out = ByteArray(width)
    System.arraycopy(stripped, 0, out, width - stripped.size, stripped.size)
    return out
  }
}

/**
 * JWS ES256 uses raw 64-byte r||s while the JCA Signature API speaks DER
 * SEQUENCE { INTEGER r, INTEGER s }. We translate at the boundary so the
 * wire format matches the iOS implementation.
 */
internal object SpruceDidEcdsa {
  fun derToRaw(der: ByteArray): ByteArray {
    var i = 0
    require(der.size >= 8 && der[0] == 0x30.toByte()) { "DER: missing SEQUENCE" }
    i += 2 // skip SEQUENCE tag + length
    require(der[i] == 0x02.toByte()) { "DER: missing INTEGER (r)" }
    i += 1
    val rLen = der[i].toInt() and 0xFF
    i += 1
    var r = der.copyOfRange(i, i + rLen)
    i += rLen
    require(der[i] == 0x02.toByte()) { "DER: missing INTEGER (s)" }
    i += 1
    val sLen = der[i].toInt() and 0xFF
    i += 1
    var s = der.copyOfRange(i, i + sLen)

    // Strip leading 0x00 sign byte.
    if (r.isNotEmpty() && r[0] == 0x00.toByte() && r.size == 33) r = r.copyOfRange(1, r.size)
    if (s.isNotEmpty() && s[0] == 0x00.toByte() && s.size == 33) s = s.copyOfRange(1, s.size)
    if (r.size < 32) r = ByteArray(32 - r.size) + r
    if (s.size < 32) s = ByteArray(32 - s.size) + s
    require(r.size == 32 && s.size == 32) {
      "DER decode: r/s length mismatch (${r.size},${s.size})"
    }
    return r + s
  }

  fun rawToDer(raw: ByteArray): ByteArray {
    require(raw.size == 64) { "raw ECDSA must be 64 bytes" }
    val r = raw.copyOfRange(0, 32)
    val s = raw.copyOfRange(32, 64)
    val rDer = encodeDerInteger(r)
    val sDer = encodeDerInteger(s)
    val body = rDer + sDer
    return byteArrayOf(0x30, body.size.toByte()) + body
  }

  private fun encodeDerInteger(bytes: ByteArray): ByteArray {
    // Strip leading zeros except keep one if MSB is set (so the integer
    // stays positive in DER's two's complement representation).
    var trimmed = bytes
    var i = 0
    while (i < trimmed.size - 1 && trimmed[i] == 0x00.toByte()) i++
    trimmed = trimmed.copyOfRange(i, trimmed.size)
    if (trimmed[0].toInt() and 0x80 != 0) {
      trimmed = byteArrayOf(0x00) + trimmed
    }
    return byteArrayOf(0x02, trimmed.size.toByte()) + trimmed
  }
}

// SpruceSdkBridge (reflective access to com.spruceid.mobile.sdk.rs.*) was
// removed in 1.3.3 S7a together with its 5 caller methods and the Maven
// dependency — DID derivation + JWS/VC verification are pure TS in
// packages/shared. Inventory: docs/ref/notes-sprucekit-slim.md.
