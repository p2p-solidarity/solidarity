// cpp-adapter — defines the JNI_OnLoad that the Android dynamic linker calls
// when SolidarityMrzOcrPackage's companion init triggers
// `System.loadLibrary("MrzOcr")`. Nitrogen's generated `MrzOcrOnLoad.cpp`
// only exposes `registerAllNatives()`; without a JNI_OnLoad pointing at it,
// the HybridObject never lands in the registry.
#include "MrzOcrOnLoad.hpp"
#include <fbjni/fbjni.h>
#include <jni.h>

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::solidarity::mrzocr::registerAllNatives();
  });
}
