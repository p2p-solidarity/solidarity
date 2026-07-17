#!/usr/bin/env bash
# Canonical iOS scheme casing = lowercase `solidarity` — the casing the Xcode
# Cloud workflow archives. Expo prebuild regenerates the shared scheme as
# `Solidarity`, and xcodebuild scheme matching is case-sensitive, so EVERY
# build path must normalize before invoking xcodebuild:
#   - Xcode Cloud / local archives: prepare-ios-workspace.sh calls this right
#     after `expo prebuild`.
#   - local dev: `bun run ios` calls this before `expo run:ios --scheme
#     solidarity` (a bare `expo run:ios` derives the UPPERCASE scheme from the
#     project name and dies with "does not contain a scheme named
#     'Solidarity'" whenever the tree is in the normalized checked-in state).
# Idempotent; safe on case-insensitive APFS (the -ef branch renames through a
# temp file so the directory entry carries the workflow casing).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${AIRMEISHI_EXPO_APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

scheme_dir="$APP_DIR/ios/Solidarity.xcodeproj/xcshareddata/xcschemes"
workflow_scheme="$scheme_dir/solidarity.xcscheme"
expo_scheme="$scheme_dir/Solidarity.xcscheme"
temp_scheme="$scheme_dir/.solidarity.xcscheme.tmp"

if [[ ! -f "$workflow_scheme" && ! -f "$expo_scheme" ]]; then
  echo "x Expected a shared scheme at $scheme_dir — run 'bunx expo prebuild --platform ios' first" >&2
  exit 1
fi

if [[ -f "$expo_scheme" ]]; then
  rm -f "$temp_scheme"
  if [[ "$expo_scheme" -ef "$workflow_scheme" ]]; then
    # Case-insensitive FS: same file under either name — rename through a
    # temp so the directory entry carries the Xcode Cloud workflow casing.
    mv "$expo_scheme" "$temp_scheme"
    mv "$temp_scheme" "$workflow_scheme"
  elif [[ -f "$workflow_scheme" ]]; then
    # Distinct Expo-generated uppercase duplicate next to the workflow
    # scheme. Keep the workflow scheme to avoid two app schemes in Xcode.
    rm -f "$expo_scheme"
  else
    mv "$expo_scheme" "$workflow_scheme"
  fi
fi
