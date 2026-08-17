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
# SHA-pinned Node build staged when the PATH node's CPU arch differs from
# bun's (see ensure_bundle_node_matches_bun). Pins from
# https://nodejs.org/dist/${MATCHED_NODE_VERSION}/SHASUMS256.txt — update both
# arch hashes together when bumping the version.
MATCHED_NODE_VERSION="${AIRMEISHI_MATCHED_NODE_VERSION:-v24.18.0}"
MATCHED_NODE_SHA256_DARWIN_ARM64="${AIRMEISHI_MATCHED_NODE_SHA256_DARWIN_ARM64-e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1}"
MATCHED_NODE_SHA256_DARWIN_X64="${AIRMEISHI_MATCHED_NODE_SHA256_DARWIN_X64-dfd0dbd3e721503434df7b7205e719f61b3a3a31b2bcf9729b8b91fea240f080}"
MATCHED_NODE_BASE_URL="${AIRMEISHI_MATCHED_NODE_BASE_URL:-https://nodejs.org/dist}"
MATCHED_NODE_CACHE_DIR="${AIRMEISHI_MATCHED_NODE_CACHE_DIR:-$HOME/.cache/airmeishi/node}"

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
  # Xcode Cloud's workflow is configured to archive the lowercase `solidarity`
  # scheme; the logic lives in normalize-ios-scheme.sh so `bun run ios` (local
  # dev) and this CI/archive path cannot drift.
  AIRMEISHI_EXPO_APP_DIR="$APP_DIR" "$SCRIPT_DIR/normalize-ios-scheme.sh" \
    || die "scheme normalization failed"
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

# The "Bundle React Native code and images" archive phase runs Metro under
# NODE_BINARY (ios/.xcode.env → `command -v node`), while platform-specific
# npm native bindings were installed by bun for BUN's arch. Xcode Cloud's
# macOS Tahoe image mixes the two: `brew install node` comes from the image's
# Intel-prefix Homebrew (/usr/local, x86_64 under Rosetta), while the
# oven-sh/bun formula detects the physical Apple Silicon CPU and installs
# native arm64 bun — so the archive died at the very end with "Cannot find
# module '../lightningcss.darwin-x64.node'" (Builds 153/154). Three layers of
# defense, checked right after bun install so a failure surfaces at
# post-clone time with a clear message instead of five minutes into the
# archive:
#   1. ensure_bundle_node_matches_bun — when the archs diverge, stage a
#      SHA-pinned nodejs.org build matching bun's arch and point the bundle
#      phase at it via ios/.xcode.env.local (fixes the whole class).
#   2. probe_bundle_node_deps — load metro.config.js (expo/metro-config →
#      nativewind → react-native-css-interop → lightningcss) with the same
#      node the bundle phase will use, so ANY missing bundle-time native
#      binding is caught here.
#   3. ensure_lightningcss_node_binding — last-resort self-heal for the one
#      known native dep when the matched node could not be staged.
BUNDLE_NODE_BINARY=""

ensure_bundle_node_matches_bun() {
  BUNDLE_NODE_BINARY="$(command -v node)"
  local node_arch bun_arch platform
  node_arch="$(node -p "process.arch")"
  bun_arch="$(bun -e "process.stdout.write(process.arch)")"
  if [[ "$node_arch" == "$bun_arch" ]]; then
    green "OK node and bun agree on CPU arch ($node_arch)"
    return 0
  fi

  red "! node is $node_arch but bun is $bun_arch — bun installed $bun_arch-only native bindings"
  platform="$(node -p "process.platform")"
  local sha
  case "$platform-$bun_arch" in
    darwin-arm64) sha="$MATCHED_NODE_SHA256_DARWIN_ARM64" ;;
    darwin-x64) sha="$MATCHED_NODE_SHA256_DARWIN_X64" ;;
    *)
      red "! no pinned Node build for $platform-$bun_arch — falling back to per-package binding staging"
      return 0
      ;;
  esac

  local dist_dir="$MATCHED_NODE_CACHE_DIR/node-$MATCHED_NODE_VERSION-$platform-$bun_arch"
  local staged="$dist_dir/bin/node"
  if [[ ! -x "$staged" ]]; then
    step "Staging Node $MATCHED_NODE_VERSION ($platform-$bun_arch) to match bun"
    local temp_dir tarball url
    temp_dir="$(mktemp -d)"
    tarball="$temp_dir/node.tar.gz"
    url="$MATCHED_NODE_BASE_URL/$MATCHED_NODE_VERSION/node-$MATCHED_NODE_VERSION-$platform-$bun_arch.tar.gz"
    # Plain curl, not download_zip: that helper attaches the GitHub token,
    # which must not leak to nodejs.org.
    if ! curl -fL --retry 3 --retry-delay 2 --connect-timeout 20 --output "$tarball" "$url"; then
      rm -rf "$temp_dir"
      red "! could not download $url — falling back to per-package binding staging"
      return 0
    fi
    verify_sha256 "$tarball" "$sha"
    rm -rf "$dist_dir"
    mkdir -p "$dist_dir"
    tar -xzf "$tarball" -C "$dist_dir" --strip-components 1
    rm -rf "$temp_dir"
    [[ -x "$staged" ]] || die "staged Node tarball did not contain bin/node"
  fi
  BUNDLE_NODE_BINARY="$staged"
  green "OK bundle phase will use $staged"
}

