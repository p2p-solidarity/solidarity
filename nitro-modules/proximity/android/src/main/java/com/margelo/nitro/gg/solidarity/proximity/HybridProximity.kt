/*
 * HybridProximity.kt
 * @solidarity/nitro-proximity (Android)
 *
 * Cross-platform peer discovery + UWB ranging behind the Nitrogen-generated
 * HybridProximitySpec. Mirrors the iOS impl (MultipeerConnectivity +
 * NearbyInteraction) using BLE advertising/scanning + L2CAP CoC channels
 * for transport, and androidx.core.uwb for ranging.
 *
 * Architecture (matches iOS HybridProximity.swift):
 *   - Advertise side: GATT server exposes service UUID + PSM + discovery
 *     info characteristics, BLE LE Advertiser broadcasts the service UUID.
 *     A BluetoothServerSocket on a known L2CAP PSM accepts incoming peers.
 *   - Browse side: BluetoothLeScanner filters on service UUID; on hit,
 *     opportunistically GATT-connects to read PSM + discovery JSON.
 *   - Invite: Look up cached PSM, open insecure L2CAP CoC, write framed
 *     payload as first message, park socket in connectedSockets.
 *   - UWB: androidx.core.uwb controlee session scope per peer. Mirrors the
 *     iOS NISession lifecycle — create on startRanging, invalidate on
 *     stopRanging. The peer-address exchange (and therefore the Flow that
 *     emits RangingResultPosition events) is the JS layer's responsibility,
 *     same as the NI discovery-token exchange on iOS.
 *
 * Wire protocol (must match iOS HybridProximity.swift):
 *   - Service UUID:            4d2c3a01-7a8d-4f2c-9a2e-b5d2c3a17a8d
 *   - PSM characteristic:      4d2c3a02-7a8d-4f2c-9a2e-b5d2c3a17a8d (READ, 2-byte LE uint16)
 *   - Discovery info char:     4d2c3a03-7a8d-4f2c-9a2e-b5d2c3a17a8d (READ, UTF-8 JSON ≤ 512B)
 *   - Frame format:            2-byte big-endian length + payload
 *
 * Required permissions (caller must add to AndroidManifest):
 *   API 31+:
 *     - android.permission.BLUETOOTH_ADVERTISE
 *     - android.permission.BLUETOOTH_CONNECT
 *     - android.permission.BLUETOOTH_SCAN (with usesPermissionFlags="neverForLocation" if not using location)
 *     - android.permission.UWB_RANGING
 *   API < 31 fallback:
 *     - android.permission.BLUETOOTH
 *     - android.permission.BLUETOOTH_ADMIN
 *     - android.permission.ACCESS_FINE_LOCATION
 *
 * The caller's contract is to request these at runtime before calling
 * startAdvertising / startBrowsing. We @Suppress("MissingPermission") on
 * the BLE/UWB calls because Android Studio's lint can't track the
 * runtime grant across the JS→Nitro→Kotlin boundary.
 */
@file:Suppress("MissingPermission")

package com.margelo.nitro.gg.solidarity.proximity

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothServerSocket
import android.bluetooth.BluetoothSocket
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.ParcelUuid
import android.util.Log
import androidx.core.uwb.RangingResult
import androidx.core.uwb.UwbControleeSessionScope
import androidx.core.uwb.UwbManager
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

class HybridProximity : HybridProximitySpec() {

  // MARK: - Constants

  companion object {
    private const val TAG = "HybridProximity"

    /** Service UUID broadcast in the BLE advertisement. Matches iOS. */
    private val SERVICE_UUID: UUID =
      UUID.fromString("4d2c3a01-7a8d-4f2c-9a2e-b5d2c3a17a8d")

    /** GATT characteristic exposing the L2CAP PSM as 2-byte LE uint16. */
    private val PSM_CHAR_UUID: UUID =
      UUID.fromString("4d2c3a02-7a8d-4f2c-9a2e-b5d2c3a17a8d")

    /** GATT characteristic exposing the discovery info JSON (UTF-8, ≤ 512B). */
    private val DISCOVERY_INFO_CHAR_UUID: UUID =
      UUID.fromString("4d2c3a03-7a8d-4f2c-9a2e-b5d2c3a17a8d")

    /** Drop peers we haven't seen in this many ms. Matches MC "lostPeer" cadence. */
    private const val PEER_LOST_TIMEOUT_MS: Long = 10_000

    /** Max time we'll wait on a synchronous PSM GATT-read inside invitePeer(). */
    private const val PSM_FETCH_TIMEOUT_MS: Long = 5_000
  }

  // MARK: - Coroutine scopes

  /**
   * Long-lived scope tied to the HybridProximity instance lifetime. All
   * I/O coroutines (accept loops, readers, advertise/scan) launch here so
   * they cancel together when the bridge tears down.
   */
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  // MARK: - State (all access via `lock`)

  private val lock = ReentrantLock()

  /** Listener fan-out. UUID key so unsubscribe stays O(1). */
  private val listeners = mutableMapOf<UUID, (ProximityEvent) -> Unit>()

