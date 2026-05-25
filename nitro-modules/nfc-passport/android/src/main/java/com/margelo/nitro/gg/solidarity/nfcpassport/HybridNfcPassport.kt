/*
 * HybridNfcPassport.kt
 * @solidarity/nitro-nfc-passport (Android)
 *
 * Wraps jmrtd (Java MRTD reader) behind the Nitrogen-generated
 * HybridNfcPassportSpec abstract base. Mirrors the iOS Swift impl
 * (HybridNfcPassport.swift / NFCPassportReaderService.swift) so a passport
 * read produces the same PassportReadResult shape on both platforms.
 *
 * Flow (matches the Swift surface):
 *   1. JS calls read({ documentNumber, dateOfBirth, dateOfExpiry })
 *   2. We attach NfcAdapter.enableReaderMode to the current Activity and
 *      wait — on a coroutine — for the first IsoDep tag.
 *   3. We open a jmrtd PassportService against that IsoDep, send the
 *      passport applet SELECT, then try PACE first (preferred per ICAO
 *      9303 since 2014) and fall back to BAC if PACE fails or isn't
 *      advertised.
 *   4. We read SOD / DG1 / DG2 / DG14 / DG15 via PassportService.
 *      getInputStream(...) and copy the raw bytes into ArrayBuffer slots
 *      so the JS layer can re-emit them to the ZK / VC pipeline.
 *   5. Parse DG1 → MRZInfo to populate ParsedMrz (nationality, name,
 *      gender, DOB, expiry). On parse failure we fall back to the input
 *      MRZ key so the caller always gets *something* coherent.
 *   6. Passive auth: load `masterList.pem` from this AAR's assets, parse
 *      out the CSCA root certs, build a trust anchor set, and ask jmrtd's
 *      SODFile + SignedDataUtil to verify the SOD chain + DG hashes.
 *      Mirrors `passportCorrectlySigned && passportDataNotTampered` in
 *      the AndyQ Swift library — gated on PACE-downgrade detection so a
 *      BAC-only session on a PACE-capable chip never reports
 *      passiveAuthValid=true.
 *   7. Build chipUid the same way as iOS:
 *        - `NFC-{documentNumber}` when the chip yielded a document number
 *        - `NFC-{sha256(rawMrzString)}` otherwise
 *
 * Threading:
 *   - Promise.async dispatches off the JS thread; we then use a private
 *     CoroutineScope on Dispatchers.IO for the blocking IsoDep transceive
 *     loop. The Activity-side enableReaderMode callback runs on a binder
 *     thread; we hand the tag to the suspending continuation via
 *     CompletableDeferred so the read coroutine stays linear.
 *
 * Security:
 *   - No `!!` / unchecked casts outside guarded checks.
 *   - We never log MRZ contents, document numbers, or DG bytes — only
 *     counters, status flags, and exception classnames.
 *   - User cancellation (tag never arrives) is surfaced with a distinct
 *     errorCode ("nfc_cancelled") so the JS pipeline can tell it apart
 *     from a tag dropped mid-read.
 *
 * Required permissions (caller's AndroidManifest — and apps/expo/app.json
 * already declares them):
 *   - android.permission.NFC               (install-time)
 *   - android.hardware.nfc (feature, optional)
 *
 * MissingPermission lint is suppressed on the NfcAdapter calls because
 * Android Studio's lint can't track the install-time NFC grant across
 * the JS→Nitro→Kotlin boundary.
 */
@file:Suppress("MissingPermission")

package com.margelo.nitro.gg.solidarity.nfcpassport

import android.app.Activity
import android.content.Context
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.IsoDep
import android.os.Bundle
import android.util.Log
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.TrustAnchor
import java.security.cert.X509Certificate
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import net.sf.scuba.smartcards.CardService
import org.jmrtd.BACKey
import org.jmrtd.PACEKeySpec
import org.jmrtd.PassportService
import org.jmrtd.lds.CardAccessFile
import org.jmrtd.lds.PACEInfo
import org.jmrtd.lds.SODFile
import org.jmrtd.lds.icao.DG1File
import org.jmrtd.lds.icao.MRZInfo

class HybridNfcPassport : HybridNfcPassportSpec() {

  // MARK: - Constants

