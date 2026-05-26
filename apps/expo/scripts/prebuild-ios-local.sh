#!/usr/bin/env bash
# Stage the iOS Xcode workspace for a local build — bumps the build
# number, installs workspace deps, runs `expo prebuild`, then `pod install`.
# Use this if you want to open Xcode and Archive manually. For the full
# pipeline to a signed .ipa, run build-ios-local.sh.
#
# Why not `eas build --local`? EAS local uploads only apps/expo/ into its
# sandbox, so bun can't resolve workspace:* deps (@solidarity/shared and
# the nitro modules).
#
# Build number lives in apps/expo/.ios-build-number (gitignored, per
# machine). withIosBuildNumber config plugin reads IOS_BUILD_NUMBER from
# env at prebuild time → CURRENT_PROJECT_VERSION in the pbxproj.
#
# Env (advanced):
#   IOS_SKIP_VERSION_WRITEBACK=1   bump in memory only; don't persist.
#                                  build-ios-local.sh sets this so the file
#                                  only advances on a successful archive.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "$APP_DIR/../.." && pwd)"
VERSION_FILE="$APP_DIR/.ios-build-number"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
step()   { printf '\n\033[36m==> %s\033[0m\n' "$*"; }

step "Reading buildNumber from $VERSION_FILE"
if [[ ! -f "$VERSION_FILE" ]]; then
  yellow "    $VERSION_FILE missing — seeding to 0"
  echo 0 > "$VERSION_FILE"
fi
CURRENT_BN="$(tr -d '[:space:]' < "$VERSION_FILE")"
if ! [[ "$CURRENT_BN" =~ ^[0-9]+$ ]]; then
  red "✗ $VERSION_FILE must contain a single non-negative integer (got: '$CURRENT_BN')"
  exit 1
fi
NEXT_BN=$((CURRENT_BN + 1))
green "    buildNumber: $CURRENT_BN → $NEXT_BN"
export IOS_BUILD_NUMBER="$NEXT_BN"

step "bun install (workspace root)"
( cd "$ROOT_DIR" && bun install )

step "expo prebuild --platform ios"
cd "$APP_DIR"
bunx expo prebuild --platform ios --no-install

step "pod install"
cd "$APP_DIR/ios"
if ! command -v pod >/dev/null 2>&1; then
  red "✗ CocoaPods not found — install with: sudo gem install cocoapods"
  exit 1
fi
pod install

if [[ "${IOS_SKIP_VERSION_WRITEBACK:-0}" != "1" ]]; then
  step "Writing buildNumber $NEXT_BN → $VERSION_FILE"
  printf '%s\n' "$NEXT_BN" > "$VERSION_FILE"
  green "✓ $VERSION_FILE = $NEXT_BN"
fi

echo
green "✅ Xcode workspace ready"
echo "   buildNumber:  $NEXT_BN"
echo "   workspace:    $APP_DIR/ios/Solidarity.xcworkspace"
echo
yellow "Next — pick one:"
echo "   open $APP_DIR/ios/Solidarity.xcworkspace   # then Product → Archive"
echo "   bun run build:ios:local                    # fully automated → .ipa"
