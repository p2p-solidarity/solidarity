#!/bin/sh
# Xcode Cloud: runs AFTER package resolution, BEFORE xcodebuild.
# Patches duplicate MoproBindings.xcframework to avoid
# "Unexpected duplicate tasks: SignatureCollection" build error.

DERIVED_DATA="${CI_DERIVED_DATA_PATH:-/Volumes/workspace/DerivedData}"

if [ -x "./scripts/patch_mopro_xcframeworks.sh" ]; then
  echo "Patching MoproBindings xcframework collision in ${DERIVED_DATA}..."
  ./scripts/patch_mopro_xcframeworks.sh "${DERIVED_DATA}"
fi
