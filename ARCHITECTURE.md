# Custom Journal — Master Architecture Reference

> **Purpose**: This document is the single source of truth for all agents working on the Custom Journal system. Every agent instruction file references this document. Do NOT deviate from the schemas, API contracts, or protocols defined here.

---

## 1. System Overview

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Windows App │   │   Mac App    │   │  Linux App   │
│  (Electron)  │   │  (Electron)  │   │  (Electron)  │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │
       │        HTTPS / REST API             │
       └──────────────────┼──────────────────┘
                          │
                 ┌────────▼────────┐
                 │   RPi 5 Server  │
                 │  (Node.js API)  │
                 │  Port 3377      │
                 │  SQLite DB      │
                 └─────────────────┘
```

- **Server**: Raspberry Pi 5, Raspberry Pi OS Lite 64-bit, Node.js 20 LTS
- **Desktop Apps**: Electron 33+, React 19, TypeScript 5.x
- **Database**: SQLite 3 (both server and client-side)
- **Auth**: JWT (RS256) with bcrypt password hashing
- **Sync**: Offline-first, last-write-wins conflict resolution

---

## 2. Port & Path Conventions

| Component    | Port | Notes                                         |
| ------------ | ---- | --------------------------------------------- |
| Journal API  | 3377 | Chosen to avoid collisions with common services |
| Electron Dev | 5173 | Vite dev server for renderer process          |

**Server Data Directory**: `/opt/custom-journal/`  
**Server DB Path**: `/opt/custom-journal/data/journals.db`  
**Server Logs**: `/opt/custom-journal/logs/`  
**systemd Service**: `custom-journal.service`

---

## 3. Shared TypeScript Types

All platforms MUST use these exact types. Place in `src/shared/types.ts`:

```typescript
// ─── Journal Entry ───────────────────────────────────────────
export interface JournalEntry {
  id: string;              // UUIDv4, generated client-side
  title: string;           // User-provided or empty string
  content: string;         // Journal body (plain text / markdown)
  journal_date: string;    // ISO 8601 datetime — user-editable
  created_at: string;      // ISO 8601 datetime — set once on creation
  updated_at: string;      // ISO 8601 datetime — updated on every edit
  deleted: boolean;        // Soft-delete flag for sync
}

// ─── Sync Payloads ───────────────────────────────────────────
export interface SyncRequest {
  lastSyncTimestamp: string | null; // ISO 8601 or null for first sync
  entries: JournalEntry[];          // Client-modified entries since last sync
}

export interface SyncResponse {
  entries: JournalEntry[];           // Server-modified entries since lastSyncTimestamp
  serverTimestamp: string;           // ISO 8601 — client stores this as new lastSyncTimestamp
  conflicts: ConflictRecord[];       // Informational — entries where server won
}

export interface ConflictRecord {
  entryId: string;
  clientUpdatedAt: string;
  serverUpdatedAt: string;
  resolution: 'server_wins' | 'client_wins';
}

// ─── Auth ────────────────────────────────────────────────────
export interface AuthRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  token: string;        // JWT, 24h expiry
  userId: string;       // UUIDv4
  expiresAt: string;    // ISO 8601
}

