// cpp-adapter — defines the JNI_OnLoad that the Android dynamic linker calls
// when SolidaritySecretsVaultPackage's companion init triggers
// `System.loadLibrary("SecretsVault")`. Nitrogen's generated `SecretsVaultOnLoad.cpp`
// only exposes `registerAllNatives()`; without a JNI_OnLoad pointing at it,
// the HybridObject never lands in the registry
// (mirrors react-native-mmkv/android/src/main/cpp/cpp-adapter.cpp).
#include "SecretsVaultOnLoad.hpp"
#include <fbjni/fbjni.h>
#include <jni.h>

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::solidarity::secretsvault::registerAllNatives();
  });
}
