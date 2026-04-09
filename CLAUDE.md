# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# First-time setup
npm install

# Run app (Electron)
npx electron .
# or
NetGuard.bat

# Run backend only (no Electron window)
node server.js

# Build portable .exe
npm run build
```

Server runs on **port 3847**. Dashboard at `http://localhost:3847/dashboard.html`.

## Architecture

This is an **Electron app** with a local Express backend. Two processes run together:

- **`main.js`** — Electron main process. Starts the backend server (`server.js`), creates the BrowserWindow that loads `http://localhost:3847/dashboard.html`, and manages the system tray icon. Uses `app.relaunch()` via a `netguard-restart` process event for post-update restarts.

- **`server.js`** — Express backend (Node.js). All network diagnostics, logging, config, and update logic live here. Exposes REST API endpoints consumed by the dashboard. Has no frontend code.

- **`dashboard.html`** — Single-file frontend (HTML + CSS + JS inlined). Calls the backend API via `fetch(API + '/api/...')`. No build step — edit directly.

## Key Data Flows

**Diagnostics** (`/api/diagnose`): Sequential — LAN interface check → ping router → ping ISP DNS. Each step is skipped if the previous fails. Results are written to `logs/scans_YYYY-MM-DD.json` and `logs/incidents_YYYY-MM-DD.json`.

**IP Conflict Detection** (`/api/ip-conflicts`, `/api/ip-conflicts/scan`): Reads OS ARP table via `arp -a` (Windows) or `arp -n` (Linux). Full scan additionally does a ping sweep of all /24 subnets found on local interfaces (batches of 50 concurrent pings).

**Update system** — 3 methods, all handled in `server.js`:
1. `POST /api/update/upload` — receives raw zip bytes (up to 200MB), calls `extractAndInstall()`
2. `POST /api/update/install` — downloads zip from URL, calls `extractAndInstall()`
3. `GET /api/update/check` → `POST /api/update/install` — checks `api.github.com/repos/{owner}/{repo}/releases/latest`, compares semver against `package.json` version

`extractAndInstall()` extracts to temp dir, copies files over `__dirname`, skips `telegram-config.json`, `update-config.json`, `logs/`, `node_modules/`. Then emits `netguard-restart` → Electron calls `app.relaunch()`.

## Persistent Config Files

| File | Purpose |
|---|---|
| `telegram-config.json` | Telegram bot token, chat ID, notification prefs |
| `update-config.json` | GitHub owner/repo for auto-update |
| `logs/scans_YYYY-MM-DD.json` | Every scan result |
| `logs/incidents_YYYY-MM-DD.json` | DOWN/RESOLVED events with downtime |

These are never overwritten by the update system.

## Releasing a New Version

1. Bump `"version"` in `package.json`
2. Commit and push
3. Create a GitHub Release tagged `vX.Y.Z` (must match package.json)
4. Attach a zip of the source files as a release asset — the update installer looks for the first `.zip` asset, falling back to GitHub's auto-generated `zipball_url`

GitHub repo: `https://github.com/xanxisevolution-bot/NETGUARD`