// ─── API Error ───────────────────────────────────────────────
export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}
```

---

## 4. Server Database Schema

File: `data/journals.db`

```sql
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                                    -- UUIDv4
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,                            -- bcrypt hash
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Journals table
CREATE TABLE IF NOT EXISTS journals (
  id TEXT PRIMARY KEY,                                    -- UUIDv4 (client-generated)
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  journal_date TEXT NOT NULL,                             -- ISO 8601 (user-editable)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted INTEGER NOT NULL DEFAULT 0,                     -- 0=active, 1=soft-deleted
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_journals_user_id ON journals(user_id);
CREATE INDEX IF NOT EXISTS idx_journals_updated_at ON journals(updated_at);
CREATE INDEX IF NOT EXISTS idx_journals_user_updated ON journals(user_id, updated_at);
```

---

## 5. Client-Side Database Schema

File: stored in Electron's `app.getPath('userData')` as `local_journals.db`

```sql
-- Local journals (mirrors server schema + sync metadata)
CREATE TABLE IF NOT EXISTS journals (
  id TEXT PRIMARY KEY,                                    -- UUIDv4 (generated locally)
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  journal_date TEXT NOT NULL,                             -- ISO 8601 (user-editable)
  created_at TEXT NOT NULL,                               -- ISO 8601
  updated_at TEXT NOT NULL,                               -- ISO 8601
  deleted INTEGER NOT NULL DEFAULT 0,                     -- soft-delete flag
  synced INTEGER NOT NULL DEFAULT 0,                      -- 0=needs sync, 1=synced
  last_synced_at TEXT                                     -- ISO 8601 or NULL
);

-- App configuration key-value store
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Reserved keys:
--   'server_url'          → e.g. 'https://192.168.1.50:3377'
--   'pin_hash'            → bcrypt hash of the user's local PIN
--   'auth_token'          → JWT from server
--   'auth_user_id'        → User's UUID on server
--   'last_sync_timestamp' → ISO 8601 from last successful sync
--   'username'            → Server account username

-- Indexes
CREATE INDEX IF NOT EXISTS idx_journals_updated ON journals(updated_at);
CREATE INDEX IF NOT EXISTS idx_journals_synced ON journals(synced);
```

---

## 6. REST API Contract

**Base URL**: `http://<server-ip>:3377/api`  
**Content-Type**: `application/json`  
**Auth Header**: `Authorization: Bearer <jwt-token>` (required for all except register/login/health)

### 6.1 Authentication

#### POST `/api/auth/register`
```json
// Request
{ "username": "string (3-50 chars, alphanumeric + underscore)", "password": "string (8+ chars)" }
// Response 201
{ "token": "jwt-string", "userId": "uuid", "expiresAt": "iso8601" }
// Error 409
{ "error": "CONFLICT", "message": "Username already exists", "statusCode": 409 }
```

#### POST `/api/auth/login`
```json
// Request
{ "username": "string", "password": "string" }
// Response 200
{ "token": "jwt-string", "userId": "uuid", "expiresAt": "iso8601" }
// Error 401
{ "error": "UNAUTHORIZED", "message": "Invalid credentials", "statusCode": 401 }
```

#### POST `/api/auth/refresh`
```
Authorization: Bearer <current-token>
// Response 200
{ "token": "new-jwt-string", "userId": "uuid", "expiresAt": "iso8601" }
```

### 6.2 Journals (all require auth)

#### GET `/api/journals`
```
Query params: ?since=<iso8601>  (optional — only returns entries updated after this timestamp)
// Response 200
{ "entries": [ JournalEntry, ... ] }
```

#### GET `/api/journals/:id`
```
// Response 200
JournalEntry
// Error 404
{ "error": "NOT_FOUND", "message": "Journal not found", "statusCode": 404 }
```

#### POST `/api/journals`
```json
// Request — 'id' is client-generated UUIDv4
{ "id": "uuid", "title": "string", "content": "string", "journal_date": "iso8601", "created_at": "iso8601", "updated_at": "iso8601" }
// Response 201
JournalEntry
```

#### PUT `/api/journals/:id`
```json
// Request
{ "title": "string", "content": "string", "journal_date": "iso8601", "updated_at": "iso8601" }
// Response 200
JournalEntry
```

#### DELETE `/api/journals/:id`
```
// Performs soft-delete (sets deleted=1, updates updated_at)
// Response 200
{ "id": "uuid", "deleted": true, "updated_at": "iso8601" }
```

### 6.3 Sync

#### POST `/api/sync`
```json
// Request
{
  "lastSyncTimestamp": "iso8601 | null",
  "entries": [ JournalEntry, ... ]    // All client entries modified since lastSyncTimestamp
}
// Response 200
{
  "entries": [ JournalEntry, ... ],   // All server entries client needs to update
  "serverTimestamp": "iso8601",       // Client stores as new lastSyncTimestamp
  "conflicts": [ ConflictRecord, ... ]
}
```

### 6.4 Health

#### GET `/api/health`
```json
// Response 200 (no auth required)
{ "status": "ok", "version": "1.0.0", "uptime": 12345 }
```

---

## 7. Sync Protocol (Detailed)

### 7.1 Trigger Conditions
Sync fires on:
1. App startup (after unlock)
2. After saving/editing/deleting a journal entry (debounced 3 seconds)
3. When network connectivity is restored (listen for `online` event)
4. Manual "Sync Now" button press
5. Periodic interval (every 5 minutes while app is unlocked and online)

### 7.2 Sync Flow
```
Client                                Server
  │                                      │
  │  1. Query local DB for entries       │
  │     where synced=0 OR                │
  │     updated_at > lastSyncTimestamp   │
  │                                      │
  │  2. POST /api/sync ─────────────────►│
  │     { lastSyncTimestamp, entries }   │
  │                                      │
  │                          3. For each client entry:
  │                             a. If server has same ID:
  │                                - Compare updated_at
  │                                - If client > server: UPDATE server row
  │                                - If server > client: ADD to response
  │                                - If equal: skip (already in sync)
  │                             b. If server doesn't have it:
  │                                - INSERT into server DB
  │                                                      │
  │                          4. Query server DB for entries
  │                             where updated_at > client's
  │                             lastSyncTimestamp AND were
  │                             NOT just updated by client
  │                                                      │
  │  5. ◄────────────────── Response      │
  │     { entries, serverTimestamp,       │
  │       conflicts }                    │
  │                                      │
  │  6. For each server entry:           │
  │     - UPSERT into local DB           │
  │     - Set synced=1                   │
  │                                      │
  │  7. Mark all sent entries synced=1   │
  │  8. Store serverTimestamp as          │
  │     lastSyncTimestamp                │
  │                                      │
```

### 7.3 Conflict Resolution: Last-Write-Wins
- Compare `updated_at` timestamps (ISO 8601, UTC)
- The entry with the later `updated_at` wins
- Losing entry is overwritten entirely
- Conflicts are logged in the response for UI notification but are non-blocking

### 7.4 Offline Queue
- When offline, all creates/edits/deletes are saved locally with `synced=0`
- When connectivity returns, sync fires automatically
- Queue processes in chronological order (by `updated_at`)

---

## 8. Security Model

### 8.1 Local PIN Lock
- User sets a 4-8 digit PIN on first app launch
- PIN is hashed with bcrypt (12 rounds) and stored in `app_config` table
- Lock screen is a full-window overlay — NO content visible behind it
- Unlock requires correct PIN entry

### 8.2 Lock Triggers
| Trigger                  | Windows   | Mac       | Linux     |
| ------------------------ | --------- | --------- | --------- |
| Hotkey                   | Alt+L     | Cmd+L     | Alt+L     |
| Window loses focus       | ✓         | ✓         | ✓         |
| App minimized            | ✓         | ✓         | ✓         |

### 8.3 Server Auth
- JWT tokens with 24-hour expiry
- Tokens are stored in local `app_config` table (NOT in localStorage or cookies)
- Auto-refresh: when a request returns 401, attempt token refresh. If refresh fails, prompt user to re-login in settings.
- Passwords hashed with bcrypt (12 rounds) on server

---

## 9. Project Structure Templates

### 9.1 Server (`server/`)
```
server/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts                 # Entry point — starts Express server
│   ├── config.ts                # Environment config loader
│   ├── database.ts              # SQLite connection + schema init
│   ├── middleware/
│   │   ├── auth.ts              # JWT verification middleware
│   │   ├── errorHandler.ts      # Global error handler
│   │   └── requestLogger.ts     # Request logging
│   ├── routes/
│   │   ├── auth.ts              # /api/auth/* routes
│   │   ├── journals.ts          # /api/journals/* routes
│   │   ├── sync.ts              # /api/sync route
│   │   └── health.ts            # /api/health route
│   ├── services/
│   │   ├── authService.ts       # Auth business logic
│   │   ├── journalService.ts    # Journal CRUD logic
│   │   └── syncService.ts       # Sync/conflict resolution logic
│   └── shared/
│       └── types.ts             # Shared TypeScript types (§3)
├── scripts/
│   ├── install.sh               # Server installation script for RPi
│   └── custom-journal.service   # systemd service file
└── data/                        # Created at runtime, holds journals.db
```

### 9.2 Desktop App (`<platform>-app/`)
```
<platform>-app/
├── package.json
├── tsconfig.json
├── electron-builder.yml         # Platform-specific build config
├── vite.config.ts               # Vite config for renderer
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # Main entry — window creation, IPC
│   │   ├── database.ts          # Local SQLite setup + queries
│   │   ├── syncService.ts       # Sync engine (runs in main process)
│   │   ├── networkMonitor.ts    # Online/offline detection
│   │   └── ipcHandlers.ts      # IPC channel handlers
│   ├── preload/
│   │   └── index.ts             # Preload script — exposes IPC to renderer
│   ├── renderer/                # React app (Vite-bundled)
│   │   ├── index.html
│   │   ├── main.tsx             # React entry
│   │   ├── App.tsx              # Root component with routing
│   │   ├── components/
│   │   │   ├── LockScreen.tsx   # PIN entry overlay
│   │   │   ├── JournalList.tsx  # Chronological list of entries
│   │   │   ├── JournalEditor.tsx # Create/edit journal entry
│   │   │   ├── DateTimePicker.tsx # Manual date/time override
│   │   │   ├── Settings.tsx     # Server URL, PIN change, account
│   │   │   ├── SyncStatus.tsx   # Sync indicator (synced/pending/offline)
│   │   │   └── Sidebar.tsx      # Navigation sidebar
│   │   ├── hooks/
│   │   │   ├── useJournals.ts   # Journal CRUD hook
│   │   │   ├── useLock.ts       # Lock state management
│   │   │   └── useSync.ts       # Sync status hook
│   │   ├── styles/
│   │   │   ├── global.css       # Global styles, CSS variables, fonts
│   │   │   ├── lock.css         # Lock screen styles
│   │   │   ├── editor.css       # Journal editor styles
│   │   │   └── sidebar.css      # Sidebar styles
│   │   └── lib/
│   │       ├── ipc.ts           # Type-safe IPC wrapper
│   │       └── utils.ts         # Date formatting, UUID generation
│   └── shared/
│       └── types.ts             # Shared types (§3)
```

---

## 10. Dependency List

### Server (`package.json`)
```json
{
  "dependencies": {
    "express": "^4.21.0",
    "better-sqlite3": "^11.7.0",
    "jsonwebtoken": "^9.0.2",
    "bcrypt": "^5.1.1",
    "cors": "^2.8.5",
    "helmet": "^8.0.0",
    "uuid": "^11.0.0",
    "dotenv": "^16.4.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/express": "^5.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/jsonwebtoken": "^9.0.0",
    "@types/bcrypt": "^5.0.0",
    "@types/cors": "^2.8.0",
    "@types/uuid": "^10.0.0",
    "tsx": "^4.19.0"
  }
}
```

### Desktop App (`package.json`)
```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "better-sqlite3": "^11.7.0",
    "uuid": "^11.0.0",
    "bcrypt": "^5.1.1"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.1.0",
    "@electron/rebuild": "^3.7.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.7.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/uuid": "^10.0.0",
    "@types/bcrypt": "^5.0.0"
  }
}
```

---

## 11. UI/UX Design System

### Color Palette (CSS Variables)
```css
:root {
  /* Dark theme (default) */
  --bg-primary: #0f0f14;
  --bg-secondary: #1a1a24;
  --bg-tertiary: #252533;
  --bg-elevated: #2a2a3a;
  --text-primary: #e8e8ed;
  --text-secondary: #9595a8;
  --text-muted: #5a5a72;
  --accent-primary: #7c6bf0;      /* Purple accent */
  --accent-secondary: #5b8def;    /* Blue accent */
  --accent-gradient: linear-gradient(135deg, #7c6bf0 0%, #5b8def 100%);
  --danger: #ef4444;
  --success: #22c55e;
  --warning: #f59e0b;
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-default: rgba(255, 255, 255, 0.1);
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.5);
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-normal: 250ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-slow: 400ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

### Typography
- **Font**: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- **Load from**: Google Fonts CDN (`https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap`)
- **Sizes**: 12px (caption), 14px (body), 16px (subtitle), 20px (title), 28px (h1)

### Layout
- Sidebar (260px) + Main content (flex: 1)
- Lock screen: fixed overlay, z-index 9999, covers entire window
- Glassmorphism on lock screen: `backdrop-filter: blur(20px)`

---

## 12. IPC Channel Names

All IPC communication between main and renderer processes uses these exact channel names:

```typescript
// Journals
'journal:get-all'       → () => JournalEntry[]
'journal:get-by-id'     → (id: string) => JournalEntry | null
'journal:create'        → (entry: Omit<JournalEntry, 'id' | 'created_at' | 'updated_at'>) => JournalEntry
'journal:update'        → (id: string, updates: Partial<JournalEntry>) => JournalEntry
'journal:delete'        → (id: string) => void

// Sync
'sync:trigger'          → () => { success: boolean; message: string }
'sync:get-status'       → () => { online: boolean; lastSync: string | null; pendingCount: number }
'sync:on-status-change' → callback: (status: SyncStatus) => void  // main→renderer event

// Lock
'lock:lock'             → () => void
'lock:unlock'           → (pin: string) => { success: boolean }
'lock:set-pin'          → (pin: string) => void
'lock:has-pin'          → () => boolean
'lock:is-locked'        → () => boolean

// Settings
'settings:get'          → (key: string) => string | null
'settings:set'          → (key: string, value: string) => void
'settings:get-all'      → () => Record<string, string>

// Auth (server account)
'auth:login'            → (serverUrl: string, username: string, password: string) => AuthResponse
'auth:register'         → (serverUrl: string, username: string, password: string) => AuthResponse
'auth:is-configured'    → () => boolean
```

---

## 13. Electron Window Configuration

```typescript
const mainWindow = new BrowserWindow({
  width: 1200,
  height: 800,
  minWidth: 800,
  minHeight: 600,
  frame: true,              // Native frame (platform-appropriate)
  titleBarStyle: 'hiddenInset', // Mac only — gives clean look
  backgroundColor: '#0f0f14',
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,    // REQUIRED for security
    nodeIntegration: false,    // REQUIRED for security
    sandbox: false             // Needed for better-sqlite3 in preload
  },
  icon: path.join(__dirname, 'assets', 'icon.png'), // 512x512 PNG
  show: false,               // Show after ready-to-show event
});

mainWindow.once('ready-to-show', () => {
  mainWindow.show();
});
```