  companion object {
    private const val TAG = "HybridNfcPassport"

    /** AAR-bundled CSCA Master List filename. Mirrors iOS `masterList.pem`. */
    private const val MASTER_LIST_ASSET = "masterList.pem"

    /** Default IsoDep transceive timeout — long enough for slow EAC1 chips. */
    private const val ISODEP_TIMEOUT_MS: Int = 15_000

    /**
     * NfcAdapter.enableReaderMode flags. We disable NDEF auto-dispatch
     * because we want full APDU control, and we disable platform sounds
     * since we drive our own haptic feedback on tag detect.
     */
    private const val READER_FLAGS: Int = (
      NfcAdapter.FLAG_READER_NFC_A
        or NfcAdapter.FLAG_READER_NFC_B
        or NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK
        or NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS
    )

    /** Max time we'll wait for a tag tap before surfacing nfc_cancelled. */
    private const val TAG_WAIT_TIMEOUT_MS: Long = 60_000
  }

  // MARK: - Coroutine scope

  /**
   * Long-lived scope tied to the HybridNfcPassport instance lifetime. The
   * blocking IsoDep transceive loop launches here so cancel()/JS tear-down
   * unblocks it cleanly.
   */
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  // MARK: - State (all access via `lock`)

  private val lock = ReentrantLock()

  /**
   * Active read job — at most one read can be in flight at a time. cancel()
   * cancels this so the suspending continuation throws CancellationException
   * and the Promise.async block surfaces it as a rejected Promise.
   */
  private var activeJob: Job? = null

  /**
   * One-shot continuation that runs once the NfcAdapter reader callback
   * fires with the tag. Cleared by `awaitTag` on completion.
   */
  private var pendingTag: CompletableDeferred<Tag>? = null

  /**
   * The Activity we're currently attached to via enableReaderMode. We hold
   * a weak-ish reference (caller-owned) so we can call disableReaderMode
   * on cancel() / readEnd without leaking.
   */
  private var attachedActivity: Activity? = null

  // MARK: - Lazy CSCA trust anchors

  /**
   * Parsed CSCA roots from `assets/masterList.pem`. Lazy because parsing
   * the full PEM bundle costs ~50ms on cold start and we'd rather pay it
   * the first time a read is initiated than at module load.
   *
   * `null` = "not yet loaded"; empty set = "loaded but no roots available"
   * (which means passive auth must report false).
   */
  @Volatile
  private var cachedTrustAnchors: Set<TrustAnchor>? = null

  // MARK: - Lazy system services

  private val context: Context
    get() = NitroModules.applicationContext
      ?: throw IllegalStateException("NitroModules.applicationContext is null")

  private val nfcAdapter: NfcAdapter?
    get() = NfcAdapter.getDefaultAdapter(context)

  // MARK: - Helpers

  private fun <T> withState(body: () -> T): T = lock.withLock(body)

  private fun error(code: String, message: String): NfcPassportException =
    NfcPassportException(code, message)

  /** ICAO 9303 chipUid — mirrors iOS HybridNfcPassport.mapToNitroResult. */
  private fun buildChipUid(documentNumber: String, mrzData: String): String {
    if (documentNumber.isNotEmpty()) {
      return "NFC-$documentNumber"
    }
    val digest = MessageDigest.getInstance("SHA-256")
    val bytes = digest.digest(mrzData.toByteArray(Charsets.UTF_8))
    val hex = StringBuilder(bytes.size * 2)
    for (b in bytes) {
      hex.append(String.format("%02x", b.toInt() and 0xFF))
    }
    return "NFC-$hex"
  }

  // MARK: - Public API

  override fun isAvailable(): Boolean {
    return nfcAdapter?.isEnabled == true
  }

  override fun read(
    mrz: PassportMRZ,
    options: NfcReadOptions?,
  ): Promise<PassportReadResult> = Promise.async {
    // Reject overlapping reads. Mirrors iOS NFCTagReaderSession which the
    // OS makes single-shot anyway — keep the API surface consistent.
    val alreadyActive = withState {
      val active = activeJob?.isActive == true
      active
    }
    if (alreadyActive) {
      throw this@HybridNfcPassport.error(
        code = "nfc_busy",
        message = "Another NFC passport read is already in progress.",
      )
    }

    // Capture the active job so cancel() can unblock the suspending wait.
    // `coroutineContext` is the kotlin.coroutines std-lib accessor — Job is
    // always present in a kotlinx CoroutineScope-launched coroutine.
    val currentJob = coroutineContext[Job]
    withState { activeJob = currentJob }

    try {
      performRead(mrz, options)
    } finally {
      withState {
        if (activeJob === currentJob) activeJob = null
      }
      // Always tear down reader mode so the next read starts clean.
      teardownReaderMode()
    }
  }

