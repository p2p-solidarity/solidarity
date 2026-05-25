#!/usr/bin/env bash
#
# One-time interactive setup for local Android release signing.
#
# `eas credentials` has no non-interactive "download keystore" path, so
# this script wraps it: it launches the EAS menu with a cheat-sheet of
# which options to pick, then takes over after you exit the menu —
# moving the downloaded .jks into apps/expo/secrets/release.keystore
# and writing apps/expo/secrets/android-signing.env from passwords
# you paste in (silently).
#
# Usage:
#   bun run setup:android         # first-time setup
#   bun run setup:android -- --force   # overwrite existing config
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_DIR="$APP_DIR/secrets"
KEYSTORE_PATH="$SECRETS_DIR/release.keystore"
SIGNING_ENV="$SECRETS_DIR/android-signing.env"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
cyan()   { printf '\033[36m%s\033[0m\n' "$*"; }
step()   { printf '\n\033[36m==> %s\033[0m\n' "$*"; }

cd "$APP_DIR"

# ─── Idempotency ────────────────────────────────────────────────────────────
if [[ -f "$KEYSTORE_PATH" && -f "$SIGNING_ENV" && $FORCE -eq 0 ]]; then
  green "✅ Already configured:"
  echo "   $KEYSTORE_PATH"
  echo "   $SIGNING_ENV"
  echo
  yellow "Re-run with: bun run setup:android -- --force   (to overwrite)"
  exit 0
fi

# ─── Login check ────────────────────────────────────────────────────────────
step "Checking EAS login"
if ! bunx eas-cli whoami >/dev/null 2>&1; then
  yellow "Not logged in. Launching: bunx eas-cli login"
  bunx eas-cli login
fi
WHO="$(bunx eas-cli whoami 2>/dev/null || echo '?')"
green "Logged in as: $WHO"

# ─── Cheat-sheet + launch interactive eas credentials ───────────────────────
mkdir -p "$SECRETS_DIR"

cat <<'EOF'

