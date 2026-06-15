#!/usr/bin/env bash
# Stage the OpenAC v3 merged SRS from local files only.
#
# This script intentionally does not download anything. It exists for both
# prepare-ios-workspace.sh and xcodebuild: if CocoaPods lists passport.srs.bin
# as a resource input, this script makes sure the file exists before the Pods
# resource copy phase tries to read it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${AIRMEISHI_EXPO_APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
REPO_ROOT="${AIRMEISHI_REPO_ROOT:-$(cd "$APP_DIR/../.." && pwd)}"
PASSPORT_NOIR_DIR="${AIRMEISHI_PASSPORT_NOIR_DIR:-$(cd "$REPO_ROOT/.." && pwd)/passport-noir}"
ASSETS_DEST="${AIRMEISHI_PASSPORT_ZK_ASSETS_DIR:-$REPO_ROOT/nitro-modules/passport-zk/android/src/main/assets}"

MERGED_FILE="passport.srs.bin"
SRS_DIR="$PASSPORT_NOIR_DIR/mopro-binding/test-vectors/srs"
STALE_FILES=(dsc_chain.srs.bin passport_adapter.srs.bin openac_show.srs.bin)

die() {
  printf '\033[31mx %s\033[0m\n' "$*" >&2
  exit 1
}

green() {
  printf '\033[32m%s\033[0m\n' "$*"
}

file_size() {
  wc -c < "$1" | tr -d '[:space:]'
}

find_legacy_largest_srs() {
  local best=""
  local best_size=0
  local candidate
  for candidate in "${STALE_FILES[@]}"; do
    local path="$SRS_DIR/$candidate"
    [[ -f "$path" ]] || continue
    local size
    size="$(file_size "$path")"
    if (( size > best_size )); then
      best="$path"
      best_size="$size"
    fi
  done
  printf '%s\n' "$best"
}

resolve_source_srs() {
  if [[ -n "${AIRMEISHI_PASSPORT_OPENAC_SRS_PATH:-}" ]]; then
    [[ -f "$AIRMEISHI_PASSPORT_OPENAC_SRS_PATH" ]] ||
      die "AIRMEISHI_PASSPORT_OPENAC_SRS_PATH does not exist: $AIRMEISHI_PASSPORT_OPENAC_SRS_PATH"
    printf '%s\n' "$AIRMEISHI_PASSPORT_OPENAC_SRS_PATH"
    return 0
  fi

  if [[ -f "$SRS_DIR/$MERGED_FILE" ]]; then
    printf '%s\n' "$SRS_DIR/$MERGED_FILE"
    return 0
  fi

  find_legacy_largest_srs
}

src="$(resolve_source_srs)"
[[ -n "$src" ]] || die "OpenAC v3 SRS not found locally. Expected $SRS_DIR/$MERGED_FILE or set AIRMEISHI_PASSPORT_OPENAC_SRS_PATH."

mkdir -p "$ASSETS_DEST"
dest="$ASSETS_DEST/$MERGED_FILE"

if [[ -f "$dest" ]] && cmp -s "$src" "$dest"; then
  green "OK OpenAC v3 merged SRS already staged: $dest"
else
  tmp="$dest.tmp.$$"
  cp "$src" "$tmp"
  chmod 0644 "$tmp"
  mv "$tmp" "$dest"
  green "OK staged OpenAC v3 merged SRS: $src -> $dest"
fi

for stale in "${STALE_FILES[@]}"; do
  rm -f "$ASSETS_DEST/$stale"
done