  override fun cancel() {
    data class Snapshot(val job: Job?, val deferred: CompletableDeferred<Tag>?)
    val snap = withState { Snapshot(activeJob, pendingTag) }
    // Disable reader mode first — kills the binder callback path so the
    // NfcAdapter doesn't try to dispatch a tag into a torn-down continuation.
    teardownReaderMode()
    // Unblock the suspending tag-wait if it's still pending.
    snap.deferred?.cancel(CancellationException("NFC read cancelled by caller"))
    // Cancel the read coroutine so the Promise rejects with a clean
    // CancellationException.
    snap.job?.cancel(CancellationException("NFC read cancelled by caller"))
  }

  // MARK: - Internal read flow

  private suspend fun performRead(
    mrz: PassportMRZ,
    options: NfcReadOptions?,
  ): PassportReadResult {
    val adapter = nfcAdapter ?: throw error(
      code = "nfc_unavailable",
      message = "NFC is not available on this device.",
    )
    if (!adapter.isEnabled) {
      throw error(
        code = "nfc_disabled",
        message = "NFC is disabled. Enable NFC in system settings and try again.",
      )
    }
    val activity = NitroModules.applicationContext?.currentActivity ?: throw error(
      code = "no_activity",
      message = "Cannot start NFC reader — no foreground Activity.",
    )

    val onProgress = options?.onProgress
    emitProgress(
      onProgress,
      NfcReadPhase.CONNECTING,
      percent = 0.0,
      dataGroup = null,
      message = "Tap your passport to the back of your phone.",
    )

    // 1. Hook NfcAdapter.enableReaderMode and wait for a tag.
    val tag = enableReaderModeAndAwaitTag(adapter, activity)
    val isoDep = IsoDep.get(tag) ?: throw error(
      code = "nfc_tag_not_iso_dep",
      message = "Detected NFC tag does not support ISO-DEP (not an e-passport).",
    )
    isoDep.timeout = ISODEP_TIMEOUT_MS

    emitProgress(
      onProgress,
      NfcReadPhase.AUTHENTICATING,
      percent = 5.0,
      dataGroup = null,
      message = "Chip detected — authenticating…",
    )

    // 2. Do the blocking jmrtd dance on Dispatchers.IO. Connection + APDU
    //    transceive cannot run on the main thread.
    return withContext(Dispatchers.IO) {
      val tagId = tag.id?.toHexString() ?: ""
      readWithJmrtd(isoDep, mrz, tagId, options)
    }
  }

  /**
   * Marshal a single progress event through the Nitro callback. Wrapped
   * so the call site stays one line and we silently swallow callback
   * errors — a misbehaving JS listener must not abort an in-flight NFC
   * read.
   */
  private fun emitProgress(
    onProgress: Func_void_NfcReadProgress?,
    phase: NfcReadPhase,
    percent: Double,
    dataGroup: String?,
    message: String?,
  ) {
    if (onProgress == null) return
    try {
      onProgress.invoke(
        NfcReadProgress(
          phase = phase,
          percent = percent,
          dataGroup = dataGroup,
          message = message,
        )
      )
    } catch (e: Throwable) {
      Log.w(TAG, "onProgress callback threw: ${e.javaClass.simpleName}")
    }
  }

  // MARK: - Reader-mode activation

  private suspend fun enableReaderModeAndAwaitTag(
    adapter: NfcAdapter,
    activity: Activity,
  ): Tag {
    val deferred = CompletableDeferred<Tag>()
    withState {
      pendingTag = deferred
      attachedActivity = activity
    }

    val callback = NfcAdapter.ReaderCallback { tag ->
      val d = withState { pendingTag }
      if (d != null && d.isActive) {
        d.complete(tag)
      }
    }

    val extras = Bundle().apply {
      // Slow down presence checks so chips with intermittent coupling
      // don't drop mid-secure-messaging. 250ms matches the jmrtd
      // reference reader's default.
      putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 250)
    }

    try {
      adapter.enableReaderMode(activity, callback, READER_FLAGS, extras)
    } catch (e: Throwable) {
      withState {
        pendingTag = null
        attachedActivity = null
      }
      throw error(
        code = "nfc_enable_reader_failed",
        message = "enableReaderMode failed: ${e.javaClass.simpleName}: ${e.message}",
      )
    }

    // Race the tag tap against a hard timeout so an idle/cancelled flow
    // doesn't leave the Promise hanging forever.
    val tag = try {
      withTimeoutOrNull(TAG_WAIT_TIMEOUT_MS) { deferred.await() }
    } catch (e: CancellationException) {
      withState { pendingTag = null }
      throw error(code = "nfc_cancelled", message = "NFC read was cancelled.")
    }