──────────────────────────────────────────────────────────────────────
 You're about to enter `eas credentials` (interactive).

 Pick this path:

   ?  Select platform        → Android
   ?  Build profile          → production
   ?  What do you want to do → Keystore: Manage everything needed …
   ?  What do you want to do → Download existing keystore
                               (or "Set up a new keystore" if none exists)

 EAS will:
   • save a .jks file under apps/expo/ (or wherever it asks you to)
   • PRINT three values — Keystore password / Key alias / Key password
   • COPY THEM NOW (you'll paste them in after).

 When done, pick "Go back" repeatedly or hit Ctrl+C to exit the menu.
 This script will then take over and finish the setup.
──────────────────────────────────────────────────────────────────────

EOF
read -r -p "Press Enter to launch eas credentials..." _

# Run eas credentials interactively. Both Ctrl+C and selecting "Exit" in
# the menu should return control to THIS script, not kill it.
#
# Two things need handling:
#   1. SIGINT (Ctrl+C) — without a trap, bash forwards it and terminates
#      the parent script too. Install a no-op trap so only the child dies.
#   2. Non-zero exit (eas-cli exits 130 on SIGINT) — wrap in `|| true`
#      because `set -e` is still active.
trap 'printf "\n(EAS menu interrupted — continuing setup)\n"' INT
bunx eas-cli credentials -p android || true
trap - INT

# ─── Locate the downloaded keystore ─────────────────────────────────────────
step "Locating downloaded keystore"

# Auto-detect candidates (anything looking like a release keystore inside
# apps/expo/, excluding the debug one). Portable bash 3.2 — no `mapfile`.
CANDIDATES=()
while IFS= read -r line; do
  [[ -n "$line" ]] && CANDIDATES+=("$line")
done < <(
  find "$APP_DIR" -maxdepth 3 -type f \( -name "*.jks" -o -name "*.keystore" \) 2>/dev/null \
    | grep -v "debug.keystore" \
    | grep -v "/secrets/" \
    | while IFS= read -r f; do
        # macOS-compatible mtime + path; sort numerically by mtime, newest first.
        printf '%s\t%s\n' "$(stat -f %m "$f" 2>/dev/null)" "$f"
      done \
    | sort -rn \
    | cut -f2-
)

KEYSTORE_SRC=""
if [[ ${#CANDIDATES[@]} -eq 1 ]]; then
  KEYSTORE_SRC="${CANDIDATES[0]}"
  cyan "Auto-detected: $KEYSTORE_SRC"
  read -r -p "Use this file? [Y/n] " yn
  [[ "$yn" =~ ^[Nn]$ ]] && KEYSTORE_SRC=""
elif [[ ${#CANDIDATES[@]} -gt 1 ]]; then
  cyan "Multiple keystores found (newest first):"
  for i in "${!CANDIDATES[@]}"; do
    echo "  [$i] ${CANDIDATES[$i]}"
  done
  read -r -p "Pick index, or press Enter to type a custom path: " idx
  [[ "$idx" =~ ^[0-9]+$ ]] && KEYSTORE_SRC="${CANDIDATES[$idx]:-}"
fi

if [[ -z "$KEYSTORE_SRC" ]]; then
  echo "Drag the downloaded keystore here, or paste its full path:"
  read -r -e -p "> " KEYSTORE_SRC
  # Strip single-quotes that drag-and-drop sometimes adds
  KEYSTORE_SRC="${KEYSTORE_SRC#\'}"
  KEYSTORE_SRC="${KEYSTORE_SRC%\'}"
fi

if [[ ! -f "$KEYSTORE_SRC" ]]; then
  red "✗ File not found: $KEYSTORE_SRC"
  exit 1
fi

mv "$KEYSTORE_SRC" "$KEYSTORE_PATH"
chmod 600 "$KEYSTORE_PATH"
green "→ $KEYSTORE_PATH"

# ─── Collect passwords (silent input) ───────────────────────────────────────
step "Paste the credentials printed by eas credentials"
echo "  (Input is hidden. Press Enter after each.)"
echo

read -r -s -p "Keystore password : " STORE_PW; echo
read -r    -p "Key alias         : " KEY_ALIAS
read -r -s -p "Key password      : " KEY_PW;   echo

if [[ -z "$STORE_PW" || -z "$KEY_ALIAS" || -z "$KEY_PW" ]]; then
  red "✗ One of the fields was empty — aborting."
  exit 1
fi

# ─── Write env file ─────────────────────────────────────────────────────────
umask 077
cat > "$SIGNING_ENV" <<EOF
# Generated by scripts/setup-android-signing.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Source: bunx eas-cli credentials -p android  →  Download existing keystore
# DO NOT COMMIT. apps/expo/secrets/ is gitignored at the workspace root.
ANDROID_KEYSTORE_PASSWORD=$STORE_PW
ANDROID_KEY_ALIAS=$KEY_ALIAS
ANDROID_KEY_PASSWORD=$KEY_PW
EOF
chmod 600 "$SIGNING_ENV"
green "→ $SIGNING_ENV"

# ─── Sanity check: verify the keystore opens with these creds ───────────────
step "Verifying keystore + credentials with keytool"
if ! command -v keytool >/dev/null 2>&1; then
  yellow "keytool not on PATH — skipping verification (install a JDK if you want this check)."
else
  if keytool -list -keystore "$KEYSTORE_PATH" -storepass "$STORE_PW" -alias "$KEY_ALIAS" >/dev/null 2>&1; then
    green "✓ keystore + alias + password OK"
  else
    red "✗ keytool could not open the keystore with those credentials."
    echo "  Re-run with: bun run setup:android -- --force"
    exit 1
  fi
fi

# ─── Done ───────────────────────────────────────────────────────────────────
echo
green "✅ Setup complete."
echo
echo "Now run:"
echo "  bun run build:android:local"
echo "  bun run submit:android"
