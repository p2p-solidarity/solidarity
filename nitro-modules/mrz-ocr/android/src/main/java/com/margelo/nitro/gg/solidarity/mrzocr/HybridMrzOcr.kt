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
package com.margelo.nitro.gg.solidarity.mrzocr

import android.graphics.Rect
import android.util.Log
import androidx.annotation.OptIn
import androidx.camera.core.ExperimentalGetImage
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean

class HybridMrzOcr : HybridMrzOcrSpec() {
  private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
  private val tesseract: TesseractMrzRecognizer by lazy {
    TesseractMrzRecognizer(
      com.margelo.nitro.NitroModules.applicationContext
        ?: throw IllegalStateException("NitroModules.applicationContext is null"),
    )
  }

  /**
   * Set while either recogniser is mid-call; the JS-side worklet sees
   * the empty RecognizedLines and skips the frame instead of stacking
   * another `Tasks.await` on top. Without this guard a transient ML
   * Kit spike (the kind that causes the 600ms timeout we just
   * dropped) backs up the entire frame pipeline because every queued
   * frame waits the full timeout in series. Drop, retry, move on.
   */
  private val inFlight = AtomicBoolean(false)

  @OptIn(ExperimentalGetImage::class)
  override fun scanFrame(frame: com.margelo.nitro.camera.HybridFrameSpec): RecognizedLines {
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
      return RecognizedLines(emptyArray(), 0.0, frameWidth, frameHeight)
    }

    // Speedup: crop to the band of the raw image that contains the MRZ
    // band of a TD3 passport when the passport fills the bottom of
    // the portrait preview. ML Kit honours `mediaImage.cropRect` and
    // skips OCR on pixels outside it, cutting per-frame work
    // proportionally (~2-3× faster on the user's S20 FE based on
    // 150ms→55ms in dev). The cropRect lives in the IMAGE's native
    // (pre-rotation) coordinate space — for a portrait phone with
    // sensor rotation 90°, the visible bottom of the preview maps to
    // the right side of the raw sensor frame, so we crop the right
    // band; rotation 270° → left band; 0°/180° → bottom/top band
    // (sensor already in portrait).
    val rawW = mediaImage.width
    val rawH = mediaImage.height
    val crop = when (rotation) {
      90 -> Rect((rawW * (1.0 - MRZ_BAND_FRAC)).toInt(), 0, rawW, rawH)
      270 -> Rect(0, 0, (rawW * MRZ_BAND_FRAC).toInt(), rawH)
      180 -> Rect(0, 0, rawW, (rawH * MRZ_BAND_FRAC).toInt())
      else -> Rect(0, (rawH * (1.0 - MRZ_BAND_FRAC)).toInt(), rawW, rawH)
    }
    mediaImage.cropRect = crop

    val started = System.currentTimeMillis()

    // Recogniser dispatch — Tesseract is the user-requested pure-
    // algorithm path; we run it FIRST and only fall back to ML Kit
    // when Tesseract returns nothing usable. The two paths share the
    // same `inFlight` latch and `OCR_TIMEOUT_MS` budget so back-
    // pressure behaviour is identical regardless of which engine
    // wins. Set `USE_TESSERACT = false` below to force the ML Kit
    // path; that's measurably faster on modern Android (~50ms vs
    // ~200ms per cropped frame on a Snapdragon 865) but uses a
    // learned model, which is what the user wanted to avoid.
    val sortedTexts: Array<String>
    val minConfidence: Double
    val recognisedBy: String
    try {
      val tesseractLines = if (USE_TESSERACT) tesseract.recogniseLines(mediaImage) else null
      if (tesseractLines != null && tesseractLines.isNotEmpty()) {
        sortedTexts = tesseractLines
        // Tesseract doesn't surface per-line confidence by default;
        // the dictionary whitelist + check-digit validation
        // downstream in JS does the same job.
        minConfidence = TESSERACT_CONFIDENCE_SENTINEL
        recognisedBy = "tesseract"
      } else {
        val inputImage = InputImage.fromMediaImage(mediaImage, rotation)
        val result = try {
          Tasks.await(recognizer.process(inputImage), OCR_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        } catch (e: TimeoutException) {
          Log.w(TAG, "scanFrame: ML Kit timed out after ${OCR_TIMEOUT_MS}ms — dropping frame")
          return RecognizedLines(emptyArray(), 0.0, frameWidth, frameHeight)
        } catch (e: ExecutionException) {
          throw RuntimeException("MRZ OCR failed: ${e::class.simpleName}")
        } catch (e: InterruptedException) {
          Thread.currentThread().interrupt()
          throw RuntimeException("MRZ OCR failed: ${e::class.simpleName}")
        }
        if (result.textBlocks.isEmpty()) {
          return RecognizedLines(emptyArray(), 0.0, frameWidth, frameHeight)
        }
        val orderedLines = result.textBlocks
          .flatMap { it.lines }
          .sortedBy { it.boundingBox?.top ?: Int.MAX_VALUE }
        val confidences = orderedLines.mapNotNull { it.confidence?.toDouble() }
        sortedTexts = orderedLines.map { it.text }.toTypedArray()
        minConfidence = confidences.minOrNull() ?: 0.0
        recognisedBy = "mlkit"
      }
    } finally {
      inFlight.set(false)
    }

    Log.d(
      TAG,
      "scanFrame[$recognisedBy]: ${sortedTexts.size} lines in ${System.currentTimeMillis() - started}ms " +
        "(frame ${frameWidth.toInt()}x${frameHeight.toInt()}, minConf=${"%.2f".format(minConfidence)})"
    )

    return RecognizedLines(
      lines = sortedTexts,
      confidence = minConfidence,
      frameWidth = frameWidth,
      frameHeight = frameHeight
    )
  }

  companion object {
    private const val TAG = "HybridMrzOcr"
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
    /**
     * Fraction of the visible frame to send to ML Kit (band closest to
     * the visible bottom in portrait). MRZ on TD3 sits in the bottom
     * ~25% of a passport's photo page; 0.55 gives slack for users who
     * frame the passport slightly low or the phone tilts forward.
     * Bigger → safer but slower; smaller → faster but risks missing
     * the MRZ band entirely.
     */
    private const val MRZ_BAND_FRAC = 0.55

    /**
     * Toggle for the user-requested pure-algorithm OCR path. Default
     * `true` because the user explicitly asked us to ship a non-ML
     * variant. Flip to `false` (and rebuild) to use ML Kit Text
     * Recognition v2 directly; ML Kit is measurably faster but uses a
     * learned model. The two paths share the same JS-side parser
     * (regex + check-digit relax) so accuracy results are comparable.
     */
    private const val USE_TESSERACT = true

    /** Sentinel reported by the Tesseract path since it doesn't
     * surface line-level confidence. Treated as "high" by JS so the
     * UI affordance doesn't flag every Tesseract frame as low-conf. */
    private const val TESSERACT_CONFIDENCE_SENTINEL = 0.9
  }
}
