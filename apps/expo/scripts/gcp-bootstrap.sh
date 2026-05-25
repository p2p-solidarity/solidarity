#!/usr/bin/env bash
#
# One-shot bootstrap: terraform apply + generate the Play publisher SA key
# out-of-band. Idempotent — safe to re-run. Existing key is kept; pass
# --rotate-key to regenerate.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${ROOT}/infra/terraform"
PUBLISHER_KEY_PATH="${ROOT}/secrets/play-sa-key.json"
ROTATE=0

for arg in "$@"; do
  case "$arg" in
    --rotate-key) ROTATE=1 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

echo "==> Checking gcloud auth"
if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
  echo "ADC not configured. Run: gcloud auth application-default login" >&2
  exit 1
fi

echo "==> terraform apply"
cd "${TF_DIR}"
terraform init -upgrade >/dev/null
terraform apply -auto-approve

PROJECT_ID="$(terraform output -raw project_id)"
PUBLISHER_SA="$(terraform output -raw service_account_email)"

mkdir -p "${ROOT}/secrets"
chmod 700 "${ROOT}/secrets"

# gen_key <label> <sa-email> <key-path>
gen_key() {
  local label="$1" sa_email="$2" key_path="$3"
  if [[ -f "${key_path}" && "${ROTATE}" -eq 0 ]]; then
    echo "==> ${label} key already exists at ${key_path#${ROOT}/} (skip; pass --rotate-key to regenerate)"
    return
  fi
  if [[ -f "${key_path}" ]]; then
    echo "==> Rotating ${label} key (old file will be overwritten)"
  else
    echo "==> Generating ${label} key"
  fi
  gcloud iam service-accounts keys create "${key_path}" \
    --iam-account="${sa_email}" \
    --project="${PROJECT_ID}"
  chmod 600 "${key_path}"
  echo "==> ${label} key written to ${key_path#${ROOT}/}"
}

gen_key "Play publisher" "${PUBLISHER_SA}" "${PUBLISHER_KEY_PATH}"

echo
terraform output -raw next_steps
