#
# CMakeLists.txt
# @solidarity/nitro-passport-zk (Android)
#
# Wires the C++ side of the Nitro module. Mirrors the airdrop / proximity
# layout: pull in nitrogen-generated sources via the autolinking cmake, expose
# the PassportZK shared library that loadLibrary() looks up at runtime
# (see PassportZKOnLoad.kt → System.loadLibrary("PassportZK")).
#
project(PassportZK)
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME PassportZK)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

# Define the shared library up-front so the nitrogen autolinking script
# can target_sources(...) into it.
add_library(${PACKAGE_NAME} SHARED dummy.cpp)

# Add Nitrogen specs — adds C++ sources to the PassportZK target, finds
# fbjni / ReactAndroid / react-native-nitro-modules, and links them.
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/PassportZK+autolinking.cmake)

find_library(LOG_LIB log)

target_link_libraries(
  ${PACKAGE_NAME}
  ${LOG_LIB}
  android
)

# ─────────────────────────────────────────────────────────────────────
# libcxx_stream_shim.so — VTT workaround for NDK r25+ libc++ ABI clash
# with libpassport_zk_mopro.so. See src/main/cpp/cxx_stream_shim.cpp
# for the full explanation. HybridPassportZk.kt's companion init
# preloads this .so before JNA lazy-loads the mopro cdylib.
# ─────────────────────────────────────────────────────────────────────
add_library(cxx_stream_shim SHARED src/main/cpp/cxx_stream_shim.cpp)

# Override the project-wide -fvisibility=hidden (set on the Rust /
# barretenberg cdylib via cc-rs). With default visibility the explicit
# template instantiations land in the dynamic symbol table where the
# loader can find them at dlopen time. -O0 prevents -O2 / LTO from
# dead-stripping the vtables before the linker emits them.
#
# Critical: barretenberg-rs was compiled against an upstream libc++
# that uses the `__1` inline namespace; the active NDK r27's libc++
# uses `__ndk1` (its Android fork). Without forcing the namespace, our
# explicit instantiations would mangle as `St6__ndk1…` and never satisfy
# mopro's `St3__1…` undefined references. The `-D_LIBCPP_ABI_NAMESPACE=__1`
# and `-D_LIBCPP_ABI_VERSION=1` defines flip the headers back to the
# upstream namespace for THIS TU only, so the produced symbols match
# what dlopen is looking for at byte level.
#
# `-include` forces the macros to be set before any libc++ header is
# included even if the .cpp itself forgets; safer than relying on
# include ordering.
target_compile_options(cxx_stream_shim PRIVATE
  -fvisibility=default
  -fvisibility-inlines-hidden
  -O0
  -fno-lto
)

# Link against libc++_shared.so explicitly so the shim is self-contained.
target_link_libraries(cxx_stream_shim ${LOG_LIB})
