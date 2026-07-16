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
SETUP_IOS_NATIVE_BINDINGS="${AIRMEISHI_SETUP_IOS_NATIVE_BINDINGS:-1}"
PASSPORT_NOIR_DIR="${AIRMEISHI_PASSPORT_NOIR_DIR:-$(cd "$REPO_ROOT/.." && pwd)/passport-noir}"
PASSPORT_MOPRO_VERSION="${AIRMEISHI_PASSPORT_MOPRO_VERSION:-v0.3.2}"
PASSPORT_MOPRO_ZIP_URL="${AIRMEISHI_PASSPORT_MOPRO_ZIP_URL:-https://github.com/p2p-solidarity/passport-noir/releases/download/${PASSPORT_MOPRO_VERSION}/PassportMoproBindings.xcframework.zip}"
PASSPORT_MOPRO_SHA256="${AIRMEISHI_PASSPORT_MOPRO_SHA256-3a81c5e6a743f3a875e88c3b54b9fd3c4ca8cc250a31d3cc79b53b87dc940c49}"
# OpenAC v3 uses one merged `passport.srs.bin`. It is large (128MB) and
# gitignored, so staging prefers local passport-noir build artifacts; when they
# are absent (fresh checkout / Xcode Cloud) the SHA-pinned copy attached to the
# passport-noir release is downloaded into the same local path first. The
# stage-openac-srs.sh helper itself never downloads (it also runs as an Xcode
# build phase, which must stay offline + deterministic).
PASSPORT_OPENAC_SRS_URL="${AIRMEISHI_PASSPORT_OPENAC_SRS_URL:-https://github.com/p2p-solidarity/passport-noir/releases/download/${PASSPORT_MOPRO_VERSION}/passport.srs.bin}"
PASSPORT_OPENAC_SRS_SHA256="${AIRMEISHI_PASSPORT_OPENAC_SRS_SHA256-7d368f9342b99252a06249e46a3edfbda9aa2e9afb482bfe848245ab538c6996}"
SEMAPHORE_SWIFT_REF="${AIRMEISHI_SEMAPHORE_SWIFT_REF:-850680a5adcc258d6861005b55a4925bd08a48eb}"
SEMAPHORE_SWIFT_ZIP_URL="${AIRMEISHI_SEMAPHORE_SWIFT_ZIP_URL:-https://github.com/zkmopro/SemaphoreSwift/archive/${SEMAPHORE_SWIFT_REF}.zip}"
SEMAPHORE_SWIFT_SHA256="${AIRMEISHI_SEMAPHORE_SWIFT_SHA256-}"

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

xcframework_has_static_module() {
  local root="$1"
  local module_dir="$2"
  local header="$3"
  local library="$4"

  [[ -f "$root/Info.plist" ]] || return 1

  local slice
  for slice in ios-arm64 ios-arm64-simulator; do
    [[ -f "$root/$slice/$library" ]] || return 1
    [[ -f "$root/$slice/Headers/$module_dir/module.modulemap" ]] || return 1
    [[ -f "$root/$slice/Headers/$module_dir/$header" ]] || return 1
  done
}

download_zip() {
  local url="$1"
  local output="$2"
  local token="${AIRMEISHI_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"
  local curl_args=(-fL --retry 3 --retry-delay 2 --connect-timeout 20 --output "$output")

  if [[ -n "$token" ]]; then
    curl_args+=(-H "Authorization: Bearer $token" -H "Accept: application/octet-stream")
  fi

  curl "${curl_args[@]}" "$url"
}

verify_sha256() {
  local file="$1"
  local expected="$2"

  if [[ -z "$expected" ]]; then
    return 0
  fi

  ensure_command shasum
  local actual
  actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || die "SHA-256 mismatch for $file: expected $expected, got $actual"
}

