#!/bin/sh
set -eu

# Xcode Cloud pre-xcodebuild script:
# 1) Inject cloud xcconfig
# 2) Build a generic UniFFI shim modulemap from all *FFI.h headers
# 3) Verify Semaphore binary baseline
#
# OpenPassport circuit is committed in-repo as openpassport_disclosure.acir —
# do NOT resync from the passport-noir package checkout; its disclosure.json
# is incompatible with the linked Barretenberg version and caused Cloud-build
# native prover crashes (local Release build with repo file runs fine).

DERIVED_DATA="${CI_DERIVED_DATA_PATH:-/Volumes/workspace/DerivedData}"
WORKSPACE_ROOT="${CI_WORKSPACE:-/Volumes/workspace}"
REPO_ROOT="${WORKSPACE_ROOT}/repository"
XCLOUD_XCCONFIG_PATH="${REPO_ROOT}/ci_scripts/cloud-overrides.xcconfig"
FFI_SHIM_DIR="${REPO_ROOT}/ci_scripts/semaphore_ffi_shim"
MIN_SEMAPHORE_LIB_SIZE_BYTES="${MIN_SEMAPHORE_LIB_SIZE_BYTES:-1000000}"

log() {
  echo "[ci_pre_xcodebuild] $1"
}

die() {
  echo "[ci_pre_xcodebuild] ERROR: $1" >&2
  exit 1
}

resolve_first_existing() {
  for candidate in "$@"; do
    if [ -e "${candidate}" ]; then
      echo "${candidate}"
      return 0
    fi
  done
  return 1
}

setup_cloud_xcconfig() {
  if [ -f "${XCLOUD_XCCONFIG_PATH}" ]; then
    export XCODE_XCCONFIG_FILE="${XCLOUD_XCCONFIG_PATH}"
    log "Injected XCODE_XCCONFIG_FILE=${XCODE_XCCONFIG_FILE}"
  else
    log "cloud-overrides.xcconfig not found. Continue without XCODE_XCCONFIG_FILE."
  fi
}

validate_semaphore_binary() {
  semaphore_checkout="$(resolve_first_existing \
    "${DERIVED_DATA}/SourcePackages/checkouts/SemaphoreSwift" \
    "${DERIVED_DATA}/SourcePackages/checkouts/semaphoreswift")" || \
    die "SemaphoreSwift checkout not found under DerivedData/SourcePackages/checkouts."

  semaphore_lib="${semaphore_checkout}/Sources/MoproiOSBindings/MoproBindings.xcframework/ios-arm64/libsemaphore_bindings.a"
  if [ ! -f "${semaphore_lib}" ]; then
    die "Semaphore static library missing: ${semaphore_lib}"
  fi

  semaphore_lib_size="$(stat -f%z "${semaphore_lib}" 2>/dev/null || stat -c%s "${semaphore_lib}" 2>/dev/null || echo 0)"
  if [ "${semaphore_lib_size}" -lt "${MIN_SEMAPHORE_LIB_SIZE_BYTES}" ]; then
    die "Semaphore static library appears truncated (${semaphore_lib_size} bytes)."
  fi

  SEMAPHORE_HEADER="${semaphore_checkout}/Sources/MoproiOSBindings/MoproBindings.xcframework/ios-arm64/Headers/semaphore_bindings/semaphore_bindingsFFI.h"
  if [ ! -f "${SEMAPHORE_HEADER}" ]; then
    die "Semaphore FFI header missing: ${SEMAPHORE_HEADER}"
  fi

  log "Semaphore library validated (${semaphore_lib_size} bytes)."
}

prepare_ffi_shim() {
  rm -rf "${FFI_SHIM_DIR}"
  mkdir -p "${FFI_SHIM_DIR}"

  # Always include Semaphore header.
  cp -f "${SEMAPHORE_HEADER}" "${FFI_SHIM_DIR}/semaphore_bindingsFFI.h"

  # Collect all UniFFI headers from SourcePackages to avoid hardcoding package names.
  find "${DERIVED_DATA}/SourcePackages" -type f -name '*FFI.h' 2>/dev/null | while IFS= read -r ffi_header; do
    base_name="$(basename "${ffi_header}")"
    cp -f "${ffi_header}" "${FFI_SHIM_DIR}/${base_name}"
  done

  # Generate one modulemap entry per copied *FFI.h file.
  : > "${FFI_SHIM_DIR}/module.modulemap"
  header_count=0
  for header_path in "${FFI_SHIM_DIR}"/*FFI.h; do
    if [ ! -f "${header_path}" ]; then
      continue
    fi

    header_name="$(basename "${header_path}")"
    module_name="${header_name%.h}"
    header_count=$((header_count + 1))
    cat >> "${FFI_SHIM_DIR}/module.modulemap" <<EOF
module ${module_name} {
  header "${header_name}"
  export *
}

EOF
  done

  if [ "${header_count}" -eq 0 ]; then
    die "No *FFI.h headers were discovered for UniFFI shim."
  fi

  log "Prepared UniFFI shim with ${header_count} module(s)."
}

setup_cloud_xcconfig
validate_semaphore_binary
prepare_ffi_shim
