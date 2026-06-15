#!/usr/bin/env bash
#
# Submit a locally-built AAB to Google Play via `eas submit`.
# Uses the SA key path configured in eas.json (./secrets/play-sa-key.json).
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_PATH="${ROOT}/secrets/play-sa-key.json"

AAB_PATH="${1:-}"

if [[ -z "${AAB_PATH}" ]]; then
  # Default: pick the most recent .aab under build/ or repo root
  AAB_PATH="$(ls -t "${ROOT}"/build/*.aab "${ROOT}"/*.aab 2>/dev/null | head -1 || true)"
fi

if [[ -z "${AAB_PATH}" || ! -f "${AAB_PATH}" ]]; then
  echo "AAB not found." >&2
  echo "Build first: bun run build:android:local" >&2
  echo "Or pass an explicit path: bun run submit:android ./path/to/app.aab" >&2
  exit 1
fi

if [[ ! -f "${KEY_PATH}" ]]; then
  echo "SA key missing at ${KEY_PATH}." >&2
  echo "Run: bun run gcp:bootstrap" >&2
  exit 1
fi

echo "==> Submitting ${AAB_PATH#${ROOT}/}"
cd "${ROOT}"
eas submit \
  --platform android \
  --profile production \
  --path "${AAB_PATH}" \
  --non-interactive