  /** Found peers by address. Keep last-seen timestamp for peerLost emission. */
  private data class FoundPeer(
    val device: BluetoothDevice,
    var displayName: String,
    var discoveryInfoJson: String,
    var rssi: Int,
    var lastSeenAt: Long,
  )

  private val foundPeers = mutableMapOf<String, FoundPeer>()

  /** PSM cache populated by opportunistic GATT reads on scan hits. */
  private val psmCache = mutableMapOf<String, Int>()

  /** Sockets parked between server-side accept() and acceptInvitation(). */
  private val pendingIncomingSockets = mutableMapOf<String, BluetoothSocket>()

  /** Active L2CAP sockets keyed by peer address. */
  private val connectedSockets = mutableMapOf<String, BluetoothSocket>()

  /** Reader coroutines so we can cancel on disconnect. */
  private val readerJobs = mutableMapOf<String, Job>()

  /**
   * Active UWB controlee sessions keyed by peerId. We hold onto the
   * session-scope handle so the underlying ranging service stays bound;
   * iOS keeps the analogous NISession in `niSessions` for the same reason.
   * The collection coroutine (started once the JS layer has injected the
   * peer's UwbAddress + complex channel via sendData) is tracked separately
   * so stopRanging can cancel cleanly even if collection never began.
   */
  private data class UwbSession(
    val scope: UwbControleeSessionScope,
    var collectorJob: Job? = null,
  )

  private val uwbSessions = mutableMapOf<String, UwbSession>()

  /** Latched once we've emitted the uwb_unavailable error so we don't spam JS. */
  private var uwbUnavailableNotified: Boolean = false

  // MARK: - BLE / GATT handles

  private var advertisingDisplayName: String = "solidarity-peer"
  private var discoveryInfoJson: String = "{}"

  private var serverSocket: BluetoothServerSocket? = null
  private var serverPsm: Int = 0
  private var gattServer: BluetoothGattServer? = null
  private var advertiser: BluetoothLeAdvertiser? = null
  private var advertiseCallback: AdvertiseCallback? = null
  private var acceptLoopJob: Job? = null

  private var scanner: BluetoothLeScanner? = null
  private var scanCallback: ScanCallback? = null
  private var peerLostJob: Job? = null

  // MARK: - Lazy system services

  private val context: Context
    get() = NitroModules.applicationContext
      ?: throw IllegalStateException("NitroModules.applicationContext is null")

  private val bluetoothManager: BluetoothManager?
    get() = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager

  private val bluetoothAdapter: BluetoothAdapter?
    get() = bluetoothManager?.adapter

  /**
   * UwbManager instance, created lazily on first ranging request. Only safe
   * to touch when [Build.VERSION.SDK_INT] >= S; callers must gate first.
   * Marked @Volatile so the double-checked init in [uwbManagerOrNull] is
   * safe without a full lock on the hot path.
   */
  @Volatile
  private var uwbManager: UwbManager? = null

  // MARK: - Helpers

  private fun <T> withState(body: () -> T): T = lock.withLock(body)

  private fun emit(event: ProximityEvent) {
    val snapshot = withState { listeners.values.toList() }
    for (handler in snapshot) {
      try {
        handler(event)
      } catch (t: Throwable) {
        Log.w(TAG, "Listener threw", t)
      }
    }
  }

  private fun emitError(message: String, code: String) {
    emit(makeEvent(kind = ProximityEventKind.ERROR, errorMessage = message, errorCode = code))
  }

  /**
   * Single ProximityEvent constructor wrapper. The generated init has 10
   * positional params; wrap once for readability.
   */
  private fun makeEvent(
    kind: ProximityEventKind,
    peer: ProximityPeer? = null,
    peerId: String? = null,
    payload: ArrayBuffer? = null,
    reason: String? = null,
    data: ArrayBuffer? = null,
    distance: Double? = null,
    direction: ProximityDirection? = null,
    errorMessage: String? = null,
    errorCode: String? = null,
  ): ProximityEvent = ProximityEvent(
    kind = kind,
    peer = peer,
    peerId = peerId,
    payload = payload,
    reason = reason,
    data = data,
    distance = distance,
    direction = direction,
    errorMessage = errorMessage,
    errorCode = errorCode,
  )

  // MARK: - Advertise (server side)

  override fun startAdvertising(
    displayName: String,
    serviceType: String,
    discoveryInfoJson: String,
  ) {
    val adapter = bluetoothAdapter
    if (adapter == null || !adapter.isEnabled) {
      emitError("Bluetooth adapter unavailable or disabled", "ble_unavailable")
      return
    }

    withState {
      this.advertisingDisplayName = displayName
      this.discoveryInfoJson = discoveryInfoJson
    }

    // 1. Open L2CAP server socket and read PSM.
    val sock = try {
      adapter.listenUsingInsecureL2capChannel()
    } catch (e: IOException) {
      emitError("listenUsingInsecureL2capChannel failed: ${e.message}", "l2cap_listen_failed")
      return
    } catch (e: SecurityException) {
      emitError("Missing BLUETOOTH_CONNECT permission", "permission_denied")
      return
    }
    val psm = sock.psm
    withState {
      this.serverSocket = sock
      this.serverPsm = psm
    }

    // 2. Bring up GATT server with PSM + discovery info characteristics.
    if (!startGattServer(psm, discoveryInfoJson)) {
      try { sock.close() } catch (_: IOException) {}
      withState { this.serverSocket = null; this.serverPsm = 0 }
      return
    }

    // 3. Start LE advertising broadcasting the service UUID.
    if (!startLeAdvertising()) {
      stopGattServer()
      try { sock.close() } catch (_: IOException) {}
      withState { this.serverSocket = null; this.serverPsm = 0 }
      return
    }

    // 4. Spawn the accept loop.
    val job = scope.launch { runAcceptLoop(sock) }
    withState { this.acceptLoopJob = job }
  }

