# Server.js Updates Summary

This document outlines all required updates to align server.js with the new requirements.

## 1. Bind to 0.0.0.0 ✅ COMPLETED
- `LISTEN_HOST` defaults to `0.0.0.0`
- Loopback bind prints a loud warning so tablets can reach the server
- Already implemented in `resolveServerBindHost()` function

## 2. TCP Keep-Alive ✅ COMPLETED
```javascript
server.keepAliveTimeout = 120000;
server.headersTimeout = 130000;
```
Prevents Android Chrome from getting ERR_CONNECTION_ABORTED on idle sockets.

## 3. Relaxed Socket.IO ✅ COMPLETED
```javascript
pingInterval: 25000,  // was 15000
pingTimeout: 60000,   // was 20000
```
Tolerates factory Wi-Fi jitter without dropping tablets.

## 4. HTTP REST Kiosk Fallback ⚠️ TODO
Create pure functions for kiosk operations that work with both Socket.IO and HTTP:

```javascript
// Pure functions (extract from socket handlers)
function kioskLookupByAcNo(ac_no) {
  const emp = AC_MAP[ac_no];
  if (!emp) return {ok:false, error:'No employee found for AC-No. ' + ac_no};
  const is_active = !!ACTIVE_SESSIONS[emp.id];
  const activeSession = is_active ? ACTIVE_SESSIONS[emp.id] : null;
  // ... rest of logic
}

function kioskStartWork(data) {
  // ... extraction of start-work logic
}

function kioskFinishWork(payload) {
  // ... extraction of finish-work logic
}

// HTTP endpoints
app.post('/api/kiosk/lookup', (req, res) => {
  const { ac_no } = req.body;
  const result = kioskLookupByAcNo(ac_no);
  res.json(result);
});

app.post('/api/kiosk/start-work', (req, res) => {
  const result = kioskStartWork(req.body);
  res.json(result);
});

app.post('/api/kiosk/finish-work', (req, res) => {
  const result = kioskFinishWork(req.body);
  res.json(result);
});

app.get('/api/kiosk/state', (req, res) => {
  res.json(getRealtimeStateBundle());
});
```

## 5. Server Error Handling ⚠️ TODO
Add after `server.listen()`:
```javascript
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ ERROR: Port ${PORT} is already in use.`);
    console.error('   Fix: Either stop the other process or change PORT in .env\n');
    process.exit(1);
  } else if (err.code === 'EACCES') {
    console.error(`\n❌ ERROR: Permission denied to bind to port ${PORT}.`);
    console.error('   Fix: Run as administrator or use a port > 1024\n');
    process.exit(1);
  } else {
    console.error('Server error:', err.message);
    process.exit(1);
  }
});
```

## 6. Windows Firewall ⚠️ TODO
Create `install/ENSURE-LAN-FIREWALL.ps1` and call it from server.js:

```javascript
function tryEnsureWindowsFirewall(port) {
  if (process.platform !== 'win32') return;
  const scriptPath = path.join(__dirname, 'install', 'ENSURE-LAN-FIREWALL.ps1');
  if (!fs.existsSync(scriptPath)) {
    console.log('[firewall] Script not found:', scriptPath);
    return;
  }
  try {
    const { execSync } = require('child_process');
    execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}" -Port ${port}`, {
      stdio: 'ignore',
      timeout: 5000
    });
    console.log('[firewall] Windows Firewall rule ensured for port', port);
  } catch (e) {
    console.warn('[firewall] Could not ensure firewall rule:', e.message);
  }
}

// Call before server.listen()
tryEnsureWindowsFirewall(PORT);
```

## 7. File-Watcher Race Fix ✅ COMPLETED
```javascript
let employeesXlsxWriteInProgress = false;

// In loadEmployeesFromXlsxFile():
if (employeesXlsxWriteInProgress) {
  console.log('[employees-xlsx] Skipping reload — write in progress');
  return;
}

// In persistEmployeeRosterAndReload():
employeesXlsxWriteInProgress = true;
try {
  // ... write operations
} finally {
  employeesXlsxWriteInProgress = false;
}
```

## 8. Trailing Slashes Middleware ⚠️ TODO
Add before static routes:
```javascript
function normalizeTrailingSlash(req, res, next) {
  if (req.path.length > 1 && req.path.endsWith('/')) {
    return res.redirect(308, req.path.slice(0, -1) + (req.url.slice(req.path.length) || ''));
  }
  next();
}
app.use(normalizeTrailingSlash);
```

## 9. Cache-Busted Kiosk Shell ⚠️ TODO
Serve kiosk.html and lan-check.html with version injection:

```javascript
// In static file handler for HTML:
if (lower.endsWith('.html') && (lower.includes('kiosk.html') || lower.includes('lan-check.html'))) {
  res.setHeader('Cache-Control', 'private, no-cache');
  // Inject SERVER_BOOT_ID into script tags
}
```

Alternative: Serve dynamically:
```javascript
app.get('/kiosk.html', (req, res) => {
  let content = fs.readFileSync(path.join(__dirname, 'public', 'kiosk.html'), 'utf8');
  content = content.replace(
    /<script src="([^"]+)"/g,
    `<script src="$1?v=${SERVER_BOOT_ID}"`
  );
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(content);
});
```

## 10. LAN Diagnostics Endpoints ⚠️ TODO
```javascript
app.get('/api/connectivity-diagnostics', (req, res) => {
  res.json({
    ok: true,
    serverBootId: SERVER_BOOT_ID,
    startedAt: SERVER_STARTED_AT,
    uptimeMs: Date.now() - SERVER_STARTED_AT,
    host: HOST,
    port: PORT,
    lanIPs: getLanIPs(),
    cloudSyncMode: getCeoSyncMode(),
    socketPingInterval: SOCKET_PING_INTERVAL_MS,
    socketPingTimeout: SOCKET_PING_TIMEOUT_MS,
  });
});

