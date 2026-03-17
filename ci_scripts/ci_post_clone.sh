#!/bin/sh

defaults write com.apple.dt.Xcode IDESkipPackagePluginFingerprintValidatation -bool YES

defaults write com.apple.dt.Xcode IDESkipMacroFingerprintValidation -bool YES

echo "Configured Xcode to skip package plugin validation."

# Sync disclosure circuit if passport-noir checkout exists after resolution.
# The duplicate-xcframework patch is handled by ci_pre_xcodebuild.sh which
# runs after Xcode Cloud resolves packages (using the correct DerivedData path).
DERIVED_DATA="${CI_DERIVED_DATA_PATH:-/Volumes/workspace/DerivedData}"
PASSPORT_CIRCUIT_SOURCE="${DERIVED_DATA}/SourcePackages/checkouts/passport-noir/circuits/target/disclosure.json"
PASSPORT_CIRCUIT_TARGET="./airmeishi/Resources/openpassport_disclosure.json"

if [ -f "${PASSPORT_CIRCUIT_SOURCE}" ]; then
  mkdir -p "$(dirname "${PASSPORT_CIRCUIT_TARGET}")"
  cp -f "${PASSPORT_CIRCUIT_SOURCE}" "${PASSPORT_CIRCUIT_TARGET}"
  echo "Synced OpenPassport disclosure circuit."
fi