  override fun stopAdvertising() {
    // Snapshot + clear under the lock so we don't double-cleanup if
    // stopAdvertising() races with the bridge tear-down.
    data class Snapshot(
      val sock: BluetoothServerSocket?,
      val job: Job?,
      val server: BluetoothGattServer?,
      val adv: BluetoothLeAdvertiser?,
      val cb: AdvertiseCallback?,
    )
    val snap = withState {
      val s = Snapshot(serverSocket, acceptLoopJob, gattServer, advertiser, advertiseCallback)
      serverSocket = null
      acceptLoopJob = null
      gattServer = null
      advertiser = null
      advertiseCallback = null
      s
    }
    snap.job?.cancel()
    try { snap.sock?.close() } catch (_: IOException) {}
    val adv = snap.adv
    val cb = snap.cb
    if (adv != null && cb != null) {
      try { adv.stopAdvertising(cb) } catch (e: Exception) {
        Log.w(TAG, "stopAdvertising failed", e)
      }
    }
    try { snap.server?.close() } catch (e: Exception) {
      Log.w(TAG, "gattServer.close failed", e)
    }
  }

  // MARK: - GATT server

  private fun startGattServer(psm: Int, infoJson: String): Boolean {
    val mgr = bluetoothManager ?: run {
      emitError("BluetoothManager unavailable", "ble_unavailable")
      return false
    }
    val server = try {
      mgr.openGattServer(context, gattServerCallback)
    } catch (e: SecurityException) {
      emitError("Missing BLUETOOTH_CONNECT permission for GATT", "permission_denied")
      return false
    } ?: run {
      emitError("openGattServer returned null", "gatt_server_failed")
      return false
    }

    val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)

    val psmBytes = ByteBuffer
      .allocate(2)
      .order(ByteOrder.LITTLE_ENDIAN)
      .putShort(psm.toShort())
      .array()
    val psmChar = BluetoothGattCharacteristic(
      PSM_CHAR_UUID,
      BluetoothGattCharacteristic.PROPERTY_READ,
      BluetoothGattCharacteristic.PERMISSION_READ,
    ).apply { value = psmBytes }

    val infoBytes = infoJson.toByteArray(Charsets.UTF_8)
    val safeInfoBytes = if (infoBytes.size > 512) infoBytes.copyOf(512) else infoBytes
    val infoChar = BluetoothGattCharacteristic(
      DISCOVERY_INFO_CHAR_UUID,
      BluetoothGattCharacteristic.PROPERTY_READ,
      BluetoothGattCharacteristic.PERMISSION_READ,
    ).apply { value = safeInfoBytes }

