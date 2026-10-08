#!/usr/bin/env bash
# Regenerate the Metal IR library shipped to Xcode Cloud. The app targets iOS
# 17, so the precompiled library uses the same AIR deployment target.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
SOURCE="$REPO_ROOT/node_modules/react-native-vision-camera-resizer/ios/Metal/ResizerKernels.metal"
OUTPUT_DIR="$APP_DIR/native-assets/VisionCameraResizer"
OUTPUT="$OUTPUT_DIR/default.metallib"
AIRMEISHI_METAL_TEMP="$(mktemp -d)"
trap 'rm -r "${AIRMEISHI_METAL_TEMP:?}"' EXIT

mkdir -p "$OUTPUT_DIR"
xcrun --sdk iphoneos metal \
  -c \
  -target air64-apple-ios17.0 \
  "$SOURCE" \
  -o "$AIRMEISHI_METAL_TEMP/ResizerKernels.air"
xcrun --sdk iphoneos metallib \
  "$AIRMEISHI_METAL_TEMP/ResizerKernels.air" \
  -o "$OUTPUT"

echo "✓ Wrote $OUTPUT"
