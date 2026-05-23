#!/bin/sh
# Re-export the Swift-side golden fixtures consumed by the Expo bun-test
# parity suite. Run from repo root after any change to a Swift Codable model
# or to EncryptionManager.swift / KeychainService.swift / similar layers.
#
# Outputs land in packages/parity-fixtures/fixtures/.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "▸ exporting parity fixtures from FixtureExporter XCTest…"
xcodebuild test \
  -project solidarity.xcodeproj \
  -scheme solidarity \
  -only-testing:solidarityTests/FixtureExporter \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -skipPackagePluginValidation \
  -quiet
echo "✓ fixtures written to packages/parity-fixtures/fixtures/"
