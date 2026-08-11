# WhatsApp Webhook Integration — Comprehensive Test Plan

**Status:** Ready for testing  
**Scope:** Main server `/api/whatsapp/webhook` proxy → Dispatch-server port 3111 → Invoice ingestion  
**Goal:** Validate integration, edge cases, failure modes, and long-term maintainability

---

## Phase 1: Component Validation (Isolated)

### 1.1 Dispatch-Server Health
```bash
# Verify dispatch-server is running
curl http://localhost:3111/health
# Expected: 200 OK

# Verify webhook endpoint exists
curl -I http://localhost:3111/api/whatsapp/webhook
# Expected: 405 (Method Not Allowed on GET, but endpoint exists)
```

**Success criteria:** Dispatch-server responds, webhook endpoint reachable.

### 1.2 Main-Server Proxy Route
```bash
# Verify main server is running
curl http://localhost:3000/health
# Expected: 200 OK

# Test proxy with a valid Meta GET handshake
curl "http://localhost:3000/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test-verify-123&hub.challenge=myChallenge"
# Expected: 200 OK, body = "myChallenge" (forwarded from dispatch-server)

# Verify proxy rejects unknown tokens
curl "http://localhost:3000/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x"
# Expected: 403 Forbidden (from dispatch-server)
```

**Success criteria:** Proxy correctly forwards both GET and rejects with proper status codes.

---

## Phase 2: Inbound Message Flow (Happy Path)

### 2.1 Synthetic Text Message
```bash
# Simulate Meta webhook POST with a text invoice
curl -X POST http://localhost:3000/api/whatsapp/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{
            "from": "971505555555",
            "type": "text",
            "text": {"body": "INV-2026-TEST1\nMySupplier\n1. Silk Nida | Black | 2.5m\nSLA: 2026-06-20T14:00:00Z"},
            "timestamp": "1718000000"
          }]
        }
      }]
    }]
  }'
# Expected: 200 OK, {ok: true, ingested: 1}

# Verify invoice is stored
curl http://localhost:3111/api/invoices | jq '.invoices[] | {id, supplier}'
# Expected: invoice INV-2026-TEST1 from MySupplier exists
```

**Success criteria:** Invoice parsed, stored, and queryable.

### 2.2 Document (PDF) Message
```bash
# Use a real media ID from a prior upload (or mock one for now)
curl -X POST http://localhost:3000/api/whatsapp/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{
            "from": "971505555555",
            "type": "document",
            "document": {
              "id": "MEDIA-PDF-TEST",
              "mime_type": "application/pdf",
              "filename": "receipt_9657.pdf"
            },
            "timestamp": "1718000000"
          }]
        }
      }]
    }]
  }'
# Expected: 200 OK, {ok: true, ingested: 1}

# Verify document media_id is stored
curl http://localhost:3111/api/invoices | jq '.invoices[] | {id, documentId}'
# Expected: invoice with documentId: "MEDIA-PDF-TEST" exists
```

**Success criteria:** PDF message parsed, invoice created with documentId preserved.

### 2.3 Image Message (Photo)
```bash
curl -X POST http://localhost:3000/api/whatsapp/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{
            "from": "971505555555",
            "type": "image",
            "image": {
              "id": "MEDIA-IMG-TEST",
              "mime_type": "image/jpeg",
              "caption": "snapshot of invoice"
            },
            "timestamp": "1718000000"
          }]
        }
      }]
    }]
  }'
# Expected: 200 OK, {ok: true, ingested: 1}

# Verify image is stored
curl http://localhost:3111/api/invoices | jq '.invoices[] | {id, imageId}'
# Expected: invoice with imageId: "MEDIA-IMG-TEST" exists
```

**Success criteria:** Image message creates invoice stub with imageId preserved.

---

## Phase 3: Failure Modes & Edge Cases

