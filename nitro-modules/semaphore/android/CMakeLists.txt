#
# CMakeLists.txt
# @solidarity/nitro-semaphore (Android)
#
# Wires the C++ side of the Nitro module. Mirrors the react-native-mmkv
# layout (and our sibling nitro-modules/proximity/android/CMakeLists.txt):
# define the shared library up-front, then let the nitrogen autolinking
# cmake append its own sources via target_sources(). The hand-written
# HybridSemaphore.kt + Rust libsemaphore_bindings.so are bundled via
# gradle's jniLibs.srcDirs, so no extra C++ sources are needed here.
#
project(Semaphore)
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME Semaphore)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

add_library(${PACKAGE_NAME} SHARED dummy.cpp)

include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/Semaphore+autolinking.cmake)

find_library(LOG_LIB log)

target_link_libraries(
  ${PACKAGE_NAME}
  ${LOG_LIB}
  android
)
