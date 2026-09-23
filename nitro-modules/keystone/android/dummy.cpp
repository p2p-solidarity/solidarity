// cpp-adapter — defines the JNI_OnLoad that the Android dynamic linker calls
// when SolidarityKeystonePackage's companion init triggers
// `System.loadLibrary("Keystone")`. Nitrogen's generated `KeystoneOnLoad.cpp`
// only exposes `registerAllNatives()`; without a JNI_OnLoad pointing at it,
// the HybridObjects never land in the registry
// (mirrors react-native-mmkv/android/src/main/cpp/cpp-adapter.cpp).
#include "KeystoneOnLoad.hpp"
#include <fbjni/fbjni.h>
#include <jni.h>

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::solidarity::keystone::registerAllNatives();
  });
}
