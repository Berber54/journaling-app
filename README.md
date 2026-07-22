# 📔 Custom Journal

A private, offline-first journaling app that syncs across all your devices via a self-hosted server.

> **Your thoughts stay yours.** No cloud services. No third-party servers. Just your devices and your Raspberry Pi.

---

## ✨ Features

- **Cross-Platform** — Native apps for Windows, macOS, and Linux (iPhone planned)
- **Offline-First** — Write anytime, anywhere. Entries sync when you're back online
- **Self-Hosted Sync** — Your Raspberry Pi is the server. Your data never leaves your network
- **Instant Lock** — Hotkey lock (Alt+L / Cmd+L), auto-lock on focus loss and minimize
- **PIN Protection** — 6-digit PIN with bcrypt hashing. No content visible when locked
- **Editable Timestamps** — Backdate entries when importing from other journals
- **Auto-Sync** — Syncs on save, on reconnect, and every 5 minutes in the background
- **Dark Theme** — Premium dark UI with glassmorphism, micro-animations, and Inter font

---

## 🏗️ Architecture

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Windows App │   │   Mac App    │   │  Linux App   │
│  (Electron)  │   │  (Electron)  │   │  (Electron)  │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │
       │         REST API (Port 3377)        │
       └──────────────────┼──────────────────┘
                          │
                 ┌────────▼────────┐
                 │   RPi 5 Server  │
                 │  (Node.js API)  │
                 │  SQLite DB      │
                 └─────────────────┘
```

| Layer | Technology |
|-------|-----------|
| Server | Node.js 20 LTS, Express, SQLite (better-sqlite3) |
| Desktop Apps | Electron 33, React 19, TypeScript 5 |
| Auth | JWT (RS256, 24h expiry) + bcrypt |
| Sync | Offline-first, last-write-wins conflict resolution |
| Bundler | Vite 6 |
| Packaging | electron-builder (NSIS / DMG / AppImage+deb) |

---

## 📁 Project Structure

```
custom_journal/
├── ARCHITECTURE.md          ← Master reference (schema, API, sync protocol)
├── README.md                ← You are here
├── server/                  ← Raspberry Pi 5 server
│   ├── src/
│   │   ├── index.ts         # Express entry point
│   │   ├── database.ts      # SQLite setup + schema
│   │   ├── routes/          # Auth, journals, sync, health endpoints
│   │   ├── services/        # Business logic (auth, CRUD, sync)
│   │   └── middleware/      # JWT auth, error handling, logging
│   └── scripts/
│       ├── install.sh       # RPi installation script
│       └── custom-journal.service  # systemd service
├── windows-app/             ← Windows Electron app
│   ├── src/main/            # Main process (Alt+L, blur-lock, IPC)
│   ├── src/renderer/        # React UI (components, hooks, styles)
│   └── src/preload/         # Secure IPC bridge
├── mac-app/                 ← macOS Electron app
│   ├── src/main/            # Main process (Cmd+L, dock, hiddenInset)
│   ├── src/renderer/        # React UI (+ titlebar drag regions)
│   └── entitlements.*.plist # macOS code signing
├── linux-app/               ← Linux Electron app
│   ├── src/main/            # Main process (Alt+L, system tray)
│   ├── src/renderer/        # React UI (identical to Windows)
│   └── custom-journal.desktop # Freedesktop entry
└── iphone-app/              ← Planned (React Native / Swift)
    └── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js 20+** and **npm** installed on your development machine
- **Raspberry Pi 5** running Raspberry Pi OS Lite (64-bit) for the server
- The server and client devices must be on the same network (or port-forwarded)

### 1. Set Up the Server (Raspberry Pi)

```bash
# On your Raspberry Pi:
cd /opt
sudo mkdir custom-journal && sudo chown $USER:$USER custom-journal
cd custom-journal

# Copy the server/ folder contents here, then:
npm install
npm run build

# Configure environment
cp .env.example .env
nano .env  # Set JWT_SECRET, PORT (default 3377), etc.

# Install as a systemd service
sudo cp scripts/custom-journal.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable custom-journal
sudo systemctl start custom-journal

# Verify
curl http://localhost:3377/api/health
# → {"status":"ok","version":"1.0.0","uptime":...}
```

