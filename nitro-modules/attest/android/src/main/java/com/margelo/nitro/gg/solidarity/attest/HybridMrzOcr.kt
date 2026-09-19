/*
 * HybridMrzOcr.kt
 * @solidarity/nitro-mrz-ocr (Android)
 *
 * Android-side implementation of the MrzOcr HybridObject. Notes on the
 * choices that diverge from the iOS sibling:
 *   - Downcast HybridFrameSpec -> NativeFrame to reach the CameraX
 *     ImageProxy and its underlying android.media.Image.
 *   - Recognizer is held as a field; TextRecognition.getClient(...) is
 *     expensive and the bundled Latin model is safe to reuse across frames.
 *   - Tasks.await(...) bridges ML Kit's Task<Text> to the synchronous
 *     scanFrame contract; coroutines would break the worklet's expectation
 *     of an immediate return value.
 *   - Lines are sorted ascending by boundingBox.top — Android's coordinate
 *     origin is top-left, opposite of iOS Vision's normalised bottom-left.
 */
package com.margelo.nitro.gg.solidarity.attest

import android.util.Log
import androidx.annotation.OptIn
import androidx.annotation.Keep
import androidx.camera.core.ExperimentalGetImage
import com.facebook.proguard.annotations.DoNotStrip
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.Locale
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean

@Keep
@DoNotStrip
class HybridMrzOcr : HybridMrzOcrSpec() {
  private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

  /**
   * Set while ML Kit is mid-call; the JS-side worklet sees
   * the empty MrzScanResult and skips the frame instead of stacking
   * another `Tasks.await` on top. Without this guard a transient ML
   * Kit spike (the kind that causes the 600ms timeout we just
   * dropped) backs up the entire frame pipeline because every queued
   * frame waits the full timeout in series. Drop, retry, move on.
   */
  private val inFlight = AtomicBoolean(false)

  @OptIn(ExperimentalGetImage::class)
  override fun scanFrame(frame: com.margelo.nitro.camera.HybridFrameSpec): MrzScanResult {
    val native = frame as? com.margelo.nitro.camera.public.NativeFrame
      ?: throw RuntimeException("Frame is not a NativeFrame — was it dispatched from a different pipeline?")

    val imageProxy = native.image
    val mediaImage = imageProxy.image
      ?: throw RuntimeException("Frame.image has no underlying android.media.Image (was it disposed?)")

    val frameWidth = imageProxy.width.toDouble()
    val frameHeight = imageProxy.height.toDouble()
    val rotation = imageProxy.imageInfo.rotationDegrees

    // Drop this frame if a previous OCR call hasn't returned yet.
    // Keeps the camera pipeline responsive and avoids stacking 2s
    // timeouts (now 600ms) in series during ML Kit hiccups.
    if (!inFlight.compareAndSet(false, true)) {
      return emptyResult(frameWidth, frameHeight)
    }

    val started = System.currentTimeMillis()

    // Recogniser dispatch. ML Kit is the Android live-camera path; it
    // is bundled in the app and handles image rotation from the CameraX
    // metadata passed through InputImage.
    val sortedTexts: Array<String>
    val minConfidence: Double
    try {
      val inputImage = InputImage.fromMediaImage(mediaImage, rotation)
      val result = try {
        Tasks.await(recognizer.process(inputImage), OCR_TIMEOUT_MS, TimeUnit.MILLISECONDS)
      } catch (e: TimeoutException) {
        Log.w(TAG, "scanFrame: ML Kit timed out after ${OCR_TIMEOUT_MS}ms — dropping frame")
        return emptyResult(frameWidth, frameHeight)
      } catch (e: ExecutionException) {
        throw RuntimeException("MRZ OCR failed: ${e::class.simpleName}")
      } catch (e: InterruptedException) {
        Thread.currentThread().interrupt()
        throw RuntimeException("MRZ OCR failed: ${e::class.simpleName}")
      }
      if (result.textBlocks.isEmpty()) {
        return emptyResult(frameWidth, frameHeight)
      }
      val orderedLines = result.textBlocks
        .flatMap { it.lines }
        .sortedBy { it.boundingBox?.top ?: Int.MAX_VALUE }
      val confidences = orderedLines.mapNotNull { it.confidence?.toDouble() }
      sortedTexts = orderedLines.map { it.text }.toTypedArray()
      minConfidence = confidences.minOrNull() ?: 0.0
    } finally {
      inFlight.set(false)
    }

    val scan = scanTd3(sortedTexts)
    Log.d(
      TAG,
      "scanFrame[mlkit]: ${sortedTexts.size} lines / ${scan.candidateCount} candidates / " +
        "draft=${if (scan.draft == null) "no" else "yes"} in ${System.currentTimeMillis() - started}ms " +
        "(frame ${frameWidth.toInt()}x${frameHeight.toInt()}, rotation=$rotation, minConf=${"%.2f".format(minConfidence)})"
    )

    return MrzScanResult(
      draft = scan.draft,
      candidateCount = scan.candidateCount.toDouble(),
      confidence = minConfidence,
      frameWidth = frameWidth,
      frameHeight = frameHeight
    )
  }