### 3.1 Dispatch-Server Down
**Setup:** Kill dispatch-server while main-server is running
```bash
pkill -f "services/dispatch-server/server.js"

# Attempt webhook POST
curl -X POST http://localhost:3000/api/whatsapp/webhook \
  -H "Content-Type: application/json" \
  -d '{"entry":[{"changes":[{"value":{"messages":[{"type":"text","text":{"body":"test"}}]}}]}]}'
# Expected: 500, {error: "webhook proxy failed", message: "...localhost:3111..."}

# Main server should still be responsive for other routes
curl http://localhost:3000/health
# Expected: 200 OK
```

**Success criteria:** 
- Proxy returns 500 (not silent hang or timeout)
- Error message clearly indicates dispatch-server unreachable
- Main server remains healthy

### 3.2 Malformed Webhook Payload
```bash
# Missing required fields
curl -X POST http://localhost:3000/api/whatsapp/webhook \
  -H "Content-Type: application/json" \
  -d '{}'
# Expected: dispatch-server should handle gracefully (200 OK, ingested: 0)

# Invalid JSON
curl -X POST http://localhost:3000/api/whatsapp/webhook \
  -H "Content-Type: application/json" \
  -d 'not json'
# Expected: 400 Bad Request (from main-server proxy)
```

**Success criteria:** Graceful handling, clear error in logs, no crash.

### 3.3 Network Timeout
**Setup:** Add network latency or use a firewall rule to delay responses
```bash
# Add 30s delay to dispatch-server (via a proxy tool or iptables)
# Then POST webhook with default timeout (should be ~5s in fetch)
curl -X POST http://localhost:3000/api/whatsapp/webhook \
  -H "Content-Type: application/json" \
  -d '{"entry":[...]}'
# Expected: 500 after ~5-8s timeout, clear error message
```

**Success criteria:** Timeout respected, request fails cleanly (not hanging indefinitely).

### 3.4 Concurrent Requests
```bash
# Send 10 webhooks in parallel (same supplier, same message)
for i in {1..10}; do
  curl -X POST http://localhost:3000/api/whatsapp/webhook \
    -H "Content-Type: application/json" \
    -d '{"entry":[{"changes":[{"value":{"messages":[{"from":"971505555555","type":"text","text":{"body":"INV-2026-CONCURRENT\nSupplier\n1. Item | Color | Qty"}}]}}]}]}' &
done
wait

# Check invoices — should be exactly 1 (idempotent by invoice ID)
curl http://localhost:3111/api/invoices | jq '[.invoices[] | select(.id == "INV-2026-CONCURRENT")] | length'
# Expected: 1 (not 10)
```

**Success criteria:** Idempotent — concurrent identical requests don't create duplicates.

### 3.5 Missing WhatsApp Verify Token
**Setup:** Don't set `WHATSAPP_VERIFY_TOKEN` env var in dispatch-server
```bash
# Restart dispatch-server without token
DISPATCH_PORT=3111 node services/dispatch-server/server.js

# Try to verify webhook
curl "http://localhost:3000/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=anytoken&hub.challenge=x"
# Expected: 503 (Service Unavailable) with clear error
```

**Success criteria:** Clear error message in logs: "WHATSAPP_VERIFY_TOKEN not set".

---

## Phase 4: Logging & Observability

### 4.1 Verify Logs Are Clear
Start both servers and monitor logs while sending webhooks:

```bash
# In one terminal:
tail -f services/dispatch-server/data/logs.txt

# In another, send a webhook
curl -X POST http://localhost:3000/api/whatsapp/webhook ...

# Expect to see:
# [whatsapp] inbound messages: 1
# [store] upserted invoice INV-2026-TEST1
```

**Success criteria:** 
- Logs show webhook received
- Logs show invoice stored
- No cryptic error codes, human-readable messages

### 4.2 Error Log Format
Send a malformed webhook and check error logs:

```bash
curl -X POST http://localhost:3000/api/whatsapp/webhook \
  -H "Content-Type: application/json" \
  -d 'bad'

# Expect dispatch-server logs to show:
# [whatsapp] bad json (or similar), not just "SyntaxError at line X"
```