### 2. Build a Desktop App

Each platform app follows the same pattern:

```bash
cd windows-app   # or mac-app, linux-app

npm install
npx @electron/rebuild   # Rebuild native modules for Electron

# Development
npm run dev              # Starts Vite + Electron in dev mode

# Production build
npm run package          # Creates installer in dist-electron/
```

### 3. First Launch

1. Launch the app → you'll be prompted to **create a 6-digit PIN**
2. Open **Settings** → enter your server URL (e.g., `http://192.168.1.50:3377`)
3. **Register** a new account or **Login** with existing credentials
4. Start journaling! Entries auto-sync in the background

---

## 🔒 Security

| Feature | Implementation |
|---------|---------------|
| Local PIN | bcrypt-hashed (12 rounds), stored in local SQLite |
| Lock triggers | Alt+L / Cmd+L hotkey, window blur, window minimize |
| Lock screen | Full-window overlay with `backdrop-filter: blur(20px)` — no content leaks |
| Server auth | JWT with 24h expiry, auto-refresh on 401 |
| Password storage | bcrypt (12 rounds) on server |
| Context isolation | Electron contextIsolation + disabled nodeIntegration |
| Data at rest | Local SQLite in Electron's userData directory |

---

## 🔄 Sync Protocol

- **Strategy**: Offline-first with last-write-wins conflict resolution
- **Comparison key**: `updated_at` timestamp (ISO 8601 UTC)
- **Sync triggers**:
  1. After each save (debounced 3 seconds)
  2. On network reconnect
  3. Every 5 minutes (background)
  4. Manual "Sync Now" button
  5. On app startup after unlock

When offline, all changes are saved locally with `synced=0`. When the network returns, pending entries are automatically pushed to the server. If a conflict exists (same entry edited on two devices), the version with the later `updated_at` wins.

---

## 🖥️ Platform Specifics

### Windows
- Standard window frame, Alt+L lock hotkey
- NSIS installer (`.exe`) — pinnable to taskbar, shows in Start Menu/Search
- App quits on window close

### macOS
- Hidden titlebar with inset traffic lights (`titleBarStyle: 'hiddenInset'`)
- Cmd+L lock hotkey
- DMG packaging — drag to Applications
- Stays in dock when window closed (standard macOS behavior)
- Dock badge shows unsynced entry count

### Linux
- Standard window frame, Alt+L lock hotkey
- System tray icon with Show/Hide, Sync Now, Quit menu
- Close minimizes to tray (app keeps running)
- `--hidden` flag for autostart support
- AppImage (portable) and `.deb` (installable) packages
- `.desktop` file for application launcher integration

---

## 📡 API Reference

**Base URL**: `http://<server-ip>:3377/api`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | No | Server health check |
| POST | `/auth/register` | No | Create account |
| POST | `/auth/login` | No | Login |
| POST | `/auth/refresh` | Yes | Refresh JWT token |
| GET | `/journals` | Yes | List entries (`?since=<iso>` for delta) |
| GET | `/journals/:id` | Yes | Get single entry |
| POST | `/journals` | Yes | Create entry (client-generated UUID) |
| PUT | `/journals/:id` | Yes | Update entry |
| DELETE | `/journals/:id` | Yes | Soft-delete entry |
| POST | `/sync` | Yes | Bidirectional sync |

See [ARCHITECTURE.md](ARCHITECTURE.md) §6 for full request/response schemas.

---

## 🛣️ Roadmap

- [x] Architecture & design system
- [x] Server implementation (API, auth, sync engine)
- [x] Windows desktop app
- [x] macOS desktop app
- [x] Linux desktop app
- [ ] iPhone app (React Native or native Swift)
- [ ] Rich text / Markdown editor with formatting toolbar
- [ ] Journal search (full-text search via SQLite FTS5)
- [ ] Journal tags / categories
- [ ] Export to PDF / Markdown files
- [ ] End-to-end encryption (AES-256-GCM)
- [ ] Attachment support (images, voice memos)

---

## 🤝 Contributing

This is a personal project. The codebase is organized so that each platform can be developed independently. See the `agent-*.md` files in each platform folder for detailed build instructions.

---

## 📄 License

Private — for personal use.
