// cpp-adapter — defines the JNI_OnLoad that the Android dynamic linker calls
// when the airdrop Package's companion init triggers
// `System.loadLibrary("Airdrop")`. Nitrogen's generated `AirdropOnLoad.cpp`
// only exposes `registerAllNatives()`; without a JNI_OnLoad pointing at it,
// the HybridObject never lands in the registry
// (mirrors react-native-mmkv/android/src/main/cpp/cpp-adapter.cpp).
#include "AirdropOnLoad.hpp"
#include <fbjni/fbjni.h>
#include <jni.h>

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::solidarity::airdrop::registerAllNatives();
  });
}
