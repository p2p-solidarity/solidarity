#
# CMakeLists.txt
# @solidarity/nitro-cloudkit (Android)
#
# Wires the C++ side. We follow the proximity layout: declare the shared
# library up-front so the nitrogen-generated cmake can target_sources(...)
# into it.
#
project(SolidarityCloudKit)
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME SolidarityCloudKit)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

add_library(${PACKAGE_NAME} SHARED dummy.cpp)

# Nitrogen autolinking — adds C++ sources, finds fbjni / ReactAndroid /
# react-native-nitro-modules, and links them.
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/SolidarityCloudKit+autolinking.cmake)

find_library(LOG_LIB log)

target_link_libraries(
  ${PACKAGE_NAME}
  ${LOG_LIB}
  android
)