    withState { pendingTag = null }

    if (tag == null) {
      throw error(
        code = "nfc_timeout",
        message = "Timed out waiting for passport tap — bring the passport closer to the back of your phone.",
      )
    }
    return tag
  }

  private fun teardownReaderMode() {
    val activity = withState {
      val a = attachedActivity
      attachedActivity = null
      pendingTag = null
      a
    } ?: return
    try {
      nfcAdapter?.disableReaderMode(activity)
    } catch (e: Throwable) {
      Log.w(TAG, "disableReaderMode failed: ${e.javaClass.simpleName}")
    }
  }

  // MARK: - jmrtd read sequence

  /**
   * Drives the BAC/PACE handshake and pulls each data group. Mirrors the
   * iOS [.COM, .SOD, .DG1, .DG2, .DG14, .DG15] sequence.
   *
   * When [options]?.skipFaceImage is true we drop DG2 from the read.
   * DG2 is the face JPEG (15-30KB over slow NFC) and is the single
   * biggest contributor to read latency; the Expo JS pipeline only
   * uses DG1 today so the screen passes `skipFaceImage: true` for a
   * sub-3s read instead of ~5-8s with DG2.
   */
  private fun readWithJmrtd(
    isoDep: IsoDep,
    mrz: PassportMRZ,
    tagId: String,
    options: NfcReadOptions?,
  ): PassportReadResult {
    val onProgress = options?.onProgress
    val skipFace = options?.skipFaceImage == true
    val cardService = CardService.getInstance(isoDep)
    val service = PassportService(
      cardService,
      PassportService.NORMAL_MAX_TRANCEIVE_LENGTH,
      PassportService.DEFAULT_MAX_BLOCKSIZE,
      true,  // isSFIEnabled (Short File Identifier reads — fall-through to long if not supported)
      false, // shouldCheckMAC (we let jmrtd's secure messaging layer manage MAC)
    )

    try {
      service.open()
    } catch (e: Throwable) {
      throw error(
        code = "nfc_open_failed",
        message = "Failed to open PassportService: ${e.javaClass.simpleName}: ${e.message}",
      )
    }

    val accessKey = BACKey(mrz.documentNumber, mrz.dateOfBirth, mrz.dateOfExpiry)

    // 1. Try PACE first (per ICAO 9303). If the chip doesn't advertise
    //    PACE via CardAccess, fall back to BAC. Track which one succeeded
    //    so we can detect a PACE-downgrade for the passive-auth gate.
    var paceSucceeded = false
    var bacSucceeded = false
    var chipSupportsPACE = false

    val paceParams: PACEInfo? = try {
      val maxRead = service.maxReadBinaryLength
      val cardAccess = service.getInputStream(PassportService.EF_CARD_ACCESS, maxRead).use { stream ->
        CardAccessFile(stream)
      }
      val securityInfos = cardAccess.securityInfos
      var found: PACEInfo? = null
      for (info in securityInfos) {
        if (info is PACEInfo) {
          chipSupportsPACE = true
          found = info
          break
        }
      }
      found
    } catch (e: Throwable) {
      // EF.CARD_ACCESS may not be present pre-EAC2 chips. Fall through to BAC.
      Log.i(TAG, "CardAccess read failed (likely no PACE): ${e.javaClass.simpleName}")
      null
    }

    if (paceParams != null) {
      try {
        service.doPACE(
          PACEKeySpec.createMRZKey(accessKey),
          paceParams.objectIdentifier,
          PACEInfo.toParameterSpec(paceParams.parameterId),
          paceParams.parameterId,
        )
        paceSucceeded = true
      } catch (e: Throwable) {
        Log.i(TAG, "PACE failed (${e.javaClass.simpleName}); will try BAC fallback")
      }
    }

    // sendSelectApplet param is "use PACE" — true when PACE just succeeded.
    try {
      service.sendSelectApplet(paceSucceeded)
    } catch (e: Throwable) {
      throw error(
        code = "nfc_select_applet_failed",
        message = "sendSelectApplet failed: ${e.javaClass.simpleName}: ${e.message}",
      )
    }

    if (!paceSucceeded) {
      try {
        service.doBAC(accessKey)
        bacSucceeded = true
      } catch (e: Throwable) {
        throw error(
          code = "nfc_bac_failed",
          message = "BAC authentication failed — verify MRZ inputs match the passport: ${e.javaClass.simpleName}",
        )
      }
    }

    emitProgress(onProgress, NfcReadPhase.AUTHENTICATING, 30.0, null, "Authenticated. Reading data…")

    // 2. Read each data group. Wrap each in its own try/catch so a missing
    //    DG14/DG15 doesn't kill the whole read (some chips skip them). DG2
    //    is conditional on `options.skipFaceImage` — when true, skip the
    //    slowest leg of the read entirely.
    emitProgress(onProgress, NfcReadPhase.READING_DG, 35.0, "SOD", "Reading SOD…")
    val sodBytes = readEf(service, PassportService.EF_SOD, required = true)
    emitProgress(onProgress, NfcReadPhase.READING_DG, 50.0, "DG1", "Reading DG1…")
    val dg1Bytes = readEf(service, PassportService.EF_DG1, required = true)
    val dg2Bytes = if (skipFace) {
      null
    } else {
      emitProgress(onProgress, NfcReadPhase.READING_DG, 65.0, "DG2", "Reading DG2 (face image)…")
      readEf(service, PassportService.EF_DG2, required = false)
    }
    emitProgress(onProgress, NfcReadPhase.READING_DG, 80.0, "DG14", "Reading DG14…")
    val dg14Bytes = readEf(service, PassportService.EF_DG14, required = false)
    emitProgress(onProgress, NfcReadPhase.READING_DG, 88.0, "DG15", "Reading DG15…")
    val dg15Bytes = readEf(service, PassportService.EF_DG15, required = false)
    emitProgress(onProgress, NfcReadPhase.VERIFYING, 92.0, null, "Verifying signatures…")

    try {
      service.close()
    } catch (e: Throwable) {
      Log.w(TAG, "PassportService.close threw ${e.javaClass.simpleName}; ignoring")
    }

    // 3. Parse DG1 → MRZInfo.
    val parsedMrz = parseMrz(dg1Bytes, fallback = mrz)
    val passportMrzString = composeMrzString(dg1Bytes, fallback = mrz)

    // 4. Passive authentication.
    val signedAndUntampered = if (sodBytes != null) {
      verifyPassiveAuth(sodBytes, mapOf(
        1 to dg1Bytes,
        2 to dg2Bytes,
        14 to dg14Bytes,
        15 to dg15Bytes,
      ))
    } else {
      false
    }

    val paceDowngraded = chipSupportsPACE && bacSucceeded && !paceSucceeded
    val passiveAuthValid = signedAndUntampered && !paceDowngraded
    if (signedAndUntampered && paceDowngraded) {
      Log.w(TAG, "Passive auth FORCED to false because PACE was downgraded to BAC")
    }

    val chipUid = buildChipUid(
      documentNumber = parsedMrz.documentNumber,
      mrzData = passportMrzString.ifEmpty { tagId },
    )

    emitProgress(onProgress, NfcReadPhase.DONE, 100.0, null, "Passport read.")

    return PassportReadResult(
      mrz = parsedMrz,
      dataGroups = DataGroupsBundle(
        dg1 = dg1Bytes?.let { ArrayBuffer.copy(it) },
        dg2 = dg2Bytes?.let { ArrayBuffer.copy(it) },
        dg14 = dg14Bytes?.let { ArrayBuffer.copy(it) },
        dg15 = dg15Bytes?.let { ArrayBuffer.copy(it) },
        sod = sodBytes?.let { ArrayBuffer.copy(it) },
      ),
      chipUid = chipUid,
      passiveAuthValid = passiveAuthValid,
    )
  }

  /**
   * Read a single Elementary File via PassportService.getInputStream.
   * Returns null on read failure when [required] is false (so DG14/DG15
   * can be skipped on chips that don't carry them).
   *
   * Uses the (short, int) overload because the (short) variant is
   * deprecated since jmrtd 0.7.x in favour of an explicit
   * `maxReadBinaryLength` to drive the secure-messaging APDU chunking.
   */
  private fun readEf(service: PassportService, fid: Short, required: Boolean): ByteArray? {
    return try {
      val maxRead = service.maxReadBinaryLength
      service.getInputStream(fid, maxRead).use { stream -> readFully(stream) }
    } catch (e: Throwable) {
      if (required) {
        throw error(
          code = "nfc_dg_read_failed",
          message = "Failed to read required EF 0x${"%04X".format(fid.toInt() and 0xFFFF)}: ${e.javaClass.simpleName}",
        )
      }
      Log.i(TAG, "Skipping optional EF 0x${"%04X".format(fid.toInt() and 0xFFFF)} (${e.javaClass.simpleName})")
      null
    }
  }

  private fun readFully(input: InputStream): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val buf = ByteArray(4096)
    while (true) {
      val n = input.read(buf)
      if (n < 0) break
      out.write(buf, 0, n)
    }
    return out.toByteArray()
  }

  // MARK: - MRZ parsing

  private fun parseMrz(dg1Bytes: ByteArray?, fallback: PassportMRZ): ParsedMrz {
    val info = parseMrzInfo(dg1Bytes)
    if (info == null) {
      return ParsedMrz(
        nationality = "",
        documentNumber = fallback.documentNumber,
        name = "",
        dateOfBirth = fallback.dateOfBirth,
        dateOfExpiry = fallback.dateOfExpiry,
        gender = "",
      )
    }
    val last = (info.primaryIdentifier ?: "").trim()
    val first = (info.secondaryIdentifier ?: "").trim()
    val composedName = when {
      last.isEmpty() -> first
      first.isEmpty() -> last
      else -> "$last, $first"
    }
    val docNum = (info.documentNumber ?: "").trim().ifEmpty { fallback.documentNumber }
    val dob = (info.dateOfBirth ?: "").trim().ifEmpty { fallback.dateOfBirth }
    val exp = (info.dateOfExpiry ?: "").trim().ifEmpty { fallback.dateOfExpiry }
    val nationality = (info.nationality ?: "").trim().let {
      if (it.length > 3) it.substring(0, 3) else it
    }
    val gender = info.gender?.toString().orEmpty()
    return ParsedMrz(
      nationality = nationality,
      documentNumber = docNum,
      name = composedName,
      dateOfBirth = dob,
      dateOfExpiry = exp,
      gender = gender,
    )
  }

  private fun composeMrzString(dg1Bytes: ByteArray?, fallback: PassportMRZ): String {
    val info = parseMrzInfo(dg1Bytes) ?: return fallback.documentNumber +
      fallback.dateOfBirth + fallback.dateOfExpiry
    return runCatching { info.toString() }.getOrDefault(
      fallback.documentNumber + fallback.dateOfBirth + fallback.dateOfExpiry,
    )
  }

  private fun parseMrzInfo(dg1Bytes: ByteArray?): MRZInfo? {
    if (dg1Bytes == null || dg1Bytes.isEmpty()) return null
    return try {
      val dg1 = DG1File(ByteArrayInputStream(dg1Bytes))
      // Java Bean introspector keeps `getMRZInfo` as `MRZInfo` because the
      // second char of the prefix is also uppercase — call the getter
      // explicitly so this doesn't break if the convention shifts.
      dg1.getMRZInfo()
    } catch (e: Throwable) {
      Log.w(TAG, "Failed to parse DG1: ${e.javaClass.simpleName}")
      null
    }
  }

  // MARK: - Passive authentication

  /**
   * Verifies the SOD's CMS SignedData against the chip's data groups and
   * the bundled CSCA trust anchors. Returns true iff:
   *   - the SOD's embedded signing cert chains up to a known CSCA root,
   *   - the SOD signature itself verifies, and
   *   - every supplied DG's hash matches the SOD-embedded hash for that DG.
   *
   * Any failure (parse, missing trust anchors, hash mismatch) yields false
   * so the caller can downgrade the trust label rather than throw.
   */
  private fun verifyPassiveAuth(
    sodBytes: ByteArray,
    dataGroups: Map<Int, ByteArray?>,
  ): Boolean {
    val sod = try {
      SODFile(ByteArrayInputStream(sodBytes))
    } catch (e: Throwable) {
      Log.w(TAG, "SOD parse failed: ${e.javaClass.simpleName}")
      return false
    }

    val anchors = loadTrustAnchors()
    if (anchors.isEmpty()) {
      Log.w(TAG, "No CSCA trust anchors available — passive auth = false")
      return false
    }

    // 1. Verify SOD signature using its embedded Document Signer Certificate.
    val docSigner: X509Certificate = try {
      sod.docSigningCertificate ?: run {
        Log.w(TAG, "SOD missing docSigningCertificate")
        return false
      }
    } catch (e: Throwable) {
      Log.w(TAG, "docSigningCertificate accessor threw: ${e.javaClass.simpleName}")
      return false
    }

    val sodSignatureValid = try {
      verifySodCmsSignature(sodBytes, docSigner)
    } catch (e: Throwable) {
      Log.w(TAG, "SOD signature verify failed: ${e.javaClass.simpleName}")
      false
    }
    if (!sodSignatureValid) return false

    // 2. Verify the document signer chains up to a CSCA root.
    val chainValid = verifyDocSignerChain(docSigner, anchors)
    if (!chainValid) {
      Log.w(TAG, "Document signer cert did not chain to a CSCA root")
      return false
    }

    // 3. Verify each DG's hash matches what the SOD claims. The map is
    //    typed as Map<Integer, byte[]> on the Java side; we use index
    //    lookups instead of declaring a Kotlin generic type so the
    //    platform-type passthrough stays warning-free.
    val expectedHashes = try {
      sod.dataGroupHashes
    } catch (e: Throwable) {
      Log.w(TAG, "SOD.dataGroupHashes threw: ${e.javaClass.simpleName}")
      return false
    }
    val digestAlg = try {
      sod.digestAlgorithm ?: "SHA-256"
    } catch (e: Throwable) {
      "SHA-256"
    }
    val md = try {
      MessageDigest.getInstance(digestAlg)
    } catch (e: Throwable) {
      Log.w(TAG, "Unsupported SOD digest algorithm '$digestAlg': ${e.javaClass.simpleName}")
      return false
    }

    for ((dgNumber, dgBytesOrNull) in dataGroups) {
      val dgBytes = dgBytesOrNull ?: continue
      val expected = expectedHashes?.get(dgNumber) ?: continue
      md.reset()
      val actual = md.digest(dgBytes)
      if (!actual.contentEquals(expected)) {
        Log.w(TAG, "DG$dgNumber hash mismatch — passport data tampered")
        return false
      }
    }

    return true
  }

  /**
   * Verifies the SOD's CMS SignedData signature against the document
   * signer's public key. We route through BouncyCastle's CMS layer
   * because the signature is computed over the DER-encoded
   * SignedAttributes (RFC 3852 §5.4), not over the eContent directly —
   * a naive `Signature.verify(eContent)` would always fail.
   *
   * Returns true iff the CMS SignerInfo verifies. False on any parse or
   * verify failure.
   */
  private fun verifySodCmsSignature(
    sodBytes: ByteArray,
    docSigner: X509Certificate,
  ): Boolean {
    // 1. The SOD is the ICAO LDS-tagged wrapper [0x77 LEN] around an
    //    RFC 3852 ContentInfo. Strip the BER tag+length so we can feed
    //    the inner SignedData to BC's CMS layer.
    val cmsBytes = stripLdsWrapper(sodBytes) ?: run {
      Log.w(TAG, "SOD missing expected 0x77 LDS wrapper")
      return false
    }
    val cms = try {
      org.bouncycastle.cms.CMSSignedData(cmsBytes)
    } catch (e: Throwable) {
      Log.w(TAG, "CMSSignedData ctor threw: ${e.javaClass.simpleName}")
      return false
    }

    // 2. Walk the signer infos — passports have exactly one SignerInfo
    //    (the Document Signer's). Verify it against docSigner's pub key.
    val signerInfoStore = try {
      cms.signerInfos
    } catch (e: Throwable) {
      Log.w(TAG, "cms.signerInfos threw: ${e.javaClass.simpleName}")
      return false
    }
    val verifier = try {
      org.bouncycastle.cms.jcajce.JcaSimpleSignerInfoVerifierBuilder()
        .setProvider(org.bouncycastle.jce.provider.BouncyCastleProvider())
        .build(docSigner)
    } catch (e: Throwable) {
      Log.w(TAG, "JcaSimpleSignerInfoVerifierBuilder.build threw: ${e.javaClass.simpleName}")
      return false
    }
    for (signer in signerInfoStore.signers) {
      try {
        if (signer.verify(verifier)) return true
      } catch (e: Throwable) {
        Log.i(TAG, "SignerInformation.verify threw: ${e.javaClass.simpleName}")
      }
    }
    return false
  }

  /**
   * Strips the ICAO LDS BER tag+length envelope (0x77) from a raw SOD
   * payload and returns the inner CMS ContentInfo bytes. Returns null
   * when the leading byte isn't the expected 0x77 tag — caller logs and
   * marks passive auth as failed.
   *
   * BER length encoding:
   *   - one byte 0x00–0x7F → length value
   *   - 0x8N (N=1..4) → next N bytes are the big-endian length
   */
  private fun stripLdsWrapper(sodBytes: ByteArray): ByteArray? {
    if (sodBytes.size < 2) return null
    if ((sodBytes[0].toInt() and 0xFF) != 0x77) return null
    val firstLenByte = sodBytes[1].toInt() and 0xFF
    val (contentOffset, contentLen) = if (firstLenByte < 0x80) {
      Pair(2, firstLenByte)
    } else {
      val lenOfLen = firstLenByte and 0x7F
      if (lenOfLen == 0 || lenOfLen > 4) return null
      if (sodBytes.size < 2 + lenOfLen) return null
      var len = 0
      for (i in 0 until lenOfLen) {
        len = (len shl 8) or (sodBytes[2 + i].toInt() and 0xFF)
      }
      Pair(2 + lenOfLen, len)
    }
    if (contentOffset + contentLen > sodBytes.size) return null
    return sodBytes.copyOfRange(contentOffset, contentOffset + contentLen)
  }

  private fun verifyDocSignerChain(
    docSigner: X509Certificate,
    anchors: Set<TrustAnchor>,
  ): Boolean {
    // Cheap, robust check: validate signature against each candidate CSCA
    // root whose Subject == docSigner.Issuer. We don't run a full PKIX
    // path validation because the bundle is flat (no intermediates) and
    // CSCAs are self-signed roots.
    val issuer = docSigner.issuerX500Principal
    for (anchor in anchors) {
      val trustedCert = anchor.trustedCert ?: continue
      if (trustedCert.subjectX500Principal != issuer) continue
      try {
        docSigner.verify(trustedCert.publicKey)
        return true
      } catch (_: Throwable) {
        // Try the next candidate; CSCA bundles often contain multiple roots
        // for the same issuer (key rotation).
      }
    }
    return false
  }

  private fun loadTrustAnchors(): Set<TrustAnchor> {
    cachedTrustAnchors?.let { return it }
    val anchors = synchronized(this) {
      cachedTrustAnchors ?: parseMasterListAsset().also { cachedTrustAnchors = it }
    }
    return anchors
  }

  private fun parseMasterListAsset(): Set<TrustAnchor> {
    val ctx = NitroModules.applicationContext ?: return emptySet()
    val pemBytes = try {
      ctx.assets.open(MASTER_LIST_ASSET).use { it.readBytes() }
    } catch (e: IOException) {
      Log.w(TAG, "$MASTER_LIST_ASSET missing from assets — passive auth disabled")
      return emptySet()
    }
    return parsePemCertificates(pemBytes)
  }

  /**
   * Walks a concatenated PEM blob, extracting each `-----BEGIN CERTIFICATE-----`
   * block, and decodes via the JCA CertificateFactory. Skips blocks that fail
   * to decode so a single bad cert can't disable passive auth.
   */
  private fun parsePemCertificates(pemBytes: ByteArray): Set<TrustAnchor> {
    val cf = try {
      CertificateFactory.getInstance("X.509")
    } catch (e: Throwable) {
      Log.w(TAG, "X.509 CertificateFactory unavailable: ${e.javaClass.simpleName}")
      return emptySet()
    }
    val text = pemBytes.toString(Charsets.US_ASCII)
    val anchors = mutableSetOf<TrustAnchor>()
    val beginMarker = "-----BEGIN CERTIFICATE-----"
    val endMarker = "-----END CERTIFICATE-----"
    var cursor = 0
    while (true) {
      val begin = text.indexOf(beginMarker, cursor)
      if (begin < 0) break
      val end = text.indexOf(endMarker, begin)
      if (end < 0) break
      val blockEnd = end + endMarker.length
      val block = text.substring(begin, blockEnd)
      try {
        val cert = cf.generateCertificate(ByteArrayInputStream(block.toByteArray(Charsets.US_ASCII))) as? X509Certificate
        if (cert != null) {
          anchors.add(TrustAnchor(cert, null))
        }
      } catch (e: Throwable) {
        // Skip malformed blocks silently — masterList.pem aggregates
        // hundreds of CSCAs; one bad cert shouldn't kill passive auth.
      }
      cursor = blockEnd
    }
    return anchors
  }

  // MARK: - Byte → hex (chip UID rendering)

  private fun ByteArray.toHexString(): String {
    val out = StringBuilder(size * 2)
    for (b in this) {
      out.append(String.format("%02x", b.toInt() and 0xFF))
    }
    return out.toString()
  }
}

/**
 * Typed exception so Promise rejections carry both a stable error code and a
 * human-readable message. Mirrors the iOS `error(code:message:)` helper —
 * the JS layer can switch on `(err as any).errorCode` to map to UX strings.
 */
class NfcPassportException(
  val errorCode: String,
  message: String,
) : RuntimeException("[$errorCode] $message")
