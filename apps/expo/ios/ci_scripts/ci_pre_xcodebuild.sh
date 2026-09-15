#!/usr/bin/env bash
# Xcode 26+ ships the Metal compiler as an optional component. Xcode Cloud
# workers do not reliably mount it, which makes VisionCameraResizer's shader
# fail with `Command CompileMetalFile failed` and no serialized diagnostics.
set -euo pipefail

echo "▸ Ensuring the Metal Toolchain is available"
xcodebuild -downloadComponent metalToolchain
xcrun --sdk iphoneos metal --version
echo "✓ Metal Toolchain ready"