**Success criteria:** Error messages are actionable (what failed, why, what to fix).

---

## Phase 5: Long-Term Maintainability

### 5.1 Configuration Audit
Verify all required env vars are documented and checked:

```bash
# services/dispatch-server/.env should have:
WHATSAPP_VERIFY_TOKEN=test-verify-123
WHATSAPP_TOKEN=<long-lived Meta token>

# Main server doesn't need new vars (proxy is hardcoded localhost:3111)
```

**Success criteria:** `.env.example` lists all needed tokens; missing tokens fail with clear message.

### 5.2 Backward Compatibility
Verify existing `/api/invoices`, `/api/delivery/*`, and SSE routes still work:

```bash
# Existing factory endpoints
curl http://localhost:3111/api/invoices
curl http://localhost:3111/api/config
curl -H "X-View-Token: <token>" http://localhost:3111/api/leaderboard/stream

# Main server existing routes
curl http://localhost:3000/health
curl http://localhost:3000/api/state
```

**Success criteria:** No regression; all existing routes respond as before.

### 5.3 Version Stability
Document the contract:

```markdown
**WhatsApp Webhook Stability**
- Endpoint: POST /api/whatsapp/webhook
- Payload format: Meta WhatsApp Cloud API v19.0+
- Dispatch-server port: hardcoded 3111 (no env var, by design)
- Timeout: 5s (fetch default)
- Idempotency: by invoice ID (same message sent twice = one invoice)
- Failure mode: dispatch down → 500, main server stays up
```

**Success criteria:** Contract is explicit and testable.

---

## Phase 6: Integration Test (End-to-End)

### 6.1 GUI + Webhook + Leaderboard
1. Open Electron GUI
2. Click **"Start Dispatch"** — confirm server starts
3. Open **"Open Leaderboard"** → `http://localhost:3111/leaderboard.html`
4. Send a PDF via WhatsApp (or simulate with webhook curl)
5. Verify invoice appears on leaderboard within 2 seconds
6. Verify "Open PDF to verify" link works (if real media ID)
7. Verify delivery-date ranking is correct

**Success criteria:** End-to-end flow from WhatsApp to UI works seamlessly.

### 6.2 Meta Webhook Handshake
1. Register webhook URL in Meta developer dashboard
2. Click **"Save"** — Meta POSTs a GET challenge
3. Verify dispatch-server logs show: `[whatsapp] GET /api/whatsapp/webhook ... challenge verified`

**Success criteria:** Meta can reach and verify the webhook.

---

## Rollback & Safety

If tests fail:
1. **Revert main server.js proxy:** `git checkout server.js`
2. **Restart main server:** Existing routes unaffected
3. **Dispatch-server is independent:** Kill it, no impact on main server

**No data loss:** All existing invoices in dispatch-server/data/invoices.json persist.

---

## Checklist (Sign-Off)

- [ ] Phase 1 (components isolated) passes
- [ ] Phase 2 (happy path: text, document, image) passes
- [ ] Phase 3 (failure modes) all graceful, no crashes
- [ ] Phase 4 (logging) is clear and actionable
- [ ] Phase 5 (maintainability) is documented
- [ ] Phase 6 (end-to-end) works with real Meta webhook (if possible)
- [ ] No regressions in existing routes
- [ ] Logs are clean, no DEBUG spam
- [ ] Error messages are human-readable

---

## Known Limitations & Future Work

1. **HMAC verification:** Current code does NOT validate Meta's X-Hub-Signature-256. Add this for security in next iteration.
2. **Rate limiting:** No throttle on webhook POST. Add if Meta sends high volume.
3. **Webhook delivery guarantee:** Meta retries 7 days. If dispatch is down, messages queue in D1 (if using Worker path). Current tunnel path loses messages. Document this trade-off.
4. **Monitoring:** No alerting if webhook fails repeatedly. Add Sentry/similar later.

