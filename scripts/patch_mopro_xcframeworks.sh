#!/usr/bin/env bash
# Patches SemaphoreSwift's MoproBindings.xcframework to avoid
# "Unexpected duplicate tasks: SignatureCollection" when both
# SemaphoreSwift and OpenPassportSwift (passport-noir) are present.
#
# Both packages ship an xcframework named MoproBindings.xcframework.
# This script renames SemaphoreSwift's copy so Xcode sees unique names.
#
# Usage: patch_mopro_xcframeworks.sh <derived-data-path>
set -euo pipefail

DERIVED_DATA_PATH="${1:?Usage: patch_mopro_xcframeworks.sh <derived-data-path>}"

SEMAPHORE_CHECKOUT="${DERIVED_DATA_PATH}/SourcePackages/checkouts/SemaphoreSwift"
SEMAPHORE_MANIFEST="${SEMAPHORE_CHECKOUT}/Package.swift"
SEMAPHORE_BINDINGS_DIR="${SEMAPHORE_CHECKOUT}/Sources/MoproiOSBindings"
SEMAPHORE_ORIG_XCFRAMEWORK="${SEMAPHORE_BINDINGS_DIR}/MoproBindings.xcframework"
SEMAPHORE_PATCHED_XCFRAMEWORK="${SEMAPHORE_BINDINGS_DIR}/SemaphoreMoproBindings.xcframework"

if [[ ! -f "${SEMAPHORE_MANIFEST}" ]]; then
  echo "SemaphoreSwift checkout not found under ${SEMAPHORE_CHECKOUT}" >&2
  exit 1
fi

# 1) Rename the xcframework on disk
if [[ -d "${SEMAPHORE_ORIG_XCFRAMEWORK}" && ! -d "${SEMAPHORE_PATCHED_XCFRAMEWORK}" ]]; then
  echo "Renaming SemaphoreSwift xcframework to avoid duplicate SignatureCollection tasks..."
  mv "${SEMAPHORE_ORIG_XCFRAMEWORK}" "${SEMAPHORE_PATCHED_XCFRAMEWORK}"
fi

# 2) Patch Package.swift to reference the new name
perl -0pi -e 's#SemaphoreSemaphoreMoproBindings\.xcframework#SemaphoreMoproBindings.xcframework#g' "${SEMAPHORE_MANIFEST}"
perl -0pi -e 's#Sources/MoproiOSBindings/MoproBindings\.xcframework#Sources/MoproiOSBindings/SemaphoreMoproBindings.xcframework#g' "${SEMAPHORE_MANIFEST}"

# 3) Patch workspace-state.json so SPM doesn't look for the old path
WORKSPACE_STATE="${DERIVED_DATA_PATH}/SourcePackages/workspace-state.json"
if [[ -f "${WORKSPACE_STATE}" ]]; then
  perl -pi -e 's#MoproiOSBindings/MoproBindings\.xcframework#MoproiOSBindings/SemaphoreMoproBindings.xcframework#g' "${WORKSPACE_STATE}"
  echo "Patched workspace-state.json."
fi

echo "Mopro xcframework patch complete."
