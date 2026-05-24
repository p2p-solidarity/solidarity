/*
 * SolidarityProximityPackage.kt
 * @solidarity/nitro-proximity (Android)
 *
 * BaseReactPackage shim. Has no JS-visible modules of its own — its sole
 * purpose is:
 *   1. Give React Native autolinker a packageImportPath / packageInstance
 *      pair (so `autolinkLibrariesWithApp()` discovers us).
 *   2. Trigger SolidarityProximityOnLoad.initializeNative() in the class
 *      initializer so the nitrogen-generated JNI registers the
 *      "Proximity" HybridObject before JS imports it.
 */
package com.margelo.nitro.gg.solidarity.proximity

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider

class SolidarityProximityPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null
  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider { emptyMap() }

  companion object {
    init {
      SolidarityProximityOnLoad.initializeNative()
    }
  }
}