probe_bundle_node_deps() {
  ( cd "$APP_DIR" && "$BUNDLE_NODE_BINARY" -e "require('$APP_DIR/metro.config.js'); process.exit(0)" )
}

ensure_lightningcss_node_binding() {
  # Direct path, not require('lightningcss/package.json'): the package's
  # exports map blocks the subpath.
  local version
  version="$("$BUNDLE_NODE_BINARY" -p "require('$REPO_ROOT/node_modules/lightningcss/package.json').version" 2>/dev/null)" \
    || die "lightningcss is not installed — run bun install first"

  local pkg
  pkg="lightningcss-$("$BUNDLE_NODE_BINARY" -p "process.platform + '-' + process.arch")"
  step "Staging $pkg@$version (bun arch != node arch)"
  ensure_command npm

  local temp_dir
  temp_dir="$(mktemp -d)"
  ( cd "$temp_dir" && npm pack "$pkg@$version" --silent >/dev/null ) \
    || die "Could not download $pkg@$version from the npm registry"

  local dest="$REPO_ROOT/node_modules/$pkg"
  rm -rf "$dest"
  mkdir -p "$dest"
  tar -xzf "$temp_dir"/lightningcss-*.tgz -C "$dest" --strip-components 1
  rm -rf "$temp_dir"
  green "OK staged $pkg@$version into node_modules"
}

ensure_bundle_node_deps() {
  ensure_bundle_node_matches_bun
  if probe_bundle_node_deps >/dev/null 2>&1; then
    green "OK bundle-time native bindings load under $BUNDLE_NODE_BINARY"
    return 0
  fi
  ensure_lightningcss_node_binding
  probe_bundle_node_deps \
    || die "metro.config.js still cannot load under $BUNDLE_NODE_BINARY —
  a bundle-time dependency is missing a native binding for this node's arch."
  green "OK bundle-time native bindings load under $BUNDLE_NODE_BINARY (after staging lightningcss)"
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

ensure_bundle_node_deps

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

# Written AFTER prebuild: `expo prebuild --clean` wipes ios/. The RN bundle
# phase sources ios/.xcode.env (NODE_BINARY=$(command -v node)) and then
# ios/.xcode.env.local, so this override wins and the bundle runs on the
# arch-matched node staged above. Gitignored (ios/.gitignore).
if [[ -n "$BUNDLE_NODE_BINARY" && "$BUNDLE_NODE_BINARY" != "$(command -v node)" ]]; then
  printf 'export NODE_BINARY=%q\n' "$BUNDLE_NODE_BINARY" > "$APP_DIR/ios/.xcode.env.local"
  green "OK wrote ios/.xcode.env.local → NODE_BINARY=$BUNDLE_NODE_BINARY"
fi

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
#      -workspace Solidarity.xcworkspace -scheme solidarity) \
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
         -workspace Solidarity.xcworkspace -scheme solidarity \
         -disableAutomaticPackageResolution \
         -skipPackagePluginValidation ); then
    green "OK seeded Package.resolved satisfies the workspace"
  else
    red "x seeded Package.resolved is stale for this workspace — attempting a live resolve"
    ( cd "$APP_DIR/ios" && xcodebuild -resolvePackageDependencies \
        -workspace Solidarity.xcworkspace -scheme solidarity \
        -skipPackagePluginValidation ) \
      || die "Swift Package resolution failed and the checked-in pin is stale.
  Regenerate apps/expo/scripts/ios-spm.Package.resolved on a Mac with network
  access (see comment above) and commit it."
    cp "$resolved_dst_dir/Package.resolved" "$resolved_src"
    red "! refreshed $resolved_src from the live resolve — commit it"
  fi
fi

green "OK iOS workspace prepared at $APP_DIR/ios/Solidarity.xcworkspace"
