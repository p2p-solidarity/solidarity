/*
 * HybridNfcPassport.kt
 * @solidarity/nitro-nfc-passport (Android)
 *
 * Wraps jmrtd for ICAO 9303 passport reading. Implements the
 * Nitrogen-generated HybridNfcPassportSpec abstract class.
 */
package gg.solidarity.nfcpassport

import com.margelo.nitro.core.Promise
import com.margelo.nitro.gg.solidarity.nfcpassport.HybridNfcPassportSpec
import com.margelo.nitro.gg.solidarity.nfcpassport.PassportMRZ
import com.margelo.nitro.gg.solidarity.nfcpassport.PassportReadResult

class HybridNfcPassport : HybridNfcPassportSpec() {

  override fun isAvailable(): Boolean = false  // flip to true once jmrtd is linked

  override fun read(mrz: PassportMRZ): Promise<PassportReadResult> = Promise.async {
    throw UnsupportedOperationException(
      "Android NFC passport read not linked yet — add jmrtd dependency first"
    )
  }

  override fun cancel() { /* no-op stub */ }
}
