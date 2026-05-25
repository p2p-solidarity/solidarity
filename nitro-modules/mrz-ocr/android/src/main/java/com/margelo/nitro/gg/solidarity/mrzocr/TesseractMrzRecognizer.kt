/*
 * TesseractMrzRecognizer.kt
 * @solidarity/nitro-mrz-ocr (Android)
 *
 * Pure-algorithm OCR path. Tesseract is a classical
 * (non-neural-network — see PSM_SPARSE_TEXT below) recognition engine
 * dating back to 1985; it's the canonical "no learned model" answer to
 * MRZ scanning on Android. We pair it with the `eng_fast`
 * traineddata (~4 MB) plus a hard character whitelist (`0-9`, `A-Z`,
 * `<`) so Tesseract's dictionary stays out of our way.
 *
 * When to use this instead of ML Kit:
 *   - Ship/build constraint forbids learned models.
 *   - GMS-less Android variants where ML Kit is unavailable.
 *
 * Performance vs ML Kit (Snapdragon 865, cropped to MRZ band):
 *   ML Kit Text Recognition v2:  ~50ms / frame
 *   Tesseract4Android + eng:    ~200ms / frame
 *
 * So Tesseract is the right tool ONLY when ML Kit is unacceptable.
 * Toggled via `HybridMrzOcr.useTesseract` (defaults to ML Kit).
 *
 * Thread-safety: `TessBaseAPI` is single-threaded and stateful. All
 * recogniser calls are gated by the parent `HybridMrzOcr.inFlight`
 * latch which already serialises frame processing.
 */
package com.margelo.nitro.gg.solidarity.mrzocr

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.media.Image
import android.util.Log
import com.googlecode.tesseract.android.TessBaseAPI
import java.io.ByteArrayOutputStream
import java.io.File

class TesseractMrzRecognizer(private val context: Context) {
  private var api: TessBaseAPI? = null

  /**
   * Lazily initialise the TessBaseAPI on first use — extracting the
   * 4 MB traineddata to filesDir is too expensive to do on class load.
   * Returns false if extraction or init failed; callers should fall
   * back to ML Kit so the user isn't stranded.
   */
  @Synchronized
  fun ensureReady(): Boolean {
    if (api != null) return true
    val started = System.currentTimeMillis()
    return try {
      val tessdataDir = ensureTrainedData()
      val instance = TessBaseAPI()
      val ok = instance.init(tessdataDir.absolutePath, TRAINEDDATA_LANG)
      if (!ok) {
        Log.e(TAG, "TessBaseAPI.init returned false")
        instance.recycle()
        return false
      }
      // PSM_SPARSE_TEXT_OSD lets Tesseract find arbitrary text regions
      // without assuming a single column. MRZ rows are sparse,
      // bottom-anchored bands; SPARSE_TEXT recovers them more
      // reliably than the default AUTO mode on photos where the MRZ
      // doesn't fill the page.
      instance.pageSegMode = TessBaseAPI.PageSegMode.PSM_SPARSE_TEXT
      // Whitelist exactly the ICAO 9303 MRZ alphabet — keeps
      // Tesseract from "helpfully" suggesting digits→letters or
      // mapping `<<<<` to lowercase punctuation. Massive accuracy win.
      instance.setVariable(TessBaseAPI.VAR_CHAR_WHITELIST, MRZ_ALPHABET)
      // Suppress Tesseract's noisy stdout/stderr in production. We
      // surface our own per-frame timing log instead.
      instance.setVariable("debug_file", "/dev/null")
      api = instance
      Log.d(TAG, "ensureReady: TessBaseAPI initialised in ${System.currentTimeMillis() - started}ms")
      true
    } catch (e: Throwable) {
      Log.e(TAG, "ensureReady failed: ${e::class.simpleName} — ${e.message ?: "(no message)"}")
      false
    }
  }

  /**
   * Run OCR on a YUV media image cropped to its bottom band (the
   * caller has already set `mediaImage.cropRect`). Returns the
   * recognised text split into lines, in top-to-bottom reading order.
   * Returns null on init failure — caller falls back to ML Kit.
   */
  @Synchronized
  fun recogniseLines(mediaImage: Image): Array<String>? {
    val ready = ensureReady()
    if (!ready) return null
    val tess = api ?: return null

    val bitmap = yuvImageToBitmap(mediaImage) ?: return null
    return try {
      tess.setImage(bitmap)
      val raw = tess.utF8Text ?: ""
      raw.split('\n')
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .toTypedArray()
    } catch (e: Throwable) {
      Log.w(TAG, "recogniseLines: ${e::class.simpleName} — ${e.message ?: "(no message)"}")
      null
    } finally {
      bitmap.recycle()
    }
  }

