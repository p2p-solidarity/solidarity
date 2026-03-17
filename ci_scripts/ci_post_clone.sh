#!/bin/sh
set -eu

defaults write com.apple.dt.Xcode IDESkipPackagePluginFingerprintValidatation -bool YES

defaults write com.apple.dt.Xcode IDESkipMacroFingerprintValidation -bool YES

echo "Configured Xcode to skip package plugin and macro validation."
