#!/usr/bin/env bash
# One-time setup for local iOS release builds. Writes
# apps/expo/secrets/ios-export-options.plist consumed by
# xcodebuild -exportArchive in build-ios-local.sh.
#
# Automatic signing relies on the Apple ID you've added in Xcode
# (Settings → Accounts). xcodebuild's -allowProvisioningUpdates does the
# cert+profile fetching at build time.
#
# Usage:
#   bun run setup:ios
#   bun run setup:ios -- --force   # regenerate the plist
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_DIR="$APP_DIR/secrets"
EXPORT_OPTIONS="$SECRETS_DIR/ios-export-options.plist"
TEAM_ID="538MCM44UX"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
step()   { printf '\n\033[36m==> %s\033[0m\n' "$*"; }

if ! command -v xcodebuild >/dev/null 2>&1; then
  red "✗ xcodebuild not found — install Xcode from the Mac App Store"
  exit 1
fi

mkdir -p "$SECRETS_DIR"

if [[ -f "$EXPORT_OPTIONS" && $FORCE -eq 0 ]]; then
  green "✅ $EXPORT_OPTIONS already exists"
  yellow "   Re-run with: bun run setup:ios -- --force"
  exit 0
fi

step "Writing $EXPORT_OPTIONS"
cat > "$EXPORT_OPTIONS" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>teamID</key>
  <string>$TEAM_ID</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>destination</key>
  <string>export</string>
  <key>uploadBitcode</key>
  <false/>
  <key>uploadSymbols</key>
  <true/>
  <key>stripSwiftSymbols</key>
  <true/>
  <key>compileBitcode</key>
  <false/>
</dict>
</plist>
EOF
chmod 600 "$EXPORT_OPTIONS"
green "✓ wrote $EXPORT_OPTIONS"
echo
green "✅ Setup complete"
echo
echo "Then run:"
echo "  bun run ios:prebuild:local      # prep only → open Xcode and Archive"
echo "  bun run build:ios:local         # full pipeline → signed .ipa"
