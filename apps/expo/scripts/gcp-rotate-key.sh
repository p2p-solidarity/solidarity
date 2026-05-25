#!/usr/bin/env bash
#
# Rotate the Play publisher SA key.
# Lists existing keys, creates a new one, then prints the manual command
# to delete old user-managed keys after you confirm the new key works.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${ROOT}/infra/terraform"
KEY_PATH="${ROOT}/secrets/play-sa-key.json"

cd "${TF_DIR}"
SA_EMAIL="$(terraform output -raw service_account_email)"
PROJECT_ID="$(terraform output -raw project_id)"

echo "==> Existing user-managed keys for ${SA_EMAIL}:"
gcloud iam service-accounts keys list \
  --iam-account="${SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --managed-by=user

echo
echo "==> Creating new key at ${KEY_PATH#${ROOT}/}"
gcloud iam service-accounts keys create "${KEY_PATH}" \
  --iam-account="${SA_EMAIL}" \
  --project="${PROJECT_ID}"
chmod 600 "${KEY_PATH}"

echo
echo "Test the new key (e.g. bun run submit:android), then delete old keys with:"
echo "  gcloud iam service-accounts keys delete <KEY_ID> \\"
echo "    --iam-account=${SA_EMAIL} --project=${PROJECT_ID}"
