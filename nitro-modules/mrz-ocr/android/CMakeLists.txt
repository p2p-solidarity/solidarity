#
# CMakeLists.txt
# @solidarity/nitro-mrz-ocr (Android)
#
# Mirrors nfc-passport: pull in nitrogen-generated sources via the
# autolinking cmake, expose the MrzOcr shared library that loadLibrary()
# looks up at runtime (see MrzOcrOnLoad.kt → System.loadLibrary("MrzOcr")).
#
project(MrzOcr)
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME MrzOcr)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

# Define the shared library up-front so the nitrogen autolinking script
# can target_sources(...) into it.
add_library(${PACKAGE_NAME} SHARED dummy.cpp)

# Add Nitrogen specs — adds C++ sources to the MrzOcr target, finds
# fbjni / ReactAndroid / react-native-nitro-modules, and links them.
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/MrzOcr+autolinking.cmake)

find_library(LOG_LIB log)

# VisionCamera publishes its native headers + .so via prefab. We need its
# HybridFrameSpec.hpp at compile time because the nitrogen-generated
# HybridMrzOcrSpec.hpp includes it. Mirrors react-native-vision-camera-barcode-scanner.
find_package(react-native-vision-camera REQUIRED CONFIG)

target_link_libraries(
  ${PACKAGE_NAME}
  ${LOG_LIB}
  android
  react-native-vision-camera::VisionCamera
)
