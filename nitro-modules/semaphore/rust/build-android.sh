#!/usr/bin/env bash
#
# build-android.sh — build libsemaphore_bindings.so for all Android ABIs
# we ship and drop the artefacts under
#   nitro-modules/semaphore/android/src/main/jniLibs/<abi>/
# so the gradle build's `jniLibs.srcDir` picks them up automatically.
#
# Also runs `uniffi-bindgen` against a host-built dylib to regenerate the
# Kotlin wrapper into
#   nitro-modules/semaphore/android/src/main/java/uniffi/semaphore_bindings/
# (read at runtime by `NativeBridge.kt`'s reflection layer).
#
# Requirements:
#   - Rust toolchain (cargo, rustup) + Android targets:
#       rustup target add aarch64-linux-android x86_64-linux-android armv7-linux-androideabi
#   - `cargo-ndk` (https://github.com/bbqsrc/cargo-ndk):
#       cargo install cargo-ndk
#   - Android NDK on PATH or $ANDROID_NDK_HOME set (NDK r25b+ recommended).
#   - macOS hosts: a perl with the `warnings::register` + `strict` standard
#     modules. The Apple system perl on macOS Tahoe (15.x) ships with
#     `strict` but the OpenSSL Configure script also touches `warnings::register`;
#     install `brew install perl` if the vendored OpenSSL build complains
#     about missing perl modules. Linux CI hosts (Ubuntu / Fedora) already
#     ship a complete perl.
#
# Usage:
#   bash build-android.sh                          # builds all three ABIs
#   ANDROID_ABIS=arm64-v8a bash build-android.sh   # device-only
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUST_DIR="${SCRIPT_DIR}"
JNI_DIR="${PROJECT_ROOT}/android/src/main/jniLibs"
KOTLIN_OUT="${PROJECT_ROOT}/android/src/main/java"

ANDROID_ABIS="${ANDROID_ABIS:-arm64-v8a,x86_64,armeabi-v7a}"
CONFIGURATION="${CONFIGURATION:-release}"
MIN_SDK="${ANDROID_MIN_SDK:-26}"

cd "${RUST_DIR}"

# Map Android ABIs → Rust targets (kept in sync with build.gradle's
# reactNativeArchitectures()). Uses a `case` statement instead of an
# associative array so this script keeps working on macOS's stock bash 3.2.
abi_to_triple() {
  case "$1" in
    arm64-v8a)     echo "aarch64-linux-android" ;;
    x86_64)        echo "x86_64-linux-android" ;;
    armeabi-v7a)   echo "armv7-linux-androideabi" ;;
    x86)           echo "i686-linux-android" ;;
    *)             return 1 ;;
  esac
}

IFS=',' read -ra ABIS <<< "${ANDROID_ABIS}"

echo "[semaphore] Installing Android Rust targets..."
for abi in "${ABIS[@]}"; do
  triple="$(abi_to_triple "${abi}")" || { echo "Unknown ABI: ${abi}"; exit 1; }
  rustup target add "${triple}" >/dev/null
done

if ! command -v cargo-ndk >/dev/null; then
  echo "[semaphore] cargo-ndk not installed. Run: cargo install cargo-ndk"
  exit 1
fi

if [ -z "${ANDROID_NDK_HOME:-}" ] && [ -z "${ANDROID_NDK_ROOT:-}" ]; then
  default_ndk=""
  for d in "${HOME}/Library/Android/sdk/ndk"/* "${HOME}/Android/Sdk/ndk"/*; do
    [ -d "${d}" ] && default_ndk="${d}"
  done
  if [ -n "${default_ndk}" ]; then
    export ANDROID_NDK_HOME="${default_ndk}"
    echo "[semaphore] ANDROID_NDK_HOME defaulted to ${ANDROID_NDK_HOME}"
  else
    echo "[semaphore] ANDROID_NDK_HOME is not set and no NDK found under ~/Library/Android/sdk/ndk or ~/Android/Sdk/ndk."
    echo "[semaphore] Install an NDK via Android Studio (SDK Manager → SDK Tools → NDK) or set ANDROID_NDK_HOME explicitly."
    exit 1
  fi
fi

echo "[semaphore] Compiling for ABIs: ${ANDROID_ABIS}"
NDK_ARGS=()
for abi in "${ABIS[@]}"; do
  NDK_ARGS+=(-t "${abi}")
done

# The cross-compile pulls in a vendored OpenSSL build via upstream
# semaphore-protocol → reqwest → native-tls; that step shells out to perl
# and needs the standard `strict` + `warnings::register` modules. On a
# Mac without `brew install perl` this fails with a clear error from
# `openssl-src`. Surface that as a hard build failure (not a silent
# fallback to a stub .so).
if ! cargo ndk "${NDK_ARGS[@]}" \
  -o "${JNI_DIR}" \
  --platform "${MIN_SDK}" \
  build --${CONFIGURATION} --lib; then
  echo "[semaphore] cargo-ndk build failed. Common causes:"
  echo "  • OpenSSL vendored build (perl missing modules) — run \`brew install perl\`."
  echo "  • Missing NDK toolchain — install with Android Studio's SDK Manager."
  echo "  • Stale target dir — run \`cargo clean\` from ${RUST_DIR}."
  exit 1
fi

# ──────────────────────────────────────────────────────────────────────────
# Generate the Kotlin uniffi wrapper from a host-built dylib. We build
# `uniffi-bindgen` as a bin target inside this crate (see
# `src/bin/uniffi-bindgen.rs`) so the version always matches the runtime
# library we just compiled.
# ──────────────────────────────────────────────────────────────────────────
echo "[semaphore] Generating Kotlin uniffi wrapper..."
HOST_DYLIB="${RUST_DIR}/target/${CONFIGURATION}/libsemaphore_bindings.dylib"
if [ ! -f "${HOST_DYLIB}" ]; then
  cargo build --${CONFIGURATION} --lib
fi

cargo run --bin uniffi-bindgen --${CONFIGURATION} -- generate \
  --library "${HOST_DYLIB}" \
  --language kotlin \
  --out-dir "${KOTLIN_OUT}"

echo "[semaphore] Android build complete:"
ls -la "${JNI_DIR}"/*/libsemaphore_bindings.so 2>/dev/null || \
  echo "  (no .so produced — check cargo-ndk output)"
echo "[semaphore] Kotlin wrapper:"
ls -la "${KOTLIN_OUT}/uniffi/semaphore_bindings/" 2>/dev/null || \
  echo "  (no Kotlin wrapper produced — check uniffi-bindgen output)"
