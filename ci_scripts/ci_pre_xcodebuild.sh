#!/bin/sh
set -eu

# Xcode Cloud: runs AFTER package resolution, BEFORE xcodebuild.
# Syncs OpenPassport disclosure circuit from resolved package checkout.

DERIVED_DATA="${CI_DERIVED_DATA_PATH:-/Volumes/workspace/DerivedData}"
PASSPORT_CIRCUIT_SOURCE="${DERIVED_DATA}/SourcePackages/checkouts/passport-noir/circuits/target/disclosure.json"
PASSPORT_CIRCUIT_TARGET="./airmeishi/Resources/openpassport_disclosure.json"

if [ -f "${PASSPORT_CIRCUIT_SOURCE}" ]; then
  mkdir -p "$(dirname "${PASSPORT_CIRCUIT_TARGET}")"
  cp -f "${PASSPORT_CIRCUIT_SOURCE}" "${PASSPORT_CIRCUIT_TARGET}"
  echo "Synced OpenPassport disclosure circuit."
else
  echo "OpenPassport disclosure circuit not found at ${PASSPORT_CIRCUIT_SOURCE}; using repo version."
fi
