#!/usr/bin/env bash
# Full local iOS build → signed .ipa. Stages via prebuild-ios-local.sh
# then drives xcodebuild archive + xcodebuild -exportArchive. Mirrors
# build-android-local.sh — bypasses eas-cli to avoid the monorepo
# workspace:* resolution problem.
#
# Signing is automatic via the Apple ID you've added in Xcode
# (Settings → Accounts). -allowProvisioningUpdates fetches certs/profiles.
#
# One-time setup:
#   bun run setup:ios   # writes secrets/ios-export-options.plist
#
# Usage:
#   bun run build:ios:local
#
# Output:
#   apps/expo/build/Solidarity-b<N>.xcarchive
#   apps/expo/build/Solidarity-b<N>/<AppName>.ipa
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_DIR="$APP_DIR/secrets"
EXPORT_OPTIONS="$SECRETS_DIR/ios-export-options.plist"
OUT_DIR="$APP_DIR/build"
VERSION_FILE="$APP_DIR/.ios-build-number"
WORKSPACE="$APP_DIR/ios/Solidarity.xcworkspace"
SCHEME="solidarity"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
step()   { printf '\n\033[36m==> %s\033[0m\n' "$*"; }

if [[ ! -f "$EXPORT_OPTIONS" ]]; then
  red "✗ Missing $EXPORT_OPTIONS"
  echo "  Create with: bun run setup:ios"
  exit 1
fi
if ! command -v xcodebuild >/dev/null 2>&1; then
  red "✗ xcodebuild not found — install Xcode from the Mac App Store"
  exit 1
fi

CURRENT_BN="$(tr -d '[:space:]' < "$VERSION_FILE" 2>/dev/null || echo 0)"
NEXT_BN=$((CURRENT_BN + 1))
AIRMEISHI_BUN_INSTALL_ARGS="${AIRMEISHI_BUN_INSTALL_ARGS:---frozen-lockfile}" \
IOS_SKIP_VERSION_WRITEBACK=1 \
"$APP_DIR/scripts/prebuild-ios-local.sh"

ARCHIVE_PATH="$OUT_DIR/Solidarity-b${NEXT_BN}.xcarchive"
EXPORT_PATH="$OUT_DIR/Solidarity-b${NEXT_BN}"
mkdir -p "$OUT_DIR"
rm -rf "$ARCHIVE_PATH" "$EXPORT_PATH"

step "xcodebuild archive (build #$NEXT_BN)"
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE_PATH" \
  -allowProvisioningUpdates \
  -quiet \
  archive

if [[ ! -d "$ARCHIVE_PATH" ]]; then
  red "✗ Archive step finished but $ARCHIVE_PATH does not exist"
  exit 1
fi

step "xcodebuild -exportArchive → IPA"
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -allowProvisioningUpdates \
  -quiet

IPA="$(find "$EXPORT_PATH" -maxdepth 1 -name '*.ipa' -print -quit)"
if [[ -z "$IPA" ]]; then
  red "✗ Export succeeded but no .ipa found in $EXPORT_PATH"
  exit 1
fi

step "Writing buildNumber $NEXT_BN → $VERSION_FILE"
printf '%s\n' "$NEXT_BN" > "$VERSION_FILE"
green "✓ $VERSION_FILE = $NEXT_BN"

echo
green "✅ Build complete"
echo "   IPA:         $IPA"
echo "   xcarchive:   $ARCHIVE_PATH"
echo "   buildNumber: $NEXT_BN"
echo
yellow "Next — upload to App Store Connect:"
echo "   open -a Transporter \"$IPA\""
echo "   # or:"
echo "   xcrun altool --upload-app -f \"$IPA\" --type ios \\"
echo "      --apiKey <KEY_ID> --apiIssuer <ISSUER_ID>"
