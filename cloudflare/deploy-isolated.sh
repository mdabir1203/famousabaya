#!/usr/bin/env bash
# Deploy Worker from a temp copy so the repo-root Yarn PnP (.pnp.cjs) does not break
# Wrangler's esbuild when resolving @cloudflare/unenv-preset (WSL/Linux).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_ROOT="${TMPDIR:-/tmp}/abaya-cf-deploy-root"
RUN_SMOKE=0
CEO_TOKEN=""
declare -a DEPLOY_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --smoke)
      RUN_SMOKE=1
      shift
      ;;
    --token)
      CEO_TOKEN="${2:-}"
      if [[ -z "$CEO_TOKEN" ]]; then
        echo "ERROR: --token requires a value" >&2
        exit 1
      fi
      shift 2
      ;;
    *)
      DEPLOY_ARGS+=("$1")
      shift
      ;;
  esac
done

rm -rf "$TMP_ROOT"
mkdir -p "$TMP_ROOT/cloudflare" "$TMP_ROOT/shared"

# Keep original repo layout so ../../shared imports continue to resolve.
rsync -a --exclude node_modules --exclude .yarn "$REPO_ROOT/cloudflare/" "$TMP_ROOT/cloudflare/"
rsync -a "$REPO_ROOT/shared/" "$TMP_ROOT/shared/"

cd "$TMP_ROOT/cloudflare"
command -v nvm >/dev/null 2>&1 && nvm use --lts 2>/dev/null || true
npm install
npx wrangler deploy "${DEPLOY_ARGS[@]}"

if [[ "$RUN_SMOKE" -eq 1 ]]; then
  URL="https://dashboard.farewellabaya.com"
  echo ""
  echo "Running smoke checks for $URL"
  curl -fsSI "$URL/" >/dev/null && echo "OK: / responds" || { echo "FAIL: / did not respond"; exit 1; }
  HTML="$(curl -fsS "$URL/")" || { echo "FAIL: could not download dashboard HTML"; exit 1; }
  if [[ "$HTML" == *"AbaYa"* || "$HTML" == *"dashboard"* || "$HTML" == *"Access Dashboard"* ]]; then
    echo "OK: dashboard HTML fingerprint found"
  else
    echo "FAIL: dashboard HTML fingerprint missing"
    exit 1
  fi

  if [[ -n "$CEO_TOKEN" ]]; then
    STATE_JSON="$(curl -fsS "$URL/api/state?token=$CEO_TOKEN")" || { echo "FAIL: /api/state request failed"; exit 1; }
    if [[ "$STATE_JSON" == *"\"ok\""* || "$STATE_JSON" == *"\"day\""* || "$STATE_JSON" == *"\"totals\""* ]]; then
      echo "OK: /api/state responded with expected JSON keys"
    else
      echo "FAIL: /api/state check failed"
      exit 1
    fi
  else
    echo "INFO: skipping /api/state smoke check (pass --token <CEO_TOKEN> to enable)"
  fi
fi
