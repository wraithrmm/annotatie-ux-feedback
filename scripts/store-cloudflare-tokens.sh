#!/usr/bin/env bash
# Store the two Cloudflare API tokens in SSM (SecureString) without echoing them or writing them to disk.
# Run from the repo root in Git Bash:  AWS_PROFILE=<admin profile> scripts/store-cloudflare-tokens.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export AWS_REGION="${AWS_REGION:-eu-west-2}"

store() {
  local name="$1" label="$2" token
  read -rsp "Paste the $label token, then press Enter (nothing will show): " token
  echo
  [[ -n "$token" ]] || { echo "Empty - skipped $name"; return; }
  # Pass the value on stdin so it never appears in a process list or in shell history.
  printf '%s' "$token" | bin/toolbox sh -c "aws ssm put-parameter --name '$name' --type SecureString --overwrite --value \"\$(cat)\" --query Version --output text" >/dev/null
  unset token
  echo "Stored $name"
}

store /annotatie/cloudflare/api-token "annotatie-deploy (DNS Edit)"
store /annotatie/cloudflare/api-token-read "annotatie-plan (read only)"
echo "Done. You can close this tab."
