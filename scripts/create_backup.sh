#!/usr/bin/env bash
set -euo pipefail

cd /mnt/c/Users/mabba/Desktop/AbaYa-Track-v1.0.2

ts="$(date +%F_%H%M)"
dest="/mnt/d/AbaYaBackups/${ts}"

mkdir -p "$dest" "$dest/external-excel"

if [ -f ".env" ]; then
  cp -a ".env" "$dest/"
fi
if [ -d "data" ]; then
  cp -a "data" "$dest/"
fi
if [ -d "public/uploads" ]; then
  mkdir -p "$dest/public"
  cp -a "public/uploads" "$dest/public/"
fi

EXCEL_DATA_DIR=""
CATALOG_XLSX_PATH=""
EMPLOYEES_XLSX_PATH=""
FLOOR_EXPORT_SECRET=""
CATALOG_INGEST_SECRET=""
CF_INGEST_SECRET=""

while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  case "$line" in
    ""|\#*) continue ;;
  esac
  key="${line%%=*}"
  val="${line#*=}"
  case "$key" in
    EXCEL_DATA_DIR) EXCEL_DATA_DIR="$val" ;;
    CATALOG_XLSX_PATH) CATALOG_XLSX_PATH="$val" ;;
    EMPLOYEES_XLSX_PATH) EMPLOYEES_XLSX_PATH="$val" ;;
    FLOOR_EXPORT_SECRET) FLOOR_EXPORT_SECRET="$val" ;;
    CATALOG_INGEST_SECRET) CATALOG_INGEST_SECRET="$val" ;;
    CF_INGEST_SECRET) CF_INGEST_SECRET="$val" ;;
  esac
done < ".env"

to_wsl_path() {
  local p="$1"
  if [ -z "$p" ]; then
    return 0
  fi
  p="${p//\\//}"
  if [[ "$p" =~ ^([A-Za-z]):/ ]]; then
    local d="${BASH_REMATCH[1],,}"
    echo "/mnt/${d}/${p:3}"
  else
    echo "$p"
  fi
}

copied_excel=0
for raw in "$EXCEL_DATA_DIR" "$CATALOG_XLSX_PATH" "$EMPLOYEES_XLSX_PATH"; do
  [ -z "$raw" ] && continue
  p="$(to_wsl_path "$raw")"
  if [ -d "$p" ]; then
    bn="$(basename "$p")"
    cp -a "$p" "$dest/external-excel/$bn"
    copied_excel=$((copied_excel + 1))
  elif [ -f "$p" ]; then
    cp -a "$p" "$dest/external-excel/"
    copied_excel=$((copied_excel + 1))
  fi
done

secret="$FLOOR_EXPORT_SECRET"
[ -z "$secret" ] && secret="$CATALOG_INGEST_SECRET"
[ -z "$secret" ] && secret="$CF_INGEST_SECRET"

export_ok=0
if [ -n "$secret" ]; then
  if curl -fsS -H "X-Export-Secret: $secret" "http://127.0.0.1:3000/api/export/floor-sessions.json" -o "$dest/floor-sessions.json"; then
    export_ok=1
  fi
fi

# Strict verification (same normalizer as import API + backup-folder minute slice). Non-zero exit if FAIL.
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
yarn node "$_SCRIPT_DIR/verify-floor-export-backup.js" "$dest" "${export_ok}" "${copied_excel}"
verify_rc=$?

echo "BACKUP_PATH=$dest"
exit "${verify_rc}"