  private data class Td3Scan(
    val draft: PassportMrzDraft?,
    val candidateCount: Int,
  )

  private fun emptyResult(frameWidth: Double, frameHeight: Double): MrzScanResult {
    return MrzScanResult(
      draft = null,
      candidateCount = 0.0,
      confidence = 0.0,
      frameWidth = frameWidth,
      frameHeight = frameHeight,
    )
  }

  private fun scanTd3(lines: Array<String>): Td3Scan {
    val candidates = lines
      .map(::normaliseMrzLine)
      .filter(::isMrzCandidate)

    if (candidates.size < 2) return Td3Scan(null, candidates.size)

    val head = candidates
      .sortedByDescending { it.length }
      .take(4)

    for (i in head.indices) {
      for (j in (i + 1) until head.size) {
        val a = canonicalTd3Row(head[i])
        val b = canonicalTd3Row(head[j])
        val draft = parseTd3(a, b) ?: parseTd3(b, a)
        if (draft != null) return Td3Scan(draft, candidates.size)
      }
    }

    return Td3Scan(null, candidates.size)
  }

  private fun normaliseMrzLine(line: String): String {
    return line.uppercase(Locale.US).replace(WHITESPACE_RE, "<")
  }

  private fun isMrzCandidate(line: String): Boolean {
    return line.length in 20..50 && line.all { ch ->
      ch == '<' || ch in 'A'..'Z' || ch in '0'..'9'
    }
  }

  private fun canonicalTd3Row(line: String): String {
    return when {
      line.length > TD3_ROW_LEN -> line.take(TD3_ROW_LEN)
      line.length < TD3_ROW_LEN -> line.padEnd(TD3_ROW_LEN, '<')
      else -> line
    }
  }

  private fun parseTd3(line1: String, line2: String): PassportMrzDraft? {
    if (line1.length != TD3_ROW_LEN || line2.length != TD3_ROW_LEN || !line1.startsWith("P")) {
      return null
    }

    val documentField = line2.substring(0, 9)
    val documentCheckDigit = line2[9].digitToIntOrNull() ?: return null
    if (!verifyCheckDigit(documentField, documentCheckDigit)) return null

    val nationality = line2.substring(10, 13).replace("<", "")
    val birthDate = line2.substring(13, 19)
    val birthCheckDigit = line2[19].digitToIntOrNull() ?: return null
    if (!verifyCheckDigit(birthDate, birthCheckDigit) || !isValidDate(birthDate)) return null

    val expiryDate = line2.substring(21, 27)
    val expiryCheckDigit = line2[27].digitToIntOrNull() ?: return null
    if (!verifyCheckDigit(expiryDate, expiryCheckDigit) || !isValidDate(expiryDate)) return null

    return PassportMrzDraft(
      passportNumber = documentField.replace("<", ""),
      nationalityCode = nationality,
      dateOfBirth = birthDate,
      expiryDate = expiryDate,
    )
  }

  private fun verifyCheckDigit(field: String, expected: Int): Boolean {
    return computeCheckDigit(field) == expected
  }

  private fun computeCheckDigit(field: String): Int {
    var sum = 0
    for ((index, ch) in field.withIndex()) {
      sum += mrzCharValue(ch) * MRZ_WEIGHTS[index % MRZ_WEIGHTS.size]
    }
    return sum % 10
  }

  private fun mrzCharValue(ch: Char): Int {
    return when (ch) {
      '<' -> 0
      in '0'..'9' -> ch.code - '0'.code
      in 'A'..'Z' -> ch.code - 'A'.code + 10
      else -> 0
    }
  }

  private fun isValidDate(yymmdd: String): Boolean {
    if (yymmdd.length != 6 || !yymmdd.all { it in '0'..'9' }) return false
    val month = yymmdd.substring(2, 4).toIntOrNull() ?: return false
    val day = yymmdd.substring(4, 6).toIntOrNull() ?: return false
    if (month !in 1..12) return false
    val maxDay = when (month) {
      2 -> 29
      4, 6, 9, 11 -> 30
      else -> 31
    }
    return day in 1..maxDay
  }

  companion object {
    private const val TAG = "HybridMrzOcr"
    private const val TD3_ROW_LEN = 44
    private val WHITESPACE_RE = Regex("\\s+")
    private val MRZ_WEIGHTS = intArrayOf(7, 3, 1)
    /**
     * Wall-clock budget for a single ML Kit `process()` call. Tight on
     * purpose — typical per-frame cost on the user's S20 FE after the
     * crop is ~50ms, so 600ms only fires when the model spikes (cold
     * start, thermal throttle, GMS update). Old 2s budget caused the
     * whole pipeline to stall for two seconds on the rare hiccup and
     * masked the underlying problem; now we drop the frame and the
     * next one gets a fresh shot in ~33ms.
     */
    private const val OCR_TIMEOUT_MS = 600L
  }
}
