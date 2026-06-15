#
# CMakeLists.txt
# @solidarity/nitro-secrets-vault (Android)
#
# Wires the C++ side of the Nitro module. Mirrors the cloudkit / nfc-passport
# layout: pull in nitrogen-generated sources via the autolinking cmake, expose
# the SecretsVault shared library that loadLibrary() looks up at runtime
# (see SecretsVaultOnLoad.kt → System.loadLibrary("SecretsVault")).
#
project(SecretsVault)
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME SecretsVault)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

# Define the shared library up-front so the nitrogen autolinking script can
# target_sources(...) into it.
add_library(${PACKAGE_NAME} SHARED dummy.cpp)

# Add Nitrogen specs — adds C++ sources to the SecretsVault target, finds
# fbjni / ReactAndroid / react-native-nitro-modules, and links them.
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/SecretsVault+autolinking.cmake)

find_library(LOG_LIB log)

target_link_libraries(
  ${PACKAGE_NAME}
  ${LOG_LIB}
  android
)
