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
#     bundled Android Studio one if unset).
#   - cargo-ndk:  cargo install cargo-ndk
#   - rust targets:
#       rustup target add aarch64-linux-android x86_64-linux-android
#   - Locally-built bb static lib at $BB_FORK_DIR — see
#     KNOWN_ISSUES.md "libc++ ABI namespace mismatch". The upstream
#     AztecProtocol prebuilt `libbb-external.a` references libc++'s
#     __1 inline namespace which NDK r25+ libc++_shared.so does not
#     export. We rebuild bb from source with NDK clang so the .a
#     references __ndk1 instead (matching what the device runtime
#     ships). Default path: $WORKSPACE/../bb-fork/aztec/barretenberg/cpp.
#     Built per-ABI under build-ndk-arm64-android/lib and
#     build-ndk-x86_64-android/lib via:
#       cd $BB_FORK_DIR
#       cmake --preset ndk-arm64-android && cmake --build build-ndk-arm64-android --target bb-external
#       cmake --preset ndk-x86_64-android && cmake --build build-ndk-x86_64-android --target bb-external
#     barretenberg-rs picks up our local .a via BB_LIB_DIR per-ABI;
#     this script wires that up.
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
BB_FORK_DIR="${BB_FORK_DIR:-$WORKSPACE_DIR/../bb-fork/aztec/barretenberg/cpp}"

if [[ ! -d "$BB_FORK_DIR" ]]; then
  echo "bb-fork not found at $BB_FORK_DIR" >&2
  echo "Sparse-clone aztec-packages @ v4.2.0-aztecnr-rc.2 there or set BB_FORK_DIR." >&2
  exit 1
fi

echo ">> Building passport-zk-mopro Android cdylib"
echo "   archs:    $ANDROID_ARCHS"
echo "   config:   $CONFIGURATION"
echo "   ndk:      $ANDROID_NDK_HOME"
echo "   bb-fork:  $BB_FORK_DIR"

# Map a Rust target triple to the bb-fork build directory that holds our
# NDK-clang-built libbb-external.a for that ABI. barretenberg-rs's
# build.rs respects BB_LIB_DIR; we set it per-arch so each cargo invocation
# links the matching .a.
bb_lib_dir_for_arch() {
  case "$1" in
    aarch64-linux-android) echo "$BB_FORK_DIR/build-ndk-arm64-android/lib" ;;
    x86_64-linux-android)  echo "$BB_FORK_DIR/build-ndk-x86_64-android/lib" ;;
    *) echo "Unknown ABI: $1" >&2; return 1 ;;
  esac
}

# `cargo run --bin android` (mopro_ffi) iterates ANDROID_ARCHS internally,
# but BB_LIB_DIR is one env var for the whole process — we can only point at
# one bb .a per cargo invocation. So we loop in shell and call mopro once
# per ABI with the matching bb dir.
#
# Gotcha: mopro_ffi's `move_bindings` does `remove_dir_all(bindings_dest)`
# then `rename(...)` on every call, which wipes the previous ABI's output.
# We snapshot each ABI's jniLibs output into a merged staging dir between
# cargo runs and restore at the end. The UniFFI Kotlin bindings are
# ABI-independent so the last call's output is fine for those.
MERGED_JNI_STAGING="$MOPRO_DIR/MoproAndroidBindings-merged/jniLibs"
rm -rf "$(dirname "$MERGED_JNI_STAGING")"
mkdir -p "$MERGED_JNI_STAGING"

IFS=',' read -ra ARCH_LIST <<< "$ANDROID_ARCHS"
for arch in "${ARCH_LIST[@]}"; do
  bb_dir="$(bb_lib_dir_for_arch "$arch")"
  if [[ ! -f "$bb_dir/libbb-external.a" ]]; then
    echo "Missing $bb_dir/libbb-external.a" >&2
    echo "Build it first: cd $BB_FORK_DIR && cmake --preset ndk-${arch//linux-android/}-android && cmake --build build-ndk-${arch//linux-android/}-android --target bb-external" >&2
    exit 3
  fi
  echo ">> [$arch] BB_LIB_DIR=$bb_dir"
  (
    cd "$MOPRO_DIR"
    ANDROID_NDK_HOME="$ANDROID_NDK_HOME" \
    ANDROID_NDK="$ANDROID_NDK_HOME" \
    ANDROID_HOME="$HOME/Library/Android/sdk" \
    ANDROID_ARCHS="$arch" \
    CONFIGURATION="$CONFIGURATION" \
    BB_LIB_DIR="$bb_dir" \
    cargo run --bin android --release
  )
  # Snapshot this ABI's jniLibs/<abi_dir>/lib*.so before the next iteration
  # wipes MoproAndroidBindings/.
  if [[ -d "$MOPRO_DIR/MoproAndroidBindings/jniLibs" ]]; then
    cp -R "$MOPRO_DIR/MoproAndroidBindings/jniLibs/"* "$MERGED_JNI_STAGING/"
  fi
done

# Restore all per-ABI .so files into MoproAndroidBindings/jniLibs before the
# downstream copy step picks them up. (The Kotlin bindings dir was written
# by the last iteration and is correct as-is.)
rm -rf "$MOPRO_DIR/MoproAndroidBindings/jniLibs"
mv "$MERGED_JNI_STAGING" "$MOPRO_DIR/MoproAndroidBindings/jniLibs"
rmdir "$(dirname "$MERGED_JNI_STAGING")" 2>/dev/null || true

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

# Bundle the passport-noir 0.3.0 OpenAC v3 circuit JSONs (one per circuit) plus
# a SINGLE merged SRS as Android assets so HybridPassportZk can resolve JS
# aliases to real paths. barretenberg's SRS is a prefix, so one blob sized to
# the largest circuit serves all three (~256MB→128MB in the APK).
ASSETS_DEST="$MODULE_DIR/android/src/main/assets"
mkdir -p "$ASSETS_DEST"

# Drop any stale per-circuit SRS from earlier builds so the APK never ships
# both the old split blobs and the new merged one.
rm -f "$ASSETS_DEST"/dsc_chain.srs.bin \
      "$ASSETS_DEST"/passport_adapter.srs.bin \
      "$ASSETS_DEST"/openac_show.srs.bin

for circuit in dsc_chain passport_adapter openac_show; do
  CIRCUIT_SRC="$PASSPORT_NOIR_DIR/circuits/target/$circuit.json"
  if [[ -f "$CIRCUIT_SRC" ]]; then
    echo ">> Bundling $CIRCUIT_SRC → $ASSETS_DEST/"
    cp "$CIRCUIT_SRC" "$ASSETS_DEST/$circuit.json"
  else
    echo "Warning: $CIRCUIT_SRC not found — run \`nargo compile --workspace\` in passport-noir/circuits first." >&2
  fi
done

MERGED_SRS_SRC="$MOPRO_DIR/test-vectors/srs/passport.srs.bin"
if [[ -f "$MERGED_SRS_SRC" ]]; then
  echo ">> Bundling merged SRS $MERGED_SRS_SRC → $ASSETS_DEST/passport.srs.bin"
  cp "$MERGED_SRS_SRC" "$ASSETS_DEST/passport.srs.bin"
else
  echo "Warning: $MERGED_SRS_SRC not found — run \`make gen-srs\` in passport-noir first." >&2
fi

echo "Done. Next: rebuild the Android app (cd apps/expo && bun run android)."
