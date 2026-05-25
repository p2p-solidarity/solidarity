#!/usr/bin/env bash
#
# Build passport-zk-mopro for Android and drop the .so + UniFFI Kotlin
# bindings into this Nitro module's source tree.
#
# Why a script: the cdylib + barretenberg + noir compile to ~30 MB per
# ABI (~60 MB for arm64-v8a + x86_64) so we gitignore them and rebuild
# on demand instead of committing.
#
# Prereqs:
#   - Rust toolchain (rustup), nightly OK
#   - Android NDK installed (sets $ANDROID_NDK_HOME — defaults to the
#     bundled Android Studio one if unset)
#   - cargo-ndk:  cargo install cargo-ndk
#   - rust targets:
#       rustup target add aarch64-linux-android x86_64-linux-android
#
# Usage:
#   ./scripts/build-android.sh                  # both archs, release
#   ANDROID_ARCHS=aarch64-linux-android ./scripts/build-android.sh
#       # arm64 only — faster on a CI laptop
set -euo pipefail

# Resolve repo paths.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_DIR="$(cd "$MODULE_DIR/../.." && pwd)"
PASSPORT_NOIR_DIR="${PASSPORT_NOIR_DIR:-$WORKSPACE_DIR/../passport-noir}"
MOPRO_DIR="$PASSPORT_NOIR_DIR/mopro-binding"

if [[ ! -d "$MOPRO_DIR" ]]; then
  echo "passport-noir not found at $PASSPORT_NOIR_DIR" >&2
  echo "Clone it next to airmeishi or set PASSPORT_NOIR_DIR." >&2
  exit 1
fi

# Default both ABIs that ship into our APK; emulator users only need x86_64.
ANDROID_ARCHS="${ANDROID_ARCHS:-aarch64-linux-android,x86_64-linux-android}"
CONFIGURATION="${CONFIGURATION:-release}"
ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-$HOME/Library/Android/sdk/ndk/27.1.12297006}"

echo ">> Building passport-zk-mopro Android cdylib"
echo "   archs:  $ANDROID_ARCHS"
echo "   config: $CONFIGURATION"
echo "   ndk:    $ANDROID_NDK_HOME"

(
  cd "$MOPRO_DIR"
  ANDROID_NDK_HOME="$ANDROID_NDK_HOME" \
  ANDROID_NDK="$ANDROID_NDK_HOME" \
  ANDROID_HOME="$HOME/Library/Android/sdk" \
  ANDROID_ARCHS="$ANDROID_ARCHS" \
  CONFIGURATION="$CONFIGURATION" \
  cargo run --bin android --release
)

# Layout produced by `mopro_ffi::app_config::android::build()`:
#   $MOPRO_DIR/MoproAndroidBindings/jniLibs/<abi>/lib*.so
#   $MOPRO_DIR/MoproAndroidBindings/uniffi/mopro/mopro.kt
SRC_BINDINGS="$MOPRO_DIR/MoproAndroidBindings"
JNI_DEST="$MODULE_DIR/android/src/main/jniLibs"
KT_DEST="$MODULE_DIR/android/src/main/java/uniffi/mopro"

if [[ ! -d "$SRC_BINDINGS" ]]; then
  echo "Build did not produce $SRC_BINDINGS" >&2
  exit 2
fi

echo ">> Copying .so files into $JNI_DEST"
mkdir -p "$JNI_DEST"
rm -rf "$JNI_DEST"/*
cp -R "$SRC_BINDINGS/jniLibs/"* "$JNI_DEST/"

echo ">> Copying UniFFI Kotlin bindings into $KT_DEST"
mkdir -p "$KT_DEST"
cp "$SRC_BINDINGS/uniffi/mopro/mopro.kt" "$KT_DEST/mopro.kt"

echo "Done. Next: rebuild the Android app (cd apps/expo && bun run android)."
