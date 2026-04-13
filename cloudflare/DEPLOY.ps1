<#
  AbaYa Track — Cloudflare Deployment Script
  ============================================
  Deploys the CEO dashboard + factory event ingest to Cloudflare Workers + D1.
  Run once from the machine that has internet access and a Cloudflare account.

  Usage (from any PowerShell window, no admin needed):
      cd cloudflare
      powershell -ExecutionPolicy Bypass -File DEPLOY.ps1

  What this script does, in order:
    1. Verifies Node.js 18+ is installed
    2. Installs Wrangler CLI (Cloudflare's deploy tool)
    3. Opens browser for Cloudflare login (one-time, free account)
    4. Creates the D1 database  (abaya-db)
    5. Runs the full schema (tables + indexes)
    6. Creates the R2 bucket   (abaya-exports — for EOD reports)
    7. Asks you to set two secrets:
         INGEST_SECRET — shared key between factory server and worker
         CEO_TOKEN     — the CEO's login password (you choose)
    8. Deploys the Worker
    9. Patches ../.env with CF_WORKER_URL and CF_INGEST_SECRET automatically
   10. Prints the CEO dashboard URL + QR instructions
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Colour helpers ──────────────────────────────────────────────────────────────
function Write-Ok  ($m) { Write-Host "  [OK] $m"  -ForegroundColor Green }
function Write-Info($m) { Write-Host "  [>>] $m"  -ForegroundColor Cyan }
function Write-Warn($m) { Write-Host "  [!]  $m"  -ForegroundColor Yellow }
function Write-Err ($m) { Write-Host "  [X]  $m"  -ForegroundColor Red }
function Write-Step($n,$m) { Write-Host "`n  ── Step $n : $m ──" -ForegroundColor Magenta }

$SCRIPT_DIR  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ROOT_DIR    = Split-Path -Parent $SCRIPT_DIR
$TOML_PATH   = Join-Path $SCRIPT_DIR "wrangler.toml"
$SCHEMA_PATH = Join-Path $SCRIPT_DIR "schema.sql"
$ENV_PATH    = Join-Path $ROOT_DIR ".env"

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════╗" -ForegroundColor DarkYellow
Write-Host "  ║   AbaYa Track — Cloudflare CEO Dashboard Deploy  ║" -ForegroundColor DarkYellow
Write-Host "  ╚══════════════════════════════════════════════════╝" -ForegroundColor DarkYellow
Write-Host ""

# ── Step 1: Node.js check ───────────────────────────────────────────────────────
Write-Step 1 "Checking Node.js"
try {
    $nodeVer = & node --version 2>&1
    $major   = [int]($nodeVer -replace 'v(\d+)\..*','$1')
    if ($major -lt 18) {
        Write-Err "Node.js $nodeVer is too old. Install Node.js 18+ from https://nodejs.org"
        exit 1
    }
    Write-Ok "Node.js $nodeVer"
} catch {
    Write-Err "Node.js not found. Install from https://nodejs.org then re-run this script."
    exit 1
}

# ── Step 2: Install / verify Wrangler ──────────────────────────────────────────
Write-Step 2 "Installing Wrangler (Cloudflare CLI)"
try {
    $wVer = & npx wrangler --version 2>&1 | Select-Object -First 1
    Write-Ok "Wrangler already available: $wVer"
} catch {
    Write-Info "Installing wrangler via npm..."
    & npm install -g wrangler
    Write-Ok "Wrangler installed"
}

# ── Step 3: Login ───────────────────────────────────────────────────────────────
Write-Step 3 "Cloudflare Login"
Write-Info "A browser window will open. Log in to your Cloudflare account."
Write-Info "If you already logged in before, this may complete instantly."
Write-Host ""
& npx wrangler login
Write-Ok "Logged in to Cloudflare"

# ── Step 4: Create D1 database ─────────────────────────────────────────────────
Write-Step 4 "Creating D1 Database (abaya-db)"
$DB_ID = $null

# Check if database already exists
$existingDbs = & npx wrangler d1 list 2>&1
if ($existingDbs -match 'abaya-db') {
    Write-Warn "Database 'abaya-db' already exists. Fetching its ID..."
    # Parse the ID from 'wrangler d1 list' output
    $existingDbs -split "`n" | ForEach-Object {
        if ($_ -match 'abaya-db') {
            # Format: "abaya-db  <uuid>  ..."
            $parts = ($_ -replace '\s+', ' ').Trim() -split ' '
            foreach ($p in $parts) {
                if ($p -match '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') {
                    $DB_ID = $p
                }
            }
        }
    }
    if ($DB_ID) {
        Write-Ok "Found existing database ID: $DB_ID"
    } else {
        Write-Warn "Could not auto-detect existing DB ID. Creating fresh..."
        $createOut = & npx wrangler d1 create abaya-db 2>&1 | Out-String
        $DB_ID = ($createOut | Select-String 'database_id\s*=\s*"([^"]+)"').Matches.Groups[1].Value
    }
} else {
    Write-Info "Creating new D1 database 'abaya-db'..."
    $createOut = & npx wrangler d1 create abaya-db 2>&1 | Out-String
    $DB_ID = ($createOut | Select-String 'database_id\s*=\s*"([^"]+)"').Matches.Groups[1].Value
    if (-not $DB_ID) {
        # Try UUID pattern directly
        $DB_ID = ($createOut | Select-String '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}').Matches.Value
    }
    Write-Ok "Database created. ID: $DB_ID"
}

if (-not $DB_ID) {
    Write-Err "Could not determine D1 database ID. Run manually: npx wrangler d1 create abaya-db"
    Write-Err "Then copy the 'database_id' value into cloudflare/wrangler.toml and re-run."
    exit 1
}

# Patch wrangler.toml with the real database_id
Write-Info "Patching wrangler.toml with database_id..."
$toml = Get-Content $TOML_PATH -Raw
$toml = $toml -replace 'database_id\s*=\s*"[^"]*"', "database_id   = `"$DB_ID`""
Set-Content $TOML_PATH $toml -Encoding UTF8 -NoNewline
Write-Ok "wrangler.toml updated with database_id = $DB_ID"

# ── Step 5: Run schema ──────────────────────────────────────────────────────────
Write-Step 5 "Running database schema (creating tables)"
Write-Info "Applying schema.sql to remote D1..."
& npx wrangler d1 execute abaya-db --remote --file=$SCHEMA_PATH
Write-Ok "Schema applied successfully"

# ── Step 6: R2 bucket ───────────────────────────────────────────────────────────
Write-Step 6 "Creating R2 Bucket (abaya-exports)"
try {
    & npx wrangler r2 bucket create abaya-exports 2>&1 | Out-Null
    Write-Ok "R2 bucket 'abaya-exports' created"
} catch {
    Write-Warn "R2 bucket may already exist (that's fine)."
}

# ── Step 7: Secrets ─────────────────────────────────────────────────────────────
Write-Step 7 "Setting Worker Secrets"

Write-Host ""
Write-Host "  You need to set 2 secrets:" -ForegroundColor White
Write-Host ""
Write-Host "  1. INGEST_SECRET — a strong random key the factory server uses" -ForegroundColor White
Write-Host "     to authenticate when pushing session data to this worker." -ForegroundColor Gray
Write-Host "     Example: AbaYa-2024-SecureKey-$(Get-Random -Max 9999)" -ForegroundColor Gray
Write-Host ""
Write-Host "  2. CEO_TOKEN — the password the CEO types to open the dashboard." -ForegroundColor White
Write-Host "     Keep it simple but hard to guess (e.g. FamousAbaya@Dubai)." -ForegroundColor Gray
Write-Host ""

# Generate a suggested ingest secret
$suggestedIngest = "AbaYa-Ingest-$(Get-Random -Minimum 100000 -Maximum 999999)"

$INGEST_SECRET = Read-Host "  Enter INGEST_SECRET (or press Enter to use: $suggestedIngest)"
if ([string]::IsNullOrWhiteSpace($INGEST_SECRET)) {
    $INGEST_SECRET = $suggestedIngest
}

$CEO_TOKEN = ""
while ([string]::IsNullOrWhiteSpace($CEO_TOKEN)) {
    $CEO_TOKEN = Read-Host "  Enter CEO_TOKEN (CEO login password, min 8 chars)"
    if ($CEO_TOKEN.Length -lt 8) {
        Write-Warn "Too short. Use at least 8 characters."
        $CEO_TOKEN = ""
    }
}

Write-Info "Setting INGEST_SECRET..."
$INGEST_SECRET | & npx wrangler secret put INGEST_SECRET
Write-Ok "INGEST_SECRET set"

Write-Info "Setting CEO_TOKEN..."
$CEO_TOKEN | & npx wrangler secret put CEO_TOKEN
Write-Ok "CEO_TOKEN set"

# ── Step 8: Deploy ──────────────────────────────────────────────────────────────
Write-Step 8 "Deploying Worker to Cloudflare"
Write-Info "Deploying abaya-track worker to farewellabaya.com..."
$deployOut = & npx wrangler deploy 2>&1 | Out-String
Write-Host $deployOut

# Custom domain is declared in wrangler.toml [[custom_domains]] — always use it.
$WORKER_URL = "https://farewellabaya.com"

Write-Ok "Worker deployed! Live at $WORKER_URL"

# ── Step 9: Patch .env ──────────────────────────────────────────────────────────
Write-Step 9 "Updating factory server .env"

if ($WORKER_URL) {
    if (Test-Path $ENV_PATH) {
        $envContent = Get-Content $ENV_PATH -Raw
        # Replace or append CF_WORKER_URL
        if ($envContent -match 'CF_WORKER_URL=') {
            $envContent = $envContent -replace 'CF_WORKER_URL=.*', "CF_WORKER_URL=$WORKER_URL"
        } else {
            $envContent += "`nCF_WORKER_URL=$WORKER_URL"
        }
        # Replace or append CF_INGEST_SECRET
        if ($envContent -match 'CF_INGEST_SECRET=') {
            $envContent = $envContent -replace 'CF_INGEST_SECRET=.*', "CF_INGEST_SECRET=$INGEST_SECRET"
        } else {
            $envContent += "`nCF_INGEST_SECRET=$INGEST_SECRET"
        }
        Set-Content $ENV_PATH $envContent -Encoding UTF8 -NoNewline
        Write-Ok ".env updated with CF_WORKER_URL and CF_INGEST_SECRET"
    } else {
        # Create .env from scratch
        $newEnv = @"
PORT=3000
CF_WORKER_URL=$WORKER_URL
CF_INGEST_SECRET=$INGEST_SECRET
"@
        Set-Content $ENV_PATH $newEnv -Encoding UTF8
        Write-Ok ".env created with CF_WORKER_URL and CF_INGEST_SECRET"
    }

    # Also update catalog-watcher config.json if it exists and has placeholder
    $configPath = Join-Path $ROOT_DIR "tools\catalog-watcher\config.json"
    if (Test-Path $configPath) {
        $cfgContent = Get-Content $configPath -Raw
        if ($cfgContent -match 'PASTE_YOUR_WORKER_URL_HERE') {
            $cfgContent = $cfgContent -replace 'PASTE_YOUR_WORKER_URL_HERE', $WORKER_URL
        }
        if ($cfgContent -match 'PASTE_YOUR_INGEST_SECRET_HERE') {
            $cfgContent = $cfgContent -replace 'PASTE_YOUR_INGEST_SECRET_HERE', $INGEST_SECRET
        }
        Set-Content $configPath $cfgContent -Encoding UTF8 -NoNewline
        Write-Ok "catalog-watcher/config.json updated with worker URL and secret"
    }
}

