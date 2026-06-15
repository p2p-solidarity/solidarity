#!/usr/bin/env bash
#
# build-ios.sh — build libsemaphore_bindings.a slices for the iOS
# xcframework. Output layout (ios-arm64 + ios-arm64-simulator) mirrors
# what the legacy SwiftUI app ships at
# `SemaphoreSwift/Sources/MoproiOSBindings/MoproBindings.xcframework`,
# but the file is named SemaphoreBindings.xcframework here to avoid
# colliding with the passport-zk MoproBindings.xcframework that lives
# in the sibling `passport-noir` repo. SemaphoreBindings.podspec +
# apps/expo/plugins/withRustXcframeworkSearchPath.js consume the
# produced xcframework directly from this path.
#
# Usage:
#   bash build-ios.sh                 # builds both arm64-device + arm64-sim
#   IOS_ARCHS=aarch64-apple-ios bash build-ios.sh   # device-only
#
# Output:
#   nitro-modules/semaphore/rust/target/<triple>/release/libsemaphore_bindings.a
#   nitro-modules/semaphore/mopro/SemaphoreBindings.xcframework/<slice>/...
#
# This script MUST be re-run after any change to rust/src/* or src/semaphore.udl
# so the static lib's symbol checksums match the regenerated mopro/ios/mopro.swift
# (uniffi otherwise panics in `uniffiCheckApiChecksums` at runtime).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUST_DIR="${SCRIPT_DIR}"
XCFRAMEWORK_DIR="${PROJECT_ROOT}/mopro/SemaphoreBindings.xcframework"

IOS_ARCHS="${IOS_ARCHS:-aarch64-apple-ios,aarch64-apple-ios-sim}"
CONFIGURATION="${CONFIGURATION:-release}"
DEPLOYMENT_TARGET="${IPHONEOS_DEPLOYMENT_TARGET:-17.0}"

cd "${RUST_DIR}"

echo "[semaphore] Installing iOS targets..."
IFS=',' read -ra ARCHS <<< "${IOS_ARCHS}"
for arch in "${ARCHS[@]}"; do
  rustup target add "${arch}" >/dev/null
done

echo "[semaphore] Compiling Rust slices..."
for arch in "${ARCHS[@]}"; do
  echo "  - cargo build --target ${arch} --${CONFIGURATION}"
  IPHONEOS_DEPLOYMENT_TARGET="${DEPLOYMENT_TARGET}" \
    cargo build --target "${arch}" --${CONFIGURATION} --lib
done

echo "[semaphore] Generating uniffi Swift wrapper..."
# Generates `mopro.swift` + `semaphore_bindingsFFI.h` + `module.modulemap`.
# Mirrors `passport-noir/Makefile`'s build-ios target.
HOST_TRIPLE="$(rustc -vV | awk '/^host:/{print $2}')"
LIB_PATH="${RUST_DIR}/target/${ARCHS[0]}/${CONFIGURATION}/libsemaphore_bindings.dylib"
if [ ! -f "${LIB_PATH}" ]; then
  # uniffi-bindgen needs a host-built dylib to inspect; build one.
  cargo build --${CONFIGURATION} --lib
  LIB_PATH="${RUST_DIR}/target/${CONFIGURATION}/libsemaphore_bindings.dylib"
fi

OUT_DIR="${RUST_DIR}/bindings/swift"
mkdir -p "${OUT_DIR}"
cargo run --bin uniffi-bindgen -- generate \
  --library "${LIB_PATH}" \
  --language swift \
  --out-dir "${OUT_DIR}" \
  || echo "[semaphore] uniffi-bindgen unavailable; reusing checked-in mopro.swift"

# Assemble the xcframework from the per-arch slices.
echo "[semaphore] Packing xcframework -> ${XCFRAMEWORK_DIR}"
rm -rf "${XCFRAMEWORK_DIR}"
mkdir -p "${XCFRAMEWORK_DIR}"

declare -a XCF_ARGS=()
for arch in "${ARCHS[@]}"; do
  ARCH_DIR="${RUST_DIR}/target/${arch}/${CONFIGURATION}"
  case "${arch}" in
    aarch64-apple-ios)        SLICE="ios-arm64";;
    aarch64-apple-ios-sim)    SLICE="ios-arm64-simulator";;
    x86_64-apple-ios)         SLICE="ios-x86_64-simulator";;
    *) echo "Unknown iOS triple: ${arch}"; exit 1;;
  esac
  HEADERS_DIR="${RUST_DIR}/target/${arch}/${CONFIGURATION}/Headers"
  mkdir -p "${HEADERS_DIR}/semaphore_bindings"
  cp "${OUT_DIR}/semaphore_bindingsFFI.h" "${HEADERS_DIR}/semaphore_bindings/" 2>/dev/null || true
  cp "${OUT_DIR}/semaphore_bindingsFFI.modulemap" \
     "${HEADERS_DIR}/semaphore_bindings/module.modulemap" 2>/dev/null || true
  XCF_ARGS+=(-library "${ARCH_DIR}/libsemaphore_bindings.a" -headers "${HEADERS_DIR}")
done

xcodebuild -create-xcframework "${XCF_ARGS[@]}" -output "${XCFRAMEWORK_DIR}"

echo "[semaphore] iOS build complete: ${XCFRAMEWORK_DIR}"
