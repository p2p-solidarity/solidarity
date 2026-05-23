#!/bin/sh
# Xcode Cloud post-clone hook for the Expo target.
#
# Why this exists: Xcode Cloud's macOS image has no Node.js installed and
# no knowledge of bun workspaces. We bootstrap the JS toolchain here so
# `expo prebuild` can regenerate the iOS native project before Xcode Cloud
# runs `xcodebuild archive`.
#
# Per Apple's Xcode Cloud contract, this script must live at
# ios/ci_scripts/ci_post_clone.sh relative to the Xcode project — which,
# after `expo prebuild`, is apps/expo/ios/. It's force-tracked via
# `git add -f` (see root .gitignore: apps/expo/ios/ is ignored except
# the ci_scripts/ subtree).
set -euo pipefail

echo "▸ Solidarity Xcode Cloud post-clone"
echo "▸ cwd: $(pwd)"
echo "▸ CI_PRIMARY_REPOSITORY_PATH: ${CI_PRIMARY_REPOSITORY_PATH:-unset}"

# Move to repo root (Xcode Cloud's checkout dir).
cd "${CI_PRIMARY_REPOSITORY_PATH:-$(pwd)/../../../..}"
echo "▸ At repo root: $(pwd)"

# 1. Install Node (LTS via Homebrew). Xcode Cloud ships Homebrew preinstalled.
echo "▸ Installing Node via Homebrew…"
brew install node

# 2. Install Bun (workspace manager — chosen for speed + workspace support).
echo "▸ Installing Bun…"
brew install oven-sh/bun/bun

# 3. Install workspace dependencies from the monorepo root.
echo "▸ bun install (workspace root)…"
bun install --frozen-lockfile

# 4. Regenerate the iOS native project from app.json + plugins.
echo "▸ expo prebuild --clean --platform ios…"
cd apps/expo
bunx expo prebuild --clean --platform ios --no-install

echo "✓ Ready — Xcode Cloud will now archive + sign + ship to TestFlight."
echo "✓ Certs are auto-managed via App Store Connect (no EAS Secrets required)."