stage_xcframework_from_zip() {
  local label="$1"
  local url="$2"
  local expected_sha="$3"
  local source_name="$4"
  local destination="$5"
  local zip_name="$6"
  local temp_dir
  temp_dir="$(mktemp -d)"

  step "Downloading $label"
  local zip_path="$temp_dir/$zip_name"
  download_zip "$url" "$zip_path"
  verify_sha256 "$zip_path" "$expected_sha"

  local unpack_dir="$temp_dir/unpacked"
  mkdir -p "$unpack_dir"
  unzip -q "$zip_path" -d "$unpack_dir"

  local source
  source="$(find "$unpack_dir" -type d -name "$source_name" -print -quit)"
  [[ -n "$source" ]] || die "Downloaded $label did not contain $source_name"

  rm -rf "$destination"
  mkdir -p "$(dirname "$destination")"
  cp -R "$source" "$destination"
  rm -rf "$temp_dir"
}

ensure_passport_mopro_xcframework() {
  local xcf="$PASSPORT_NOIR_DIR/mopro-binding/MoproiOSBindings/MoproBindings.xcframework"

  if xcframework_has_static_module "$xcf" passport_zk_mopro passport_zk_moproFFI.h libpassport_zk_mopro.a; then
    green "OK Passport MoproBindings.xcframework already present"
    return 0
  fi

  stage_xcframework_from_zip \
    "Passport MoproBindings.xcframework ($PASSPORT_MOPRO_VERSION)" \
    "$PASSPORT_MOPRO_ZIP_URL" \
    "$PASSPORT_MOPRO_SHA256" \
    "MoproBindings.xcframework" \
    "$xcf" \
    "passport-mopro.zip"

  xcframework_has_static_module "$xcf" passport_zk_mopro passport_zk_moproFFI.h libpassport_zk_mopro.a \
    || die "Passport MoproBindings.xcframework is incomplete at $xcf"
}

ensure_semaphore_bindings_xcframework() {
  local xcf="$REPO_ROOT/nitro-modules/semaphore/mopro/SemaphoreBindings.xcframework"

  if xcframework_has_static_module "$xcf" semaphore_bindings semaphore_bindingsFFI.h libsemaphore_bindings.a; then
    green "OK SemaphoreBindings.xcframework already present"
    return 0
  fi

  stage_xcframework_from_zip \
    "SemaphoreSwift xcframework ($SEMAPHORE_SWIFT_REF)" \
    "$SEMAPHORE_SWIFT_ZIP_URL" \
    "$SEMAPHORE_SWIFT_SHA256" \
    "MoproBindings.xcframework" \
    "$xcf" \
    "semaphore-swift.zip"

  xcframework_has_static_module "$xcf" semaphore_bindings semaphore_bindingsFFI.h libsemaphore_bindings.a \
    || die "SemaphoreBindings.xcframework is incomplete at $xcf"
}

# Stage the OpenAC v3 merged SRS proving key. Local passport-noir build
# artifacts win; a fresh checkout (Xcode Cloud) downloads the SHA-pinned
# release copy into that same local path first. Staging itself stays in
# stage-openac-srs.sh, which also runs as an Xcode build phase and therefore
# must never touch the network. Doing all this before `pod install` keeps
# CocoaPods' generated resource scripts and input paths in a good state.
ensure_passport_openac_srs() {
  local srs_dir="$PASSPORT_NOIR_DIR/mopro-binding/test-vectors/srs"
  local srs_file="$srs_dir/passport.srs.bin"

  if [[ ! -f "$srs_file" && -z "${AIRMEISHI_PASSPORT_OPENAC_SRS_PATH:-}" ]]; then
    step "Downloading OpenAC v3 merged SRS ($PASSPORT_MOPRO_VERSION)"
    mkdir -p "$srs_dir"
    local srs_tmp="$srs_file.download.$$"
    if ! download_zip "$PASSPORT_OPENAC_SRS_URL" "$srs_tmp"; then
      rm -f "$srs_tmp"
      die "Could not download OpenAC v3 merged SRS from $PASSPORT_OPENAC_SRS_URL.
  Attach passport.srs.bin to the passport-noir $PASSPORT_MOPRO_VERSION Release,
  or point AIRMEISHI_PASSPORT_OPENAC_SRS_URL / AIRMEISHI_PASSPORT_OPENAC_SRS_PATH
  at a copy of the merged SRS."
    fi
    verify_sha256 "$srs_tmp" "$PASSPORT_OPENAC_SRS_SHA256"
    mv "$srs_tmp" "$srs_file"
    green "OK downloaded OpenAC v3 merged SRS to $srs_file"
  fi

  AIRMEISHI_EXPO_APP_DIR="$APP_DIR" \
  AIRMEISHI_REPO_ROOT="$REPO_ROOT" \
  AIRMEISHI_PASSPORT_NOIR_DIR="$PASSPORT_NOIR_DIR" \
    "$SCRIPT_DIR/stage-openac-srs.sh"
}

