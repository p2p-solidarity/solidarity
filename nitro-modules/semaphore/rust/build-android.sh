#!/usr/bin/env bash
#
# build-android.sh — build libsemaphore_bindings.so for all Android ABIs
# we ship and drop the artefacts under
#   nitro-modules/semaphore/android/src/main/jniLibs/<abi>/
# so the gradle build's `jniLibs.srcDir` picks them up automatically.
#
# Requires `cargo-ndk` (https://github.com/bbqsrc/cargo-ndk) installed:
#   cargo install cargo-ndk
# and the Android NDK on PATH (or $ANDROID_NDK_HOME set).
#
# Usage:
#   bash build-android.sh             # builds all three ABIs
#   ANDROID_ABIS=arm64-v8a bash build-android.sh   # device-only
#
# We also generate the Kotlin uniffi wrapper into
#   nitro-modules/semaphore/android/src/main/java/uniffi/semaphore_bindings/
# so HybridSemaphore.kt can call `uniffi.semaphore_bindings.Identity(...)`
# directly.

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
# reactNativeArchitectures()).
declare -A ABI_TO_TRIPLE=(
  [arm64-v8a]=aarch64-linux-android
  [x86_64]=x86_64-linux-android
  [armeabi-v7a]=armv7-linux-androideabi
  [x86]=i686-linux-android
)

IFS=',' read -ra ABIS <<< "${ANDROID_ABIS}"

echo "[semaphore] Installing Android Rust targets..."
for abi in "${ABIS[@]}"; do
  triple="${ABI_TO_TRIPLE[$abi]:-}"
  [ -z "${triple}" ] && { echo "Unknown ABI: ${abi}"; exit 1; }
  rustup target add "${triple}" >/dev/null
done

if ! command -v cargo-ndk >/dev/null; then
  echo "[semaphore] cargo-ndk not installed. Run: cargo install cargo-ndk"
  exit 1
fi

echo "[semaphore] Compiling for ABIs: ${ANDROID_ABIS}"
NDK_ARGS=()
for abi in "${ABIS[@]}"; do
  NDK_ARGS+=(-t "${abi}")
done

cargo ndk "${NDK_ARGS[@]}" \
  -o "${JNI_DIR}" \
  --platform "${MIN_SDK}" \
  build --${CONFIGURATION} --lib

# Generate the Kotlin uniffi wrapper from the host-built dylib.
echo "[semaphore] Generating Kotlin uniffi wrapper..."
HOST_TRIPLE="$(rustc -vV | awk '/^host:/{print $2}')"
LIB_PATH="${RUST_DIR}/target/${CONFIGURATION}/libsemaphore_bindings.dylib"
if [ ! -f "${LIB_PATH}" ]; then
  cargo build --${CONFIGURATION} --lib
fi

cargo run --bin uniffi-bindgen -- generate \
  --library "${LIB_PATH}" \
  --language kotlin \
  --out-dir "${KOTLIN_OUT}" \
  || echo "[semaphore] uniffi-bindgen unavailable; checked-in wrapper retained"

echo "[semaphore] Android build complete:"
ls -la "${JNI_DIR}"/*/libsemaphore_bindings.so 2>/dev/null || \
  echo "  (no .so produced — check cargo-ndk output)"
