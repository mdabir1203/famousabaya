[![Labeler](https://github.com/mdabir1203/famousabaya/actions/workflows/label.yml/badge.svg?event=release)](https://github.com/mdabir1203/famousabaya/actions/workflows/label.yml)
[![SLSA generic generator](https://github.com/mdabir1203/famousabaya/actions/workflows/generator-generic-ossf-slsa3-publish.yml/badge.svg?event=release)](https://github.com/mdabir1203/famousabaya/actions/workflows/generator-generic-ossf-slsa3-publish.yml)

# AbaYa Track - Factory Production Tracking System

Complete production tracking solution with factory server, CEO dashboard, and kiosk PWA.

## Quick Start

### For Factory Deployment
See [INSTALLATION_GUIDE.md](./INSTALLATION_GUIDE.md) for complete installation instructions.

### For CEO Dashboard Access
Having trouble accessing https://dashboard.farewellabaya.com? See [CEO Dashboard Troubleshooting](./docs/CEO_DASHBOARD_TROUBLESHOOTING.md).

## Components

- **Factory Server** (`server.js`): Local Node.js server for production tracking
- **CEO Dashboard**: Cloudflare Worker at https://dashboard.farewellabaya.com
- **Kiosk PWA**: Tablet interface for workers
- **Desktop Launcher**: Windows EXE installer for easy deployment

## Documentation

- [Installation Guide](./INSTALLATION_GUIDE.md) - Deploy on Windows laptop/tablet
- [CEO Dashboard Troubleshooting](./docs/CEO_DASHBOARD_TROUBLESHOOTING.md) - Fix access issues
- [Remote Access Setup](./docs/REMOTE_ACCESS.md) - Tailscale, tunnels, HTTPS
- [System Design](./docs/SYSTEM_DESIGN.md) - Architecture overview
