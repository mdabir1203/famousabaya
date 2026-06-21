#!/usr/bin/env bash
# Boot the factory server in the background, hit the new endpoints, and tear it down.
# Used by the rollout evaluation only. Avoid `set -u` (clashes with nvm.sh).
set -e -o pipefail

REPO=${REPO:-/mnt/c/Users/mabba/Desktop/AbaYa-Track-v1.0.2}
PORT=${PORT:-3791}
LOG=/tmp/abaya-eval-server.log
PID_FILE=/tmp/abaya-eval-server.pid

# shellcheck disable=SC1091
if [ -f "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
  nvm use --lts >/dev/null 2>&1 || true
fi

cd "$REPO"
PORT="$PORT" SQLITE_SNAPSHOT_ENABLED=0 RECONCILE_ENABLED=0 \
  node -r ./.pnp.cjs server.js >"$LOG" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

cleanup() {
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

ready=0
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/api/client-config" >/dev/null 2>&1; then
    ready=$i
    break
  fi
  sleep 0.5
done

if [ "$ready" -eq 0 ]; then
  echo "FAIL: server did not become ready"
  echo "----- last 60 lines of $LOG -----"
  tail -n 60 "$LOG" || true
  exit 1
fi

echo "ready_after=${ready}half-seconds"

echo
echo "----- /api/client-config (subset) -----"
curl -fsS "http://127.0.0.1:$PORT/api/client-config" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const j=JSON.parse(s); const out={ok:j.ok,ceoSyncMode:j.ceoSyncMode,ceoIngestPending:j.ceoIngestPending,database:{source:j.database&&j.database.source,syncMode:j.database&&j.database.syncMode,cloudConfigured:j.database&&j.database.cloudConfigured,pendingQueue:j.database&&j.database.pendingQueue,reconcile:j.database&&j.database.reconcile?{enabled:j.database.reconcile.enabled,intervalMs:j.database.reconcile.intervalMs}:null,sqliteSnapshot:j.database&&j.database.sqliteSnapshot?{enabled:j.database.sqliteSnapshot.enabled,intervalMs:j.database.sqliteSnapshot.intervalMs}:null,alerts:j.database&&j.database.alerts?{enabled:j.database.alerts.enabled,initialized:j.database.alerts.initialized}:null,ingestStats:j.database&&j.database.ingestStats?{pushOk:j.database.ingestStats.pushOk,pushQueued:j.database.ingestStats.pushQueued}:null}};console.log(JSON.stringify(out,null,2));})'

echo
echo "----- /api/ceo-ingest-status (subset) -----"
curl -fsS "http://127.0.0.1:$PORT/api/ceo-ingest-status" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const j=JSON.parse(s);const out={ok:j.ok,enabled:j.enabled,mode:j.mode,pending:j.pending,reconcile:j.reconcile?{enabled:j.reconcile.enabled}:null,sqliteSnapshot:j.sqliteSnapshot?{enabled:j.sqliteSnapshot.enabled}:null,ingestStats:j.ingestStats?{pushOk:j.ingestStats.pushOk,pushQueued:j.ingestStats.pushQueued}:null,alerts:j.alerts?{enabled:j.alerts.enabled,initialized:j.alerts.initialized}:null,rejectedQueue:j.rejectedQueue?{exists:j.rejectedQueue.exists,lines:j.rejectedQueue.lines}:null};console.log(JSON.stringify(out,null,2));})'

echo
echo "----- /api/state (state_meta) -----"
curl -fsS "http://127.0.0.1:$PORT/api/state" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const j=JSON.parse(s);console.log(JSON.stringify({ok:j.ok,state_meta:j.state&&j.state.state_meta},null,2));})'

echo
echo "----- /api/reconcile-now (no secret -> 401 expected) -----"
http_status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:$PORT/api/reconcile-now")
echo "reconcile-now without secret -> $http_status"

echo "OK"
