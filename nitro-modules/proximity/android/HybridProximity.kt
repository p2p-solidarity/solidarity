/*
 * HybridProximity.kt
 * @solidarity/nitro-proximity (Android)
 *
 * Wraps Google Nearby Connections + Android UWB API 31+ behind the
 * Nitrogen-generated HybridProximitySpec abstract class.
 */
package gg.solidarity.proximity

import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import com.margelo.nitro.gg.solidarity.proximity.HybridProximitySpec
import com.margelo.nitro.gg.solidarity.proximity.ProximityEvent
import java.util.concurrent.ConcurrentHashMap

class HybridProximity : HybridProximitySpec() {

  private val listeners = ConcurrentHashMap<Int, (ProximityEvent) -> Unit>()
  private var nextId = 0

  override fun startAdvertising(
    displayName: String,
    serviceType: String,
    discoveryInfoJson: String,
  ) { /* TODO: nearby.startAdvertising */ }

  override fun stopAdvertising() { /* no-op stub */ }
  override fun startBrowsing(serviceType: String) { /* no-op stub */ }
  override fun stopBrowsing() { /* no-op stub */ }

  override fun invitePeer(
    peerId: String, payload: ArrayBuffer, timeoutSec: Double,
  ): Promise<Boolean> = Promise.async { false }

  override fun acceptInvitation(peerId: String) {}
  override fun rejectInvitation(peerId: String) {}
  override fun sendData(peerId: String, data: ArrayBuffer): Promise<Unit> =
    Promise.async { Unit }
  override fun disconnect(peerId: String) {}

  override fun startRanging(peerId: String): Promise<Unit> = Promise.async { Unit }
  override fun stopRanging(peerId: String) {}

  override fun addEventListener(handler: (ProximityEvent) -> Unit): () -> Unit {
    val id = synchronized(this) { nextId++ }
    listeners[id] = handler
    return { listeners.remove(id) }
  }
}
