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

class HybridMrzOcr : HybridMrzOcrSpec() {
  private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

  @OptIn(ExperimentalGetImage::class)
  override fun scanFrame(frame: com.margelo.nitro.camera.HybridFrameSpec): RecognizedLines {
    val native = frame as? com.margelo.nitro.camera.public.NativeFrame
      ?: throw RuntimeException("Frame is not a NativeFrame — was it dispatched from a different pipeline?")

    val imageProxy = native.image
    val mediaImage = imageProxy.image
      ?: throw RuntimeException("Frame.image has no underlying android.media.Image (was it disposed?)")

    val frameWidth = imageProxy.width.toDouble()
    val frameHeight = imageProxy.height.toDouble()

    val inputImage = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)

    val started = System.currentTimeMillis()
    val result = try {
      Tasks.await(recognizer.process(inputImage), OCR_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    } catch (e: TimeoutException) {
      throw RuntimeException("MRZ OCR timed out / failed: ${e::class.simpleName}")
    } catch (e: ExecutionException) {
      throw RuntimeException("MRZ OCR timed out / failed: ${e::class.simpleName}")
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
      throw RuntimeException("MRZ OCR timed out / failed: ${e::class.simpleName}")
    }

    if (result.textBlocks.isEmpty()) {
      return RecognizedLines(emptyArray(), 0.0, frameWidth, frameHeight)
    }

    val orderedLines = result.textBlocks
      .flatMap { it.lines }
      .sortedBy { it.boundingBox?.top ?: Int.MAX_VALUE }

    val confidences = orderedLines.mapNotNull { it.confidence?.toDouble() }
    val minConfidence = confidences.minOrNull() ?: 0.0

    val sortedTexts = orderedLines.map { it.text }.toTypedArray()

    Log.d(
      TAG,
      "scanFrame: ${sortedTexts.size} lines in ${System.currentTimeMillis() - started}ms " +
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
    private const val OCR_TIMEOUT_SECONDS = 2L
  }
}