app.post('/api/tablet-ping', (req, res) => {
  const { tabletId, ts } = req.body || {};
  res.json({
    ok: true,
    serverTs: Date.now(),
    tabletId,
    clientTs: ts,
    latencyMs: ts ? Date.now() - ts : null,
  });
});

app.get('/api/debug-kiosk', (req, res) => {
  res.json({
    ok: true,
    activeSessions: Object.keys(ACTIVE_SESSIONS).length,
    employeesCount: EMPLOYEES.length,
    catalogCount: abayaCatalog.length,
    acMapSize: Object.keys(AC_MAP).length,
    workingHours: WORKING_HOURS,
    serverBootId: SERVER_BOOT_ID,
  });
});

// Enhanced /api/health
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'abaya-track-factory',
    floorKioskTransport: 'http',
    ts: Date.now(),
    uptimeMs: Date.now() - SERVER_STARTED_AT,
    bootId: SERVER_BOOT_ID,
    version: APP_PACKAGE_VERSION,
  });
});

// Enhanced /api/server-info
app.get('/api/server-info', (req, res) => {
  res.json({ 
    ok: true, 
    ips: getLanIPs(), 
    port: PORT, 
    host: HOST,
    bootId: SERVER_BOOT_ID,
    startedAt: SERVER_STARTED_AT,
  });
});
```

## 11. Removed Debug Instrumentation ✅
Temporary debugLanLog / session-590497 instrumentation omitted - replaced by permanent diagnostic endpoints.

---

## .env.example Updates ⚠️ TODO

Add these new environment variables:

```bash
# ─── SERVER BINDING ─────────────────────────────────────────────────────────────
# Bind to 0.0.0.0 for LAN access from tablets (default)
# Use 127.0.0.1 only for local-only testing (tablets won't connect)
HOST=0.0.0.0
PORT=3000

# ─── SOCKET.IO TUNING ───────────────────────────────────────────────────────────
# Relaxed defaults for factory Wi-Fi jitter tolerance
# SOCKET_PING_INTERVAL_MS=25000    # default 25s (was 15s)
# SOCKET_PING_TIMEOUT_MS=60000     # default 60s (was 20s)

# ─── TCP KEEP-ALIVE ─────────────────────────────────────────────────────────────
# Prevents Android Chrome ERR_CONNECTION_ABORTED on idle sockets
# SERVER_KEEP_ALIVE_TIMEOUT_MS=120000
# SERVER_HEADERS_TIMEOUT_MS=130000

# ─── WINDOWS FIREWALL ───────────────────────────────────────────────────────────
# Auto-open PORT on Windows startup (requires admin on first run)
# ENSURE_WINDOWS_FIREWALL=1
```

---

## Files to Create/Modify

### Create: `install/ENSURE-LAN-FIREWALL.ps1`
```powershell
param([int]$Port = 3000)

$ErrorActionPreference = 'Stop'
$ruleName = "AbaYa Track LAN ($Port)"

# Elevation check
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $isAdmin) {
  Write-Host 'Run as Administrator' -ForegroundColor Yellow
  exit 1
}

Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule

New-NetFirewallRule `
  -DisplayName $ruleName `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort $Port `
  -Profile Private `
  -Description "AbaYa Track factory server - port $Port" | Out-Null

Write-Host "Firewall rule created for port $Port" -ForegroundColor Green
```

### Modify: `public/kiosk.html`
Update script tags to support cache-busting:
```html
<script src="kiosk.js"></script>
<!-- becomes -->
<script src="kiosk.js?v=<%= SERVER_BOOT_ID %>"></script>
```

Or handle via server-side injection.

---

## Testing Checklist

- [ ] Server binds to 0.0.0.0 and shows warning if localhost
- [ ] Tablets can connect from factory Wi-Fi
- [ ] No ERR_CONNECTION_ABORTED on Android Chrome after idle
- [ ] Socket.IO survives Wi-Fi jitter
- [ ] HTTP kiosk endpoints work (fallback when WebSocket fails)
- [ ] Server error messages are clear on EADDRINUSE/EACCES
- [ ] Windows Firewall auto-configures on startup
- [ ] Excel file writes don't trigger mid-write reloads
- [ ] /api/state/ redirects to /api/state (no trailing slash 404)
- [ ] Tablets always load fresh JS after server restart
- [ ] Diagnostic endpoints return expected data
- [ ] .env.example documents all new options