    service.addCharacteristic(psmChar)
    service.addCharacteristic(infoChar)
    try {
      server.addService(service)
    } catch (e: SecurityException) {
      emitError("addService threw SecurityException: ${e.message}", "permission_denied")
      try { server.close() } catch (_: Exception) {}
      return false
    }
    withState { this.gattServer = server }
    return true
  }

  private fun stopGattServer() {
    val server = withState {
      val s = gattServer
      gattServer = null
      s
    }
    try { server?.close() } catch (e: Exception) {
      Log.w(TAG, "gattServer.close failed", e)
    }
  }

  private val gattServerCallback = object : BluetoothGattServerCallback() {
    override fun onCharacteristicReadRequest(
      device: BluetoothDevice,
      requestId: Int,
      offset: Int,
      characteristic: BluetoothGattCharacteristic,
    ) {
      val (server, value) = withState {
        val v = characteristic.value ?: ByteArray(0)
        Pair(gattServer, v)
      }
      val response = if (offset < value.size) value.copyOfRange(offset, value.size) else ByteArray(0)
      try {
        server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, response)
      } catch (e: SecurityException) {
        Log.w(TAG, "sendResponse SecurityException", e)
      }
    }
  }

  // MARK: - LE advertiser

  private fun startLeAdvertising(): Boolean {
    val adapter = bluetoothAdapter ?: return false
    val adv = adapter.bluetoothLeAdvertiser ?: run {
      emitError("BluetoothLeAdvertiser unavailable on this device", "advertiser_unavailable")
      return false
    }

    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
      .setConnectable(true)
      .build()

    val data = AdvertiseData.Builder()
      .addServiceUuid(ParcelUuid(SERVICE_UUID))
      .build()

    val scanResponse = AdvertiseData.Builder()
      .setIncludeDeviceName(true)
      .build()

    val cb = object : AdvertiseCallback() {
      override fun onStartFailure(errorCode: Int) {
        emitError("BLE advertise failed: errorCode=$errorCode", "advertise_failed")
      }
    }

    try {
      adv.startAdvertising(settings, data, scanResponse, cb)
    } catch (e: SecurityException) {
      emitError("Missing BLUETOOTH_ADVERTISE permission", "permission_denied")
      return false
    } catch (e: IllegalArgumentException) {
      emitError("BLE advertise rejected: ${e.message}", "advertise_failed")
      return false
    }

    withState {
      this.advertiser = adv
      this.advertiseCallback = cb
    }
    return true
  }

  // MARK: - Accept loop

  private suspend fun runAcceptLoop(sock: BluetoothServerSocket) {
    while (scope.isActive) {
      val client = try {
        // BluetoothServerSocket.accept() is a blocking call; we're on Dispatchers.IO.
        sock.accept()
      } catch (e: IOException) {
        // Normal on serverSocket.close() — bail out silently.
        if (scope.isActive) {
          Log.w(TAG, "serverSocket.accept failed", e)
        }
        return
      }

      // Read the first frame off the channel as the "invitation context".
      scope.launch { handleIncomingClient(client) }
    }
  }

  private suspend fun handleIncomingClient(socket: BluetoothSocket) {
    val address = try { socket.remoteDevice.address } catch (e: Exception) { "unknown" }
    val payload = try {
      readFrame(socket.inputStream)
    } catch (e: IOException) {
      Log.w(TAG, "Failed to read invitation frame from $address", e)
      try { socket.close() } catch (_: IOException) {}
      return
    }
    if (payload == null) {
      try { socket.close() } catch (_: IOException) {}
      return
    }

    withState { pendingIncomingSockets[address] = socket }
    emit(
      makeEvent(
        kind = ProximityEventKind.INVITATIONRECEIVED,
        peerId = address,
        payload = ArrayBuffer.copy(payload),
      )
    )
  }

  // MARK: - Browse (client side)

  override fun startBrowsing(serviceType: String) {
    val adapter = bluetoothAdapter
    if (adapter == null || !adapter.isEnabled) {
      emitError("Bluetooth adapter unavailable or disabled", "ble_unavailable")
      return
    }
    val s = adapter.bluetoothLeScanner ?: run {
      emitError("BluetoothLeScanner unavailable", "scanner_unavailable")
      return
    }

    val filters = listOf(
      ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_UUID)).build()
    )
    val settings = ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
      .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
      .build()

    val cb = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) {
        handleScanResult(result)
      }

      override fun onBatchScanResults(results: MutableList<ScanResult>) {
        for (r in results) handleScanResult(r)
      }

      override fun onScanFailed(errorCode: Int) {
        emitError("BLE scan failed: errorCode=$errorCode", "scan_failed")
      }
    }

    try {
      s.startScan(filters, settings, cb)
    } catch (e: SecurityException) {
      emitError("Missing BLUETOOTH_SCAN permission", "permission_denied")
      return
    }
    withState {
      this.scanner = s
      this.scanCallback = cb
    }

    // Spawn the peer-lost reaper.
    val job = scope.launch { runPeerLostReaper() }
    withState { this.peerLostJob = job }
  }

  override fun stopBrowsing() {
    val (sc, cb, job) = withState {
      val a = scanner
      val b = scanCallback
      val c = peerLostJob
      scanner = null
      scanCallback = null
      peerLostJob = null
      foundPeers.clear()
      Triple(a, b, c)
    }
    job?.cancel()
    if (sc != null && cb != null) {
      try { sc.stopScan(cb) } catch (e: Exception) {
        Log.w(TAG, "stopScan failed", e)
      }
    }
  }

  private fun handleScanResult(result: ScanResult) {
    val device = result.device ?: return
    val address = device.address ?: return
    val now = System.currentTimeMillis()
    val nameFromRecord = result.scanRecord?.deviceName
    val nameFromDevice = try { device.name } catch (_: SecurityException) { null }
    val displayName = nameFromRecord ?: nameFromDevice ?: address

    val isNew = withState {
      val existing = foundPeers[address]
      if (existing == null) {
        foundPeers[address] = FoundPeer(
          device = device,
          displayName = displayName,
          discoveryInfoJson = "{}",
          rssi = result.rssi,
          lastSeenAt = now,
        )
        true
      } else {
        existing.lastSeenAt = now
        existing.rssi = result.rssi
        existing.displayName = displayName
        false
      }
    }

    if (isNew) {
      // Fire peerFound immediately so the UI can show the peer; enrich via
      // GATT in the background.
      val peer = ProximityPeer(
        id = address,
        displayName = displayName,
        discoveryInfoJson = "{}",
        rssi = result.rssi.toDouble(),
        distance = null,
        direction = null,
      )
      emit(makeEvent(kind = ProximityEventKind.PEERFOUND, peer = peer, peerId = address))

      scope.launch { fetchPsmAndInfo(device, address, displayName, result.rssi) }
    }
  }

  private suspend fun runPeerLostReaper() {
    while (scope.isActive) {
      delay(2_000)
      val now = System.currentTimeMillis()
      val lost = withState {
        val stale = foundPeers.filterValues { now - it.lastSeenAt > PEER_LOST_TIMEOUT_MS }
        for (key in stale.keys) foundPeers.remove(key)
        stale.keys.toList()
      }
      for (id in lost) {
        emit(makeEvent(kind = ProximityEventKind.PEERLOST, peerId = id))
      }
    }
  }

  /**
   * Opportunistic GATT read of PSM + discovery info on a freshly-found peer.
   * Re-emits peerFound with the enriched info once the read completes.
   */
  private suspend fun fetchPsmAndInfo(
    device: BluetoothDevice,
    address: String,
    displayName: String,
    rssi: Int,
  ) {
    val result = readPsmAndInfo(device) ?: return
    val (psm, infoJson) = result
    val updatedDisplayName = withState {
      psmCache[address] = psm
      foundPeers[address]?.let {
        it.discoveryInfoJson = infoJson
        it.displayName
      } ?: displayName
    }
    val peer = ProximityPeer(
      id = address,
      displayName = updatedDisplayName,
      discoveryInfoJson = infoJson,
      rssi = rssi.toDouble(),
      distance = null,
      direction = null,
    )
    emit(makeEvent(kind = ProximityEventKind.PEERFOUND, peer = peer, peerId = address))
  }

  /**
   * Synchronous PSM + info GATT read with explicit timeout. Returns null on
   * any failure so the caller can decide how to surface the error.
   */
  private suspend fun readPsmAndInfo(device: BluetoothDevice): Pair<Int, String>? {
    val done = CompletableDeferred<Pair<Int, String>?>()
    // Single-slot holder so the inner BluetoothGattCallback can carry the
    // partially-read PSM across to the info char read.
    val psmHolder = java.util.concurrent.atomic.AtomicReference<Int?>(null)
    val gattRef = java.util.concurrent.atomic.AtomicReference<BluetoothGatt?>(null)

    val cb = object : BluetoothGattCallback() {
      override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
        gattRef.set(gatt)
        when (newState) {
          BluetoothProfile.STATE_CONNECTED -> {
            try { gatt.discoverServices() } catch (e: SecurityException) {
              if (done.isActive) done.complete(null)
              try { gatt.close() } catch (_: Exception) {}
            }
          }
          BluetoothProfile.STATE_DISCONNECTED -> {
            if (done.isActive) done.complete(null)
            try { gatt.close() } catch (_: Exception) {}
          }
        }
      }

      override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
        val service = gatt.getService(SERVICE_UUID) ?: run {
          if (done.isActive) done.complete(null)
          try { gatt.close() } catch (_: Exception) {}
          return
        }
        val psmChar = service.getCharacteristic(PSM_CHAR_UUID)
        if (psmChar == null) {
          if (done.isActive) done.complete(null)
          try { gatt.close() } catch (_: Exception) {}
          return
        }
        try { gatt.readCharacteristic(psmChar) } catch (e: SecurityException) {
          if (done.isActive) done.complete(null)
          try { gatt.close() } catch (_: Exception) {}
        }
      }

      @Deprecated("Pre-API-33 read callback; needed for back-compat.")
      override fun onCharacteristicRead(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        status: Int,
      ) {
        @Suppress("DEPRECATION")
        handleRead(gatt, characteristic, characteristic.value, status)
      }

      // API 33+ overload that ships the value as a parameter.
      override fun onCharacteristicRead(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        value: ByteArray,
        status: Int,
      ) {
        handleRead(gatt, characteristic, value, status)
      }

      private fun handleRead(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        value: ByteArray?,
        status: Int,
      ) {
        if (status != BluetoothGatt.GATT_SUCCESS) {
          if (done.isActive) done.complete(null)
          try { gatt.close() } catch (_: Exception) {}
          return
        }
        val bytes = value ?: ByteArray(0)
        when (characteristic.uuid) {
          PSM_CHAR_UUID -> {
            if (bytes.size >= 2) {
              val psm = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).short.toInt() and 0xFFFF
              psmHolder.set(psm)
            }
            val service = gatt.getService(SERVICE_UUID)
            val infoChar = service?.getCharacteristic(DISCOVERY_INFO_CHAR_UUID)
            if (infoChar != null) {
              try { gatt.readCharacteristic(infoChar) } catch (e: SecurityException) {
                finish(gatt, "{}")
              }
            } else {
              finish(gatt, "{}")
            }
          }
          DISCOVERY_INFO_CHAR_UUID -> {
            val json = bytes.toString(Charsets.UTF_8).ifBlank { "{}" }
            finish(gatt, json)
          }
        }
      }

      private fun finish(gatt: BluetoothGatt, infoJson: String) {
        val psm = psmHolder.get()
        if (psm != null) {
          if (done.isActive) done.complete(Pair(psm, infoJson))
        } else if (done.isActive) {
          done.complete(null)
        }
        try { gatt.close() } catch (_: Exception) {}
      }
    }

    val gatt = try {
      device.connectGatt(context, false, cb)
    } catch (e: SecurityException) {
      return null
    } ?: return null
    gattRef.set(gatt)

    val outcome = withTimeoutOrNull(PSM_FETCH_TIMEOUT_MS) { done.await() }
    if (outcome == null) {
      try { gattRef.get()?.close() } catch (_: Exception) {}
    }
    return outcome
  }

  // MARK: - Invitations (server-side accept/reject)

  override fun acceptInvitation(peerId: String) {
    val socket = withState { pendingIncomingSockets.remove(peerId) } ?: return
    withState { connectedSockets[peerId] = socket }
    emit(makeEvent(kind = ProximityEventKind.SESSIONESTABLISHED, peerId = peerId))
    startReader(peerId, socket)
  }

  override fun rejectInvitation(peerId: String) {
    val socket = withState { pendingIncomingSockets.remove(peerId) } ?: return
    try { socket.close() } catch (_: IOException) {}
  }

  // MARK: - Invite (client-side)

  override fun invitePeer(
    peerId: String,
    payload: ArrayBuffer,
    timeoutSec: Double,
  ): Promise<Boolean> = Promise.async {
    val payloadBytes = payload.toByteArray()
    val timeoutMs = (timeoutSec * 1000).toLong().coerceAtLeast(1_000)

    val deviceAndPsm = resolveDeviceAndPsm(peerId) ?: return@async false
    val (device, psm) = deviceAndPsm

    val socket = try {
      withTimeoutOrNull(timeoutMs) {
        withContext(Dispatchers.IO) {
          val s = try {
            device.createInsecureL2capChannel(psm)
          } catch (e: SecurityException) {
            null
          }
          s?.also {
            try { it.connect() } catch (e: IOException) {
              try { it.close() } catch (_: IOException) {}
              return@withContext null
            } catch (e: SecurityException) {
              try { it.close() } catch (_: IOException) {}
              return@withContext null
            }
          }
        }
      }
    } catch (e: Throwable) {
      Log.w(TAG, "L2CAP connect threw", e)
      null
    } ?: return@async false

    val output = try {
      socket.outputStream
    } catch (e: IOException) {
      try { socket.close() } catch (_: IOException) {}
      return@async false
    }

    try {
      writeFrame(output, payloadBytes)
    } catch (e: IOException) {
      try { socket.close() } catch (_: IOException) {}
      return@async false
    }

    withState { connectedSockets[peerId] = socket }
    emit(makeEvent(kind = ProximityEventKind.SESSIONESTABLISHED, peerId = peerId))
    startReader(peerId, socket)
    true
  }

  /**
   * Look up the BluetoothDevice + PSM for [peerId]. If we haven't cached
   * the PSM yet, attempt a synchronous GATT read with [PSM_FETCH_TIMEOUT_MS].
   */
  private suspend fun resolveDeviceAndPsm(peerId: String): Pair<BluetoothDevice, Int>? {
    val cached = withState {
      val device = foundPeers[peerId]?.device
      val psm = psmCache[peerId]
      if (device != null && psm != null) Pair(device, psm) else null
    }
    if (cached != null) return cached

    val device = withState { foundPeers[peerId]?.device } ?: run {
      // Try resolving from the adapter directly (last resort — may fail for unbonded peers).
      val adapter = bluetoothAdapter ?: return null
      try { adapter.getRemoteDevice(peerId) } catch (e: IllegalArgumentException) { return null }
    }

    val fetched = readPsmAndInfo(device) ?: return null
    withState { psmCache[peerId] = fetched.first }
    return Pair(device, fetched.first)
  }

  // MARK: - Data transfer

  override fun sendData(peerId: String, data: ArrayBuffer): Promise<Unit> = Promise.async {
    val bytes = data.toByteArray()
    val socket = withState { connectedSockets[peerId] } ?: throw IOException(
      "Peer not connected: $peerId"
    )
    val output = socket.outputStream
    withContext(Dispatchers.IO) { writeFrame(output, bytes) }
  }

  override fun disconnect(peerId: String) {
    val socket = withState {
      val s = connectedSockets.remove(peerId)
      readerJobs.remove(peerId)?.cancel()
      s
    }
    if (socket != null) {
      try { socket.close() } catch (_: IOException) {}
      emit(
        makeEvent(
          kind = ProximityEventKind.SESSIONENDED,
          peerId = peerId,
          reason = "localDisconnect",
        )
      )
    }
  }

  // MARK: - Reader coroutine per connected peer

  private fun startReader(peerId: String, socket: BluetoothSocket) {
    val job = scope.launch {
      val input = try {
        socket.inputStream
      } catch (e: IOException) {
        cleanupAfterReader(peerId, socket, reason = "ioError")
        return@launch
      }
      try {
        while (isActive) {
          val frame = readFrame(input) ?: break
          emit(
            makeEvent(
              kind = ProximityEventKind.DATARECEIVED,
              peerId = peerId,
              data = ArrayBuffer.copy(frame),
            )
          )
        }
        cleanupAfterReader(peerId, socket, reason = "remoteClosed")
      } catch (e: IOException) {
        cleanupAfterReader(peerId, socket, reason = "ioError")
      }
    }
    withState { readerJobs[peerId] = job }
  }

  private fun cleanupAfterReader(peerId: String, socket: BluetoothSocket, reason: String) {
    val wasConnected = withState {
      val removed = connectedSockets.remove(peerId)
      readerJobs.remove(peerId)
      removed != null
    }
    try { socket.close() } catch (_: IOException) {}
    if (wasConnected) {
      emit(makeEvent(kind = ProximityEventKind.SESSIONENDED, peerId = peerId, reason = reason))
    }
  }

  // MARK: - Framing helpers (2-byte big-endian length + payload)

  private fun writeFrame(out: OutputStream, payload: ByteArray) {
    if (payload.size > 0xFFFF) {
      throw IOException("Frame too large: ${payload.size} bytes (max 65535)")
    }
    val header = ByteBuffer
      .allocate(2)
      .order(ByteOrder.BIG_ENDIAN)
      .putShort(payload.size.toShort())
      .array()
    out.write(header)
    out.write(payload)
    out.flush()
  }

  /** Returns null on EOF (clean stream close). Throws IOException on partial read. */
  private fun readFrame(input: InputStream): ByteArray? {
    val header = ByteArray(2)
    if (!readFully(input, header, 2)) return null
    val len = ByteBuffer.wrap(header).order(ByteOrder.BIG_ENDIAN).short.toInt() and 0xFFFF
    if (len == 0) return ByteArray(0)
    val payload = ByteArray(len)
    if (!readFully(input, payload, len)) {
      throw IOException("Unexpected EOF reading frame payload (expected $len bytes)")
    }
    return payload
  }

  /** Returns false iff EOF hit before any byte arrived (clean stream close). */
  private fun readFully(input: InputStream, buf: ByteArray, len: Int): Boolean {
    var read = 0
    while (read < len) {
      val n = try {
        input.read(buf, read, len - read)
      } catch (e: IOException) {
        if (read == 0) return false
        throw e
      }
      if (n < 0) {
        if (read == 0) return false
        throw IOException("Unexpected EOF after $read/$len bytes")
      }
      read += n
    }
    return true
  }

  // MARK: - UWB ranging
  //
  // Mirrors HybridProximity.swift's NISession lifecycle: we own the
  // androidx.core.uwb controlee session per peer, but the wire-level
  // exchange of the peer's UwbAddress + UwbComplexChannel rides on the
  // already-established L2CAP channel via sendData/dataReceived. The JS
  // layer drives that negotiation (same as iOS NI discovery tokens) and
  // then asks us to start the ranging Flow.
  //
  // Because the Nitro spec doesn't expose `setUwbPeer(...)` today, we
  // create the session scope on startRanging so the underlying UWB
  // service stays bound and emit distanceUpdate events lazily once a
  // collection job is started by a higher-level Kotlin entry point (none
  // shipping yet). This matches the Swift impl, which also stores the
  // NISession in `niSessions` and waits for the JS layer to drive the
  // token exchange before any distance event fires.

  /**
   * Returns the lazily-created [UwbManager] iff the platform is API 31+
   * and a manager could be instantiated. Returns null and emits a
   * one-shot `uwb_unavailable` error event otherwise.
   */
  private fun uwbManagerOrNull(): UwbManager? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      maybeEmitUwbUnavailable(
        "UWB requires API 31+; current=${Build.VERSION.SDK_INT}"
      )
      return null
    }
    uwbManager?.let { return it }
    return synchronized(this) {
      uwbManager ?: try {
        UwbManager.createInstance(context).also { uwbManager = it }
      } catch (e: Throwable) {
        // createInstance can throw on devices without UWB system service
        // (some OEM builds report API 31+ but lack the framework class).
        maybeEmitUwbUnavailable(
          "UwbManager.createInstance failed: ${e.javaClass.simpleName}: ${e.message}"
        )
        null
      }
    }
  }

  /** Emit `uwb_unavailable` at most once per HybridProximity instance lifetime. */
  private fun maybeEmitUwbUnavailable(message: String) {
    val shouldEmit = withState {
      if (uwbUnavailableNotified) {
        false
      } else {
        uwbUnavailableNotified = true
        true
      }
    }
    if (shouldEmit) emitError(message, "uwb_unavailable")
  }

  override fun startRanging(peerId: String): Promise<Unit> = Promise.async {
    // Idempotent: if a session for this peer already exists, no-op so the
    // JS layer can safely call startRanging on resume/reconnect.
    val existing = withState { uwbSessions[peerId] }
    if (existing != null) return@async

    val manager = uwbManagerOrNull() ?: return@async

    val available = try {
      manager.isAvailable()
    } catch (e: Throwable) {
      Log.w(TAG, "UwbManager.isAvailable() threw for peer=$peerId", e)
      maybeEmitUwbUnavailable(
        "UwbManager.isAvailable threw: ${e.javaClass.simpleName}: ${e.message}"
      )
      return@async
    }
    if (!available) {
      maybeEmitUwbUnavailable("UWB hardware not currently available")
      return@async
    }

    val sessionScope = try {
      // We default to controlee — the iOS NISession is also symmetric on
      // discovery-token exchange and either side can act as the responder.
      // If a future spec change adds setRangingRole, we can branch here.
      manager.controleeSessionScope()
    } catch (e: SecurityException) {
      emitError(
        "Missing UWB_RANGING permission: ${e.message}",
        "permission_denied",
      )
      return@async
    } catch (e: Throwable) {
      Log.w(TAG, "controleeSessionScope() failed for peer=$peerId", e)
      emitError(
        "controleeSessionScope failed: ${e.javaClass.simpleName}: ${e.message}",
        "uwb_session_failed",
      )
      return@async
    }

    withState { uwbSessions[peerId] = UwbSession(scope = sessionScope) }
    // Distance events fire once a collection job is started against
    // `sessionScope.prepareSession(...)` with the peer's RangingParameters.
    // That requires the peer's UwbAddress (and, for controller mode, the
    // UwbComplexChannel) which the JS layer exchanges over L2CAP. The
    // Swift side has the same shape — NISession is created here, the
    // discovery-token round-trip lives in TS.
  }

  override fun stopRanging(peerId: String) {
    val removed = withState { uwbSessions.remove(peerId) } ?: return
    removed.collectorJob?.cancel()
    // UwbControleeSessionScope has no explicit close(); cancelling the
    // collection job tears down the underlying RangingSession. Dropping
    // the reference lets the manager release its binding.
  }

  /**
   * Internal hook for a future JS bridge: once the TS layer has the peer's
   * UwbAddress + RangingParameters, it can dispatch them here to start the
   * RangingResult Flow. Distance/direction are forwarded as `distanceUpdate`
   * events matching the iOS NISession callbacks 1:1. Not exposed via the
   * Nitro spec yet; kept private and wired through `addControleeRanging`
   * once the spec grows a setter.
   */
  @Suppress("unused")
  private fun startControleeRangingCollection(
    peerId: String,
    parameters: androidx.core.uwb.RangingParameters,
  ) {
    val session = withState { uwbSessions[peerId] }
    if (session == null) {
      Log.w(TAG, "startControleeRangingCollection: no session for peer=$peerId")
      return
    }
    val job = scope.launch {
      try {
        session.scope.prepareSession(parameters).collect { result ->
          when (result) {
            is RangingResult.RangingResultPosition -> {
              val pos = result.position
              val distance = pos.distance?.value?.toDouble()
              val azimuth = pos.azimuth?.value?.toDouble()
              val elevation = pos.elevation?.value?.toDouble()
              val direction = if (azimuth != null || elevation != null) {
                // androidx.core.uwb reports azimuth/elevation in degrees;
                // iOS NearbyInteraction emits a unit vector. We forward the
                // raw degree values in x (azimuth) / y (elevation) so the
                // JS layer can normalize per-platform. z is unused on
                // Android (RangingPosition has no roll component).
                ProximityDirection(
                  x = azimuth ?: 0.0,
                  y = elevation ?: 0.0,
                  z = 0.0,
                )
              } else null
              emit(
                makeEvent(
                  kind = ProximityEventKind.DISTANCEUPDATE,
                  peerId = peerId,
                  distance = distance,
                  direction = direction,
                )
              )
            }
            is RangingResult.RangingResultPeerDisconnected -> {
              emit(
                makeEvent(
                  kind = ProximityEventKind.SESSIONENDED,
                  peerId = peerId,
                  reason = "uwbPeerDisconnected:${result.reason}",
                )
              )
            }
            else -> {
              // RangingResultInitialized arrives once before the first
              // position fix; nothing to forward. Future RangingResult
              // subtypes (e.g. failure variants) fall through here too —
              // we'd rather no-op than surface an unstable shape to JS.
            }
          }
        }
      } catch (e: CancellationException) {
        throw e
      } catch (e: Throwable) {
        Log.w(TAG, "UWB ranging flow threw for peer=$peerId", e)
        emitError(
          "UWB ranging flow failed: ${e.javaClass.simpleName}: ${e.message}",
          "uwb_ranging_failed",
        )
      }
    }
    withState { uwbSessions[peerId]?.collectorJob = job }
  }

  // MARK: - Transport selection

  /**
   * Transport selector. Android only has the BLE/L2CAP transport — there is
   * no MultipeerConnectivity peer on this platform — so `multipeer` and `ble`
   * and `auto` all resolve to the same BLE path. We keep the call as a no-op
   * (rather than throwing) so the cross-platform JS layer can set the mode
   * uniformly; the iOS side is where `multipeer` actually swaps transports.
   */
  override fun setTransportMode(mode: String) {
    // Intentionally a no-op: BLE is the only Android transport. Logged so the
    // selection is visible when debugging cross-device sessions.
    Log.i(TAG, "setTransportMode($mode) — Android always uses BLE/L2CAP")
  }

  // MARK: - Listener registration

  override fun addEventListener(handler: (ProximityEvent) -> Unit): () -> Unit {
    val id = UUID.randomUUID()
    withState { listeners[id] = handler }
    return {
      withState { listeners.remove(id) }
      Unit
    }
  }
}
