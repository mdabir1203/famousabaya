# AbaYa Track - Comprehensive User Guide

Welcome to **AbaYa Track**, the simplest and most powerful way to track production across your factory floor, while giving your business leaders instant visibility from anywhere in the world.

## 1. Overview

AbaYa Track consists of three main components:
- **The Factory Kiosk:** A simple, tablet-based interface for employees on the factory floor.
- **The Local Dashboard:** A localized manager's view running directly in the factory.
- **The CEO Cloud Dashboard:** A secure, cloud-hosted dashboard allowing executives to monitor progress in real-time, globally.

## 2. Setting up the Data

AbaYa Track uses simple Excel files to manage your operations.

### Catalog (`items_export.xlsx`)
This file holds your product inventory and operations. 
1. Place the file in your configured data directory (see your `.env` file).
2. The system automatically reads this file on a timer. No need to restart the system when you add new Abayas!

### Employees (`employees.xlsx`)
This file contains your factory staff details.
1. Place the file in the same directory as your Catalog.
2. Ensure every employee has a unique barcode assigned for easy scanning at the Kiosk.

## 3. Using the Kiosk (For Employees)

The Kiosk is designed to be completely frictionless. No typing required.

1. **Scan Item:** The employee uses a barcode scanner to scan the Abaya's tag.
2. **Scan ID:** The employee scans their personal ID badge.
3. **Start/Finish:** Tap "Start" to begin working on the item. When done, tap "Finish". 

*Note:* The system automatically tracks the duration. If an internet connection drops, the Kiosk will save the session offline and sync it automatically when the connection returns!

## 4. The CEO Dashboard

For business leaders, AbaYa Track offers a real-time window into factory operations without the need for manual reports or spreadsheets.

1. Navigate to your dedicated CEO Cloud URL (e.g., `https://dashboard.farewellabaya.com`).
2. Log in with your credentials.
3. View real-time metrics: Items processed, active employees, and overall efficiency.

*Global Scale:* Because the data is synced securely via Cloudflare Workers to the cloud, you can access these insights from your office in Dubai, or while traveling abroad.

## 5. Maintenance & Support

- **Updates:** To update the factory software, simply pull the latest code or apply the ZIP release provided by your IT administrator.
- **Power Outages:** If the factory PC shuts down abruptly, in-progress sessions are periodically saved and can be restored if within the configured maximum age (default 48 hours).
- **Service:** The server runs robustly in the background using PM2, meaning it will automatically start when the PC turns on.

---
*Scale your production globally with AbaYa Track. Simple for the factory, powerful for the business.*
