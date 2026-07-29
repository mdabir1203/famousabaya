# AbaYa Track - Complete Installation & Deployment Guide

## Overview
AbaYa Track is a factory server application with kiosk, dashboard, and Cloudflare sync capabilities. This guide covers installation on Windows laptops/tablets for both end-users (clients) and developers.

## System Requirements
- **OS**: Windows 10 or later (64-bit)
- **CPU**: Dual-core processor or better
- **RAM**: At least 4GB (8GB recommended)
- **Disk Space**: At least 500MB free space
- **Node.js**: v18.x or later (for development/source builds only)
- **Network**: LAN connectivity for local operations; internet optional for cloud features

---

## Method 1: Pre-built EXE Installer (Recommended for Clients)

This is the simplest method for end-users. The installer includes everything needed to run the application.

### Step 1: Obtain the Installer
Download the latest installer from one of these sources:
- **GitHub Releases**: `https://github.com/mdabir1203/famousabaya/releases`
- **Direct from provider**: Look for file named `AbaYa Track Launcher-Setup-X.X.X.exe`

### Step 2: Run the Installer
1. Double-click the `.exe` installer file
2. If prompted by Windows SmartScreen, click "More info" → "Run anyway"
3. Follow the installation wizard:
   - Choose installation directory (default: `C:\Users\<YourName>\AppData\Local\Programs\abaya-track-launcher`)
   - Choose whether to create desktop/start menu shortcuts
4. Click "Install" and wait for completion
5. Click "Finish" to launch the application

### Step 3: First Launch
- The application will start automatically after installation
- Find it later via:
  - Desktop shortcut: "AbaYa Track Launcher"
  - Start Menu → AbaYa Track Launcher
  - Installation directory → `AbaYa Track Launcher.exe`

### What's Included in the Installer
The NSIS installer packages:
- Electron-based GUI launcher application
- Factory server (`server.js`)
- Catalog watcher tool
- All batch scripts from `/install` folder
- Public assets (HTML, CSS, JS, images)
- Shared utilities

---

## Method 2: Direct EXE File (Portable Mode)

If you have the portable executable without an installer:

