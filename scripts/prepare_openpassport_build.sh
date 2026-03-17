#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DERIVED_DATA_PATH="${1:-${ROOT_DIR}/build/DerivedData}"
PROJECT_PATH="${ROOT_DIR}/airmeishi.xcodeproj"
SCHEME="${SCHEME:-airmeishi}"

if [[ ! -d "${PROJECT_PATH}" ]]; then
  echo "Project not found at ${PROJECT_PATH}" >&2
  exit 1
fi

mkdir -p "${DERIVED_DATA_PATH}"

echo "Resolving Swift packages into ${DERIVED_DATA_PATH}..."
xcodebuild -resolvePackageDependencies \
  -project "${PROJECT_PATH}" \
  -scheme "${SCHEME}" \
  -derivedDataPath "${DERIVED_DATA_PATH}" \
  -skipPackagePluginValidation

SEMAPHORE_CHECKOUT="${DERIVED_DATA_PATH}/SourcePackages/checkouts/SemaphoreSwift"
SEMAPHORE_MANIFEST="${SEMAPHORE_CHECKOUT}/Package.swift"
SEMAPHORE_BINDINGS_DIR="${SEMAPHORE_CHECKOUT}/Sources/MoproiOSBindings"
SEMAPHORE_ORIG_XCFRAMEWORK="${SEMAPHORE_BINDINGS_DIR}/MoproBindings.xcframework"
SEMAPHORE_PATCHED_XCFRAMEWORK="${SEMAPHORE_BINDINGS_DIR}/SemaphoreMoproBindings.xcframework"

if [[ ! -f "${SEMAPHORE_MANIFEST}" ]]; then
  echo "SemaphoreSwift checkout not found under ${SEMAPHORE_CHECKOUT}" >&2
  exit 1
fi

if [[ -d "${SEMAPHORE_ORIG_XCFRAMEWORK}" && ! -d "${SEMAPHORE_PATCHED_XCFRAMEWORK}" ]]; then
  echo "Patching SemaphoreSwift xcframework name to avoid duplicate SignatureCollection tasks..."
  mv "${SEMAPHORE_ORIG_XCFRAMEWORK}" "${SEMAPHORE_PATCHED_XCFRAMEWORK}"
fi

perl -0pi -e 's#SemaphoreSemaphoreMoproBindings\.xcframework#SemaphoreMoproBindings.xcframework#g' "${SEMAPHORE_MANIFEST}"
perl -0pi -e 's#Sources/MoproiOSBindings/MoproBindings\.xcframework#Sources/MoproiOSBindings/SemaphoreMoproBindings.xcframework#g' "${SEMAPHORE_MANIFEST}"

PASSPORT_CIRCUIT_SOURCE="${DERIVED_DATA_PATH}/SourcePackages/checkouts/passport-noir/circuits/target/disclosure.json"
PASSPORT_CIRCUIT_TARGET="${ROOT_DIR}/airmeishi/Resources/openpassport_disclosure.json"

if [[ -f "${PASSPORT_CIRCUIT_SOURCE}" ]]; then
  mkdir -p "$(dirname "${PASSPORT_CIRCUIT_TARGET}")"
  if [[ -f "${PASSPORT_CIRCUIT_TARGET}" ]]; then
    chmod u+w "${PASSPORT_CIRCUIT_TARGET}"
  fi
  cp -f "${PASSPORT_CIRCUIT_SOURCE}" "${PASSPORT_CIRCUIT_TARGET}"
  echo "Synced OpenPassport disclosure circuit to ${PASSPORT_CIRCUIT_TARGET}"
else
  echo "Warning: disclosure circuit not found at ${PASSPORT_CIRCUIT_SOURCE}" >&2
fi

echo "OpenPassport build preparation complete."