# ── Step 10: Print results ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║   DEPLOYMENT COMPLETE — CEO Dashboard is LIVE               ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  CEO Dashboard URL:" -ForegroundColor White
Write-Host "    https://farewellabaya.com" -ForegroundColor Yellow
Write-Host ""
Write-Host "  CEO Login Password (CEO_TOKEN):" -ForegroundColor White
Write-Host "    $CEO_TOKEN" -ForegroundColor Yellow
Write-Host ""
Write-Host "  ─────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  Share this with the CEO (works on any phone, any network):" -ForegroundColor White
Write-Host ""
Write-Host "    URL:      https://farewellabaya.com" -ForegroundColor Cyan
Write-Host "    Password: $CEO_TOKEN" -ForegroundColor Cyan
Write-Host ""
Write-Host "  The CEO opens the URL, types the password, and sees live data." -ForegroundColor Gray
Write-Host "  Dashboard auto-refreshes every 5 seconds." -ForegroundColor Gray
Write-Host "  Reports can be sent to WhatsApp with one tap." -ForegroundColor Gray
Write-Host ""
Write-Host "  ─────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  Factory kiosk (on-site tablets / LAN):" -ForegroundColor White
Write-Host "    http://<factory-PC-LAN-IP>:3000/kiosk.html" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Factory kiosk (remote HTTPS via Cloudflare Tunnel):" -ForegroundColor White
Write-Host "    https://kiosk.farewellabaya.com/kiosk.html" -ForegroundColor Cyan
Write-Host "    (Set up tunnel in Zero Trust: one.dash.cloudflare.com)" -ForegroundColor Gray
Write-Host ""
Write-Host "  ─────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  NEXT STEP: Restart the factory server so it starts pushing" -ForegroundColor White
Write-Host "  live data to farewellabaya.com:" -ForegroundColor White
Write-Host ""
Write-Host "    Close the current server window, then double-click:" -ForegroundColor Gray
Write-Host "    install\LAUNCH-ALL.bat" -ForegroundColor Yellow
Write-Host ""

Write-Host "  Press any key to exit..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