stage_ios_native_bindings() {
  ensure_command curl
  ensure_command unzip

  ensure_passport_mopro_xcframework
  ensure_semaphore_bindings_xcframework
  ensure_passport_openac_srs
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

if is_enabled "$SETUP_IOS_NATIVE_BINDINGS"; then
  stage_ios_native_bindings
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

# Xcode Cloud archives with AUTOMATIC Swift Package resolution DISABLED, and
# `expo prebuild --clean` wipes `ios/` every run — so a bare in-CI
# `xcodebuild -resolvePackageDependencies` is refused outright ("a resolved
# file is required when automatic dependency resolution is disabled ...
# dependencies were added: 'sprucekit-mobile'"). So we ship a CHECKED-IN,
# pre-resolved pin (scripts/ios-spm.Package.resolved), seed it into the freshly
# generated workspace FIRST, then validate it under the same disabled-resolution
# rules the archive uses — a stale pin fails here with a clear remedy instead of
# as a confusing archive-time resolver error. When the environment still allows
# real resolution (local dev), a failed validation falls back to a live resolve
# and refreshes the checked-in pin so it can be committed.
#
# Regenerate the checked-in pin after bumping SPM_VERSION in
# plugins/withSpruceIdSpmPackage.js:
#   (cd apps/expo/ios && xcodebuild -resolvePackageDependencies \
#      -workspace Solidarity.xcworkspace -scheme Solidarity) \
#   && cp apps/expo/ios/Solidarity.xcworkspace/xcshareddata/swiftpm/Package.resolved \
#         apps/expo/scripts/ios-spm.Package.resolved
# See apps/expo/CLAUDE.md (CI).
if [[ -d "$APP_DIR/ios/Solidarity.xcworkspace" ]]; then
  resolved_dst_dir="$APP_DIR/ios/Solidarity.xcworkspace/xcshareddata/swiftpm"
  resolved_src="$APP_DIR/scripts/ios-spm.Package.resolved"
  step "seed + validate Swift Package pins (Package.resolved)"
  [[ -f "$resolved_src" ]] || die "missing $resolved_src — regenerate it (see comment above)"
  mkdir -p "$resolved_dst_dir"
  cp "$resolved_src" "$resolved_dst_dir/Package.resolved"
  green "OK seeded Package.resolved from $resolved_src"
  defaults write com.apple.dt.Xcode IDEDisableAutomaticPackageResolution -bool NO 2>/dev/null || true
  defaults write com.apple.dt.Xcode IDEPackageOnlyUseVersionsFromResolvedFile -bool NO 2>/dev/null || true
  if ( cd "$APP_DIR/ios" && xcodebuild -resolvePackageDependencies \
         -workspace Solidarity.xcworkspace -scheme Solidarity \
         -disableAutomaticPackageResolution \
         -skipPackagePluginValidation ); then
    green "OK seeded Package.resolved satisfies the workspace"
  else
    red "x seeded Package.resolved is stale for this workspace — attempting a live resolve"
    ( cd "$APP_DIR/ios" && xcodebuild -resolvePackageDependencies \
        -workspace Solidarity.xcworkspace -scheme Solidarity \
        -skipPackagePluginValidation ) \
      || die "Swift Package resolution failed and the checked-in pin is stale.
  Regenerate apps/expo/scripts/ios-spm.Package.resolved on a Mac with network
  access (see comment above) and commit it."
    cp "$resolved_dst_dir/Package.resolved" "$resolved_src"
    red "! refreshed $resolved_src from the live resolve — commit it"
  fi
fi

green "OK iOS workspace prepared at $APP_DIR/ios/Solidarity.xcworkspace"
