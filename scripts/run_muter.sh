#!/bin/sh
set -eu

if ! command -v muter >/dev/null 2>&1; then
  echo "muter is not installed. Install it with: brew install muter-mutation-testing/formulae/muter" >&2
  exit 1
fi

if [ ! -f "muter.conf.yml" ]; then
  echo "muter.conf.yml not found. Run this script from the repository root." >&2
  exit 1
fi

# Pass through extra flags, e.g.:
# ./scripts/run_muter.sh --files-to-mutate solidarity/Services/Utils/KeyManager.swift
muter run --skip-update-check "$@"
