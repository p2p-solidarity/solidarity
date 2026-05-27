#!/usr/bin/env bash
# Shared iOS workspace preparation for Xcode Cloud and local xcodebuild
# archives. Keep Node/Bun/Expo/CocoaPods setup here so the two paths do not
# drift.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${AIRMEISHI_EXPO_APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
REPO_ROOT="${AIRMEISHI_REPO_ROOT:-$(cd "$APP_DIR/../.." && pwd)}"

INSTALL_TOOLING="${AIRMEISHI_INSTALL_TOOLING:-0}"
RUN_BUN_INSTALL="${AIRMEISHI_RUN_BUN_INSTALL:-1}"
RUN_POD_INSTALL="${AIRMEISHI_RUN_POD_INSTALL:-1}"
PREBUILD_CLEAN="${AIRMEISHI_IOS_PREBUILD_CLEAN:-0}"
BUN_INSTALL_ARGS="${AIRMEISHI_BUN_INSTALL_ARGS:-}"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
step()   { printf '\n\033[36m==> %s\033[0m\n' "$*"; }

die() {
  red "x $*"
  exit 1
}

is_enabled() {
  case "${1:-}" in
    1 | true | TRUE | yes | YES) return 0 ;;
    *) return 1 ;;
  esac
}

ensure_homebrew() {
  command -v brew >/dev/null 2>&1 || die "Homebrew is required to install missing Xcode Cloud tools"
}

install_if_missing() {
  local command_name="$1"
  local formula="$2"

  if command -v "$command_name" >/dev/null 2>&1; then
    return 0
  fi

  if ! is_enabled "$INSTALL_TOOLING"; then
    die "$command_name not found. Install it locally or set AIRMEISHI_INSTALL_TOOLING=1 in CI."
  fi

  ensure_homebrew
  step "Installing $formula"
  brew install "$formula"
}

ensure_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || die "$command_name is still unavailable after setup"
}

normalize_xcode_cloud_scheme() {
  local scheme_dir="$APP_DIR/ios/Solidarity.xcodeproj/xcshareddata/xcschemes"
  local expo_scheme="$scheme_dir/Solidarity.xcscheme"
  local cloud_scheme="$scheme_dir/solidarity.xcscheme"
  local temp_scheme="$scheme_dir/.solidarity.xcscheme.tmp"

  if [[ ! -f "$expo_scheme" && ! -f "$cloud_scheme" ]]; then
    die "Expected Expo to generate $expo_scheme"
  fi

  if [[ -f "$expo_scheme" ]]; then
    rm -f "$temp_scheme"
    if [[ "$expo_scheme" -ef "$cloud_scheme" ]]; then
      mv "$expo_scheme" "$temp_scheme"
      mv "$temp_scheme" "$cloud_scheme"
    else
      rm -f "$cloud_scheme"
      mv "$expo_scheme" "$cloud_scheme"
    fi
  fi
}

cd "$REPO_ROOT"

install_if_missing node node
install_if_missing bun oven-sh/bun/bun
install_if_missing bunx oven-sh/bun/bun
install_if_missing pod cocoapods

ensure_command node
ensure_command bun
ensure_command bunx
ensure_command pod

if ! node -e "const [maj,min]=process.versions.node.split('.').map(Number); process.exit(maj > 20 || (maj === 20 && min >= 18) ? 0 : 1)"; then
  die "Node.js 20.18+ is required by package.json engines.node"
fi

if is_enabled "$RUN_BUN_INSTALL"; then
  step "bun install ${BUN_INSTALL_ARGS:-}"
  bun_args=()
  if [[ -n "$BUN_INSTALL_ARGS" ]]; then
    # Intentionally split env-provided args so callers can pass standard CLI flags.
    # shellcheck disable=SC2206
    bun_args=($BUN_INSTALL_ARGS)
  fi
  bun install "${bun_args[@]}"
fi

step "expo prebuild --platform ios"
prebuild_args=(expo prebuild)
if is_enabled "$PREBUILD_CLEAN"; then
  prebuild_args+=(--clean)
fi
prebuild_args+=(--platform ios --no-install)
( cd "$APP_DIR" && bunx "${prebuild_args[@]}" )
normalize_xcode_cloud_scheme

if is_enabled "$RUN_POD_INSTALL"; then
  step "pod install"
  ( cd "$APP_DIR/ios" && pod install )
fi

green "OK iOS workspace prepared at $APP_DIR/ios/Solidarity.xcworkspace"
