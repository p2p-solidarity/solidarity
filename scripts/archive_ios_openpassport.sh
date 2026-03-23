#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-${ROOT_DIR}/build/DerivedData}"
ARCHIVE_PATH="${ARCHIVE_PATH:-${ROOT_DIR}/build/solidarity.xcarchive}"
RESULT_BUNDLE_PATH="${RESULT_BUNDLE_PATH:-${ROOT_DIR}/build/resultbundle.xcresult}"
PROJECT_PATH="${ROOT_DIR}/solidarity.xcodeproj"
SCHEME="${SCHEME:-solidarity}"
DESTINATION="${DESTINATION:-generic/platform=iOS}"
DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM:-538MCM44UX}"
UNSIGNED_ARCHIVE="${UNSIGNED_ARCHIVE:-1}"

"${ROOT_DIR}/scripts/prepare_openpassport_build.sh" "${DERIVED_DATA_PATH}"

mkdir -p "$(dirname "${ARCHIVE_PATH}")"
rm -rf "${ARCHIVE_PATH}" "${RESULT_BUNDLE_PATH}"

COMMON_ARGS=(
  archive
  -project "${PROJECT_PATH}"
  -scheme "${SCHEME}"
  -destination "${DESTINATION}"
  -archivePath "${ARCHIVE_PATH}"
  -derivedDataPath "${DERIVED_DATA_PATH}"
  -resultBundleVersion 3
  -resultBundlePath "${RESULT_BUNDLE_PATH}"
  -IDEPostProgressNotifications=YES
  -skipPackagePluginValidation
  -disableAutomaticPackageResolution
  COMPILER_INDEX_STORE_ENABLE=NO
  -hideShellScriptEnvironment
)

if [[ "${UNSIGNED_ARCHIVE}" == "1" ]]; then
  echo "Running unsigned archive build (CODE_SIGNING_ALLOWED=NO)..."
  xcodebuild "${COMMON_ARGS[@]}" \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGN_IDENTITY=- \
    AD_HOC_CODE_SIGNING_ALLOWED=YES \
    CODE_SIGN_STYLE=Automatic \
    DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM}"
else
  echo "Running signed archive build..."
  xcodebuild "${COMMON_ARGS[@]}" \
    CODE_SIGN_STYLE=Automatic \
    DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM}"
fi