### Step 1: Place the EXE File
1. Create a folder for the application (e.g., `C:\Programs\AbaYaTrack\` or `D:\Apps\AbaYaTrack\`)
2. Copy the `AbaYa Track Launcher.exe` file to this folder

### Step 2: Create Shortcuts (Optional)
1. Right-click the `.exe` file
2. Select "Create shortcut"
3. Move the shortcut to Desktop or Start Menu

### Step 3: Run the Application
- Double-click the `.exe` file to launch
- The application will extract necessary resources on first run

---

## Method 3: Source Build (For Developers/Advanced Users)

Use this method if you need to modify the source code or the pre-built installer doesn't work.

### Prerequisites
1. **Install Node.js 18+ LTS**
   - Download from: https://nodejs.org
   - Choose the LTS version (e.g., 18.x, 20.x)
   - Run the installer with default settings

2. **Verify Installation**
   ```cmd
   node --version
   npm --version
   ```

### Step 1: Obtain Source Code
Choose one option:
- **Git Clone**: `git clone https://github.com/mdabir1203/famousabaya.git`
- **Download ZIP**: From GitHub repo → Code → Download ZIP → Extract

### Step 2: Install Dependencies
Open Command Prompt in the project root directory and run:

```cmd
corepack enable
yarn install
```

This installs:
- Factory server dependencies
- Desktop launcher (Electron) dependencies
- Catalog watcher dependencies

### Step 3: Configure Environment
1. Check if `.env` file exists in the root directory
2. If not, copy `.env.example` to `.env`:
   ```cmd
   copy .env.example .env
   ```
3. Edit `.env` to configure:
   - `PORT=3000` (server port)
   - Excel file paths for catalog watcher
   - Optional: Cloudflare Tunnel credentials

### Step 4: Build the EXE Installer (Optional)
To create your own installer:

```cmd
yarn build:installer
```

This runs:
```cmd
cd tools/desktop-launcher && yarn install && yarn run dist:win
```

The installer will be created in the `install/` folder as:
`AbaYa Track Launcher-Setup-X.X.X.exe`

### Step 5: Launch the Application

**Option A: GUI Launcher (Recommended)**
```cmd
yarn launcher
```
Or double-click: `install\START-Launcher-GUI.bat`

**Option B: Terminal-based Launch**
```cmd
install\LAUNCH-ALL.bat
```

**Option C: Server Only**
```cmd
yarn start
```

---

## Post-Installation Configuration

### Configure Excel Paths (Catalog Watcher)
1. Open `.env` in a text editor
2. Set the following variables:
   ```
   CATALOG_EXCEL_PATH=C:\Path\To\Your\Catalog.xlsx
   OUTPUT_DIR=C:\Path\To\Output\Folder
   ```

### Configure Cloudflare Tunnel (Optional)
For remote access and cloud sync:
1. Obtain Cloudflare Tunnel credentials
2. Add to `.env`:
   ```
   CF_TUNNEL_TOKEN=your_token_here
   CF_INGEST_SECRET=your_secret_here
   ```
3. Run the setup script:
   ```cmd
   powershell -File install\SETUP-CLOUDFLARE-TUNNEL-FACTORY-API.ps1
   ```

### Setup Auto-Start (Windows Startup)
1. Press `Win + R`, type `shell:startup`, press Enter
2. Create a shortcut to `install\RUN-AT-LOGON.bat` in this folder
3. Or use Task Scheduler:
   ```cmd
   powershell -File install\REGISTER-STARTUP-SCHEDULER.ps1
   ```

---

## Using the Application

### GUI Launcher Interface
The Electron GUI provides:
- **Start Runtime**: Starts factory server and catalog watcher
- **Stop**: Stops all running processes
- **Status indicators**: Shows server/watcher status (running/stopped)
- **Quick links**: Open kiosk, dashboard in browser
- **Update management**: Check/install updates
- **PM2 integration**: Process management (if PM2 installed)
- **Sync status**: Cloudflare sync and reconciliation status

### Accessing the Web Interface
Once the server is running:
- **Kiosk Mode**: http://localhost:3000/kiosk.html
- **Dashboard**: http://localhost:3000/dashboard.html
- **API**: http://localhost:3000/api/

Replace `3000` with your configured PORT if different.

### Batch Scripts Reference
Located in `install/` folder:
- `LAUNCH-ALL.bat` - Start all services in terminal windows
- `START-AbaYa-Server.bat` - Start server only
- `START-Catalog-Watcher.bat` - Start watcher only
- `START-Launcher-GUI.bat` - Start GUI launcher
- `OPEN-CEO-DASHBOARD.bat` - Open dashboard in browser
- `CHECK-PM2-STATUS.ps1` - Check PM2 process status
- `DEPLOY-ALL.ps1` - Full deployment script

---

## Troubleshooting

### Application Won't Start
1. **Check Node.js installation**: Ensure Node.js 18+ is installed
2. **Reinstall dependencies**: 
   ```cmd
   yarn install
   ```
3. **Check port availability**: Port 3000 (or configured PORT) must be free
4. **Run as administrator**: Right-click → "Run as administrator"

### Security Warnings
- **SmartScreen**: Click "More info" → "Run anyway"
- **Antivirus**: Add exception for the installation directory
- **Windows Defender**: May flag Electron apps; add to allowed list

### Performance Issues
1. Close unnecessary applications
2. Ensure at least 4GB RAM available
3. Check disk space (minimum 500MB free)
4. Disable GPU acceleration if needed (add `--disable-gpu` to launch flags)

### Update Problems
1. Check internet connectivity
2. Manually check for updates in GUI
3. Download latest installer from GitHub Releases
4. Reinstall if automatic update fails

### Port Already in Use
Error: "Port 3000 is busy"
1. Stop other applications using port 3000
2. Change PORT in `.env` file
3. Restart the application

### CatalogWatcher Not Working
1. Verify Excel file path in `.env` is correct
2. Ensure Excel file is not open in another program
3. Check file permissions
4. Review logs in GUI or terminal output

---

## Updates

### Automatic Updates (Built-in)
The GUI launcher includes auto-update functionality:
1. Opens GUI → Click "Check for updates"
2. If available, click "Install Update"
3. Application restarts automatically

### Manual Updates
1. Download latest installer from GitHub Releases
2. Run the new installer (it will overwrite the previous version)
3. Or replace the `.exe` file in portable mode

### Update Channels
- **Stable**: Default channel, thoroughly tested
- **Beta**: Early access to new features (opt-in via environment variable)

---

## Uninstallation

### If Installed via EXE Installer
1. Open Windows Settings → Apps → Installed apps
2. Find "AbaYa Track Launcher"
3. Click "Uninstall"
4. Follow the uninstaller wizard

### Portable Installation
1. Delete the application folder
2. Remove shortcuts from Desktop/Start Menu
3. Clean up any scheduled tasks:
   ```cmd
   powershell -File install\UNREGISTER-STARTUP-SCHEDULER.ps1
   ```

### Cleanup Residual Files
After uninstallation, you may want to remove:
- `%APPDATA%\abaya-track-launcher\` (user data)
- `%LOCALAPPDATA%\Programs\abaya-track-launcher\` (installation files)
- Project snapshots in `data/snapshots/` (backup first!)

---

## Support & Resources

### Documentation
- GitHub Repository: https://github.com/mdabir1203/famousabaya
- Issues & Feature Requests: https://github.com/mdabir1203/famousabaya/issues

### Common Commands
```cmd
# Check server status
yarn pm2:status

# View logs
yarn pm2:logs

# Restart services
yarn pm2:restart

# Create database snapshot
yarn snapshot:db

# Verify installation
yarn test:system
```

### Contact
For enterprise support or custom deployments, contact your service provider.

---

## Quick Start Checklist

- [ ] Downloaded installer or source code
- [ ] Installed Node.js 18+ (if building from source)
- [ ] Ran `yarn install` (if building from source)
- [ ] Created/configured `.env` file
- [ ] Launched application (GUI or batch)
- [ ] Verified server is running (check status in GUI)
- [ ] Opened dashboard in browser
- [ ] Configured Excel paths (if using catalog watcher)
- [ ] Set up auto-start (optional)
- [ ] Tested basic functionality

---

**Version**: 1.0.0  
**Last Updated**: 2024  
**License**: ISC