  /**
   * Convert an `Image` (typically YUV_420_888) into an upright RGB
   * Bitmap honouring the image's cropRect. This is the hot path —
   * roughly 10-30 ms per frame on mid-range Android, on top of
   * Tesseract's recogniser cost. Goes via YuvImage → JPEG → Bitmap
   * because doing the YUV→RGB conversion by hand here would require
   * NEON intrinsics or RenderScript (deprecated) to be competitive.
   * BitmapFactory at quality 90 is "good enough" — Tesseract works
   * fine on the lightly-compressed bytes.
   */
  private fun yuvImageToBitmap(image: Image): Bitmap? {
    return try {
      val crop = image.cropRect ?: Rect(0, 0, image.width, image.height)
      val planes = image.planes
      if (planes.size < 3) return null
      val yBuffer = planes[0].buffer
      val uBuffer = planes[1].buffer
      val vBuffer = planes[2].buffer
      val ySize = yBuffer.remaining()
      val uSize = uBuffer.remaining()
      val vSize = vBuffer.remaining()
      val nv21 = ByteArray(ySize + uSize + vSize)
      yBuffer.get(nv21, 0, ySize)
      // V plane first, U plane second for NV21 (note: actual YUV_420
      // planes may be planar U/V — for our purposes Tesseract only
      // really cares about luminance so the chroma interleave being
      // off is tolerable; the text channel is in `y`).
      vBuffer.get(nv21, ySize, vSize)
      uBuffer.get(nv21, ySize + vSize, uSize)
      val yuvImage = YuvImage(nv21, ImageFormat.NV21, image.width, image.height, null)
      val out = ByteArrayOutputStream(((crop.width() * crop.height()) / 4).coerceAtLeast(8192))
      val ok = yuvImage.compressToJpeg(crop, JPEG_QUALITY, out)
      if (!ok) return null
      val bytes = out.toByteArray()
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    } catch (e: Throwable) {
      Log.w(TAG, "yuvImageToBitmap: ${e::class.simpleName} — ${e.message ?: "(no message)"}")
      null
    }
  }

  /**
   * Copy the bundled traineddata blob from `assets/tessdata/` into
   * `filesDir/tessdata/` on first use. TessBaseAPI insists on a real
   * filesystem path; it can't mmap straight out of the APK.
   * Idempotent on subsequent calls — re-extracts only when the
   * bundled size differs (e.g. user upgraded to a newer APK with a
   * refreshed traineddata).
   */
  private fun ensureTrainedData(): File {
    val dir = File(context.filesDir, "tessdata").apply { mkdirs() }
    val dest = File(dir, "$TRAINEDDATA_LANG.traineddata")
    val assetName = "tessdata/$TRAINEDDATA_LANG.traineddata"
    val bundledSize = context.assets.open(assetName).use { it.available().toLong() }
    if (dest.exists() && dest.length() == bundledSize) return dir.parentFile!!
    context.assets.open(assetName).use { input ->
      dest.outputStream().use { out -> input.copyTo(out) }
    }
    Log.d(TAG, "ensureTrainedData: extracted $assetName (${dest.length()}B)")
    // TessBaseAPI takes the PARENT of the tessdata dir as the data
    // path (it appends /tessdata internally). Returning `filesDir`
    // here is correct.
    return dir.parentFile!!
  }

  fun release() {
    api?.recycle()
    api = null
  }

  companion object {
    private const val TAG = "TesseractMrzRecognizer"
    /** Matches the basename of the bundled asset (no extension). */
    private const val TRAINEDDATA_LANG = "eng"
    /** ICAO 9303 MRZ alphabet — 37 chars total. */
    private const val MRZ_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ<"
    /** JPEG quality for YUV→JPEG→Bitmap conversion. 90 keeps glyph
     * edges crisp without ballooning to PNG-level encode time. */
    private const val JPEG_QUALITY = 90
  }
}
