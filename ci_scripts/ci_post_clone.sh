#!/bin/sh

defaults write com.apple.dt.Xcode IDESkipPackagePluginFingerprintValidatation -bool YES

defaults write com.apple.dt.Xcode IDESkipMacroFingerprintValidation -bool YES

echo "Configured Xcode to skip package plugin validation."

if [ -x "./scripts/prepare_openpassport_build.sh" ]; then
  DERIVED_DATA="${DERIVED_DATA_PATH:-/Volumes/workspace/DerivedData}"
  echo "Preparing OpenPassport package checkouts in ${DERIVED_DATA}..."
  ./scripts/prepare_openpassport_build.sh "${DERIVED_DATA}"
fi
