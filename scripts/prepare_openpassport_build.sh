#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DERIVED_DATA_PATH="${1:-${ROOT_DIR}/build/DerivedData}"
PROJECT_PATH="${ROOT_DIR}/solidarity.xcodeproj"
SCHEME="${SCHEME:-solidarity}"
EXPECTED_NOIR_VERSION_PREFIX="${EXPECTED_NOIR_VERSION_PREFIX:-1.0.0-beta.8}"
PASSPORT_NOIR_ROOT="${OPENPASSPORT_REPO_PATH:-${ROOT_DIR}/../passport-noir}"

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

PASSPORT_CIRCUIT_TARGET="${ROOT_DIR}/solidarity/Resources/openpassport_disclosure.json"
PASSPORT_SRS_SOURCE="${OPENPASSPORT_SRS_SOURCE:-}"
PASSPORT_SRS_TARGET="${ROOT_DIR}/solidarity/Resources/openpassport_srs.bin"

read_noir_version() {
  local circuit_file="$1"
  python3 - "${circuit_file}" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)
print(data.get("noir_version", ""))
PY
}

declare -a CIRCUIT_SOURCE_CANDIDATES=()
if [[ -n "${OPENPASSPORT_CIRCUIT_SOURCE:-}" ]]; then
  CIRCUIT_SOURCE_CANDIDATES=("${OPENPASSPORT_CIRCUIT_SOURCE}")
else
  CIRCUIT_SOURCE_CANDIDATES=(
    "${PASSPORT_NOIR_ROOT}/mopro-binding/test-vectors/noir/disclosure.json"
    "${PASSPORT_NOIR_ROOT}/circuits/target/disclosure.json"
    "${DERIVED_DATA_PATH}/SourcePackages/checkouts/passport-noir/circuits/target/disclosure.json"
  )
fi

PASSPORT_CIRCUIT_SOURCE=""
SOURCE_NOIR_VERSION=""
for candidate in "${CIRCUIT_SOURCE_CANDIDATES[@]}"; do
  if [[ ! -f "${candidate}" ]]; then
    continue
  fi
  candidate_version="$(read_noir_version "${candidate}")"
  if [[ -z "${candidate_version}" ]]; then
    echo "Warning: could not read noir_version from ${candidate}; skipping candidate." >&2
    continue
  fi
  if [[ "${candidate_version}" == "${EXPECTED_NOIR_VERSION_PREFIX}"* ]]; then
    PASSPORT_CIRCUIT_SOURCE="${candidate}"
    SOURCE_NOIR_VERSION="${candidate_version}"
    break
  fi
  echo "Warning: candidate noir_version '${candidate_version}' from ${candidate} does not match expected '${EXPECTED_NOIR_VERSION_PREFIX}.x'" >&2
done

if [[ -n "${PASSPORT_CIRCUIT_SOURCE}" ]]; then
  mkdir -p "$(dirname "${PASSPORT_CIRCUIT_TARGET}")"
  if [[ -f "${PASSPORT_CIRCUIT_TARGET}" ]]; then
    chmod u+w "${PASSPORT_CIRCUIT_TARGET}"
  fi
  cp -f "${PASSPORT_CIRCUIT_SOURCE}" "${PASSPORT_CIRCUIT_TARGET}"
  echo "Synced OpenPassport disclosure circuit (${SOURCE_NOIR_VERSION}) from ${PASSPORT_CIRCUIT_SOURCE}"
else
  echo "Warning: no compatible disclosure circuit artifact found; keeping existing ${PASSPORT_CIRCUIT_TARGET}" >&2
fi

if [[ -n "${PASSPORT_SRS_SOURCE}" ]]; then
  if [[ -f "${PASSPORT_SRS_SOURCE}" ]]; then
    mkdir -p "$(dirname "${PASSPORT_SRS_TARGET}")"
    if [[ -f "${PASSPORT_SRS_TARGET}" ]]; then
      chmod u+w "${PASSPORT_SRS_TARGET}"
    fi
    cp -f "${PASSPORT_SRS_SOURCE}" "${PASSPORT_SRS_TARGET}"
    echo "Synced OpenPassport SRS to ${PASSPORT_SRS_TARGET}"
  else
    echo "Warning: OPENPASSPORT_SRS_SOURCE set but file not found: ${PASSPORT_SRS_SOURCE}" >&2
  fi
elif [[ ! -f "${PASSPORT_SRS_TARGET}" ]]; then
  echo "Warning: OpenPassport SRS not found at ${PASSPORT_SRS_TARGET}. Set OPENPASSPORT_SRS_SOURCE to sync one." >&2
fi

echo "OpenPassport build preparation complete."
