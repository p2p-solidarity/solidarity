#!/usr/bin/env bash
#
# Local Android AAB build using Gradle directly — replaces
# `eas build --platform android --profile production --local`.
#
# Why bypass EAS local? EAS's local builder only uploads `apps/expo/`
# into its sandbox and bun then fails to resolve `workspace:*` deps
# (`@solidarity/shared`, the nitro modules). Gradle ran from the
# real workspace has no such limitation.
#
# Versioning: tracked in `apps/expo/.android-version-code` (committed).
# That file stores the *last-used* versionCode; this script reads it,
# increments by 1, exports `ANDROID_VERSION_CODE` so the config plugin
# `withAndroidReleaseSigning` injects it during prebuild, and writes
# the new value back on a successful build.
#
# Play Store only cares about the versionCode inside the AAB, so EAS
# remote no longer matters here. If you also run `eas build` cloud,
# keep its remote value manually in sync or migrate that path too.
#
# Signing: the plugin reads ANDROID_KEYSTORE_PATH/PASSWORD/KEY_ALIAS/
# KEY_PASSWORD from env at Gradle runtime. Set them via the env file.
#
# One-time setup
# --------------
#   1. Download the EAS-managed release keystore:
#
#        cd apps/expo
#        bunx eas credentials -p android
#        # → select Production → Keystore → Download
#        # save under apps/expo/secrets/release.keystore
#
#   2. Create apps/expo/secrets/android-signing.env (gitignored):
#
#        ANDROID_KEYSTORE_PASSWORD=...
#        ANDROID_KEY_ALIAS=...
#        ANDROID_KEY_PASSWORD=...
#
#      (eas credentials output prints all three.)
#
# Usage
# -----
#   bun run build:android:local
#   bun run submit:android   # picks up the latest AAB under build/
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "$APP_DIR/../.." && pwd)"
SECRETS_DIR="$APP_DIR/secrets"
SIGNING_ENV="$SECRETS_DIR/android-signing.env"
KEYSTORE_PATH="$SECRETS_DIR/release.keystore"
OUT_DIR="$APP_DIR/build"
VERSION_FILE="$APP_DIR/.android-version-code"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
step()   { printf '\n\033[36m==> %s\033[0m\n' "$*"; }

# ─── Preflight ──────────────────────────────────────────────────────────────
if [[ ! -f "$KEYSTORE_PATH" ]]; then
  red "✗ Release keystore not found: $KEYSTORE_PATH"
  echo "  Download with: bunx eas credentials -p android"
  echo "  See header of $(basename "${BASH_SOURCE[0]}") for setup."
  exit 1
fi

if [[ ! -f "$SIGNING_ENV" ]]; then
  red "✗ Signing env not found: $SIGNING_ENV"
  echo "  Create it with ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS /"
  echo "  ANDROID_KEY_PASSWORD (printed by 'eas credentials -p android')."
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$SIGNING_ENV"; set +a
: "${ANDROID_KEYSTORE_PASSWORD:?missing in $SIGNING_ENV}"
: "${ANDROID_KEY_ALIAS:?missing in $SIGNING_ENV}"
: "${ANDROID_KEY_PASSWORD:?missing in $SIGNING_ENV}"

export ANDROID_KEYSTORE_PATH="$KEYSTORE_PATH"
export ANDROID_KEYSTORE_PASSWORD
export ANDROID_KEY_ALIAS
export ANDROID_KEY_PASSWORD

cd "$APP_DIR"

# ─── Step 1: Read + bump versionCode from local file ────────────────────────
step "Reading versionCode from $VERSION_FILE"
if [[ ! -f "$VERSION_FILE" ]]; then
  red "✗ Version file missing: $VERSION_FILE"
  echo "  Create it with the last-used versionCode, e.g.:"
  echo "    echo 0 > $VERSION_FILE"
  exit 1
fi
CURRENT_VC="$(tr -d '[:space:]' < "$VERSION_FILE")"
if ! [[ "$CURRENT_VC" =~ ^[0-9]+$ ]]; then
  red "✗ $VERSION_FILE must contain a single non-negative integer (got: '$CURRENT_VC')"
  exit 1
fi
NEXT_VC=$((CURRENT_VC + 1))
green "    versionCode: $CURRENT_VC → $NEXT_VC"
export ANDROID_VERSION_CODE="$NEXT_VC"

# ─── Step 2: Workspace install at monorepo root ─────────────────────────────
step "bun install (workspace root)"
( cd "$ROOT_DIR" && bun install )

# ─── Step 3: Prebuild (config plugin picks up env vars) ─────────────────────
step "expo prebuild --platform android"
bunx expo prebuild --platform android --no-install

# ─── Step 4: Gradle bundleRelease ───────────────────────────────────────────
step "gradle bundleRelease"
cd "$APP_DIR/android"
./gradlew bundleRelease --console=plain

# ─── Step 5: Stage AAB into build/ for submit:android ───────────────────────
SRC_AAB="$APP_DIR/android/app/build/outputs/bundle/release/app-release.aab"
if [[ ! -f "$SRC_AAB" ]]; then
  red "✗ Gradle finished but AAB not found at $SRC_AAB"
  exit 1
fi
mkdir -p "$OUT_DIR"
OUT_AAB="$OUT_DIR/app-release-vc${NEXT_VC}.aab"
cp "$SRC_AAB" "$OUT_AAB"

# ─── Step 6: Persist new versionCode to local file ──────────────────────────
step "Writing versionCode $NEXT_VC → $VERSION_FILE"
printf '%s\n' "$NEXT_VC" > "$VERSION_FILE"
green "✓ $VERSION_FILE = $NEXT_VC (commit this so the next build picks up from here)"

# ─── Done ───────────────────────────────────────────────────────────────────
echo
green "✅ Build complete"
echo "   AAB:         $OUT_AAB"
echo "   versionCode: $NEXT_VC"
echo "   versionName: $(grep -E 'versionName ' "$APP_DIR/android/app/build.gradle" | head -1 | sed -E 's/.*versionName "([^"]+)".*/\1/')"
echo
yellow "Next: bun run submit:android"
