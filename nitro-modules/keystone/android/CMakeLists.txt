#
# CMakeLists.txt
# @solidarity/nitro-keystone (Android)
#
# Wires the C++ side of the Nitro module. Pulls in nitrogen-generated
# sources via the autolinking cmake and exposes the Keystone shared library
# that loadLibrary() looks up at runtime (see KeystoneOnLoad.kt →
# System.loadLibrary("Keystone")).
#
project(Keystone)
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME Keystone)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

# Define the shared library up-front so the nitrogen autolinking script can
# target_sources(...) into it.
add_library(${PACKAGE_NAME} SHARED dummy.cpp)

# Add Nitrogen specs — adds C++ sources to the Keystone target, finds
# fbjni / ReactAndroid / react-native-nitro-modules, and links them.
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/Keystone+autolinking.cmake)

find_library(LOG_LIB log)

target_link_libraries(
  ${PACKAGE_NAME}
  ${LOG_LIB}
  android
)
