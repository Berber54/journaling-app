# Custom Journal — Architecture & Learning Guide

> **Who this is for.** This is the single source of truth for how the whole system fits together, written so that a developer new to Electron, sync, and client/server apps can *learn* from it — not just look things up. Concepts are explained the first time they appear. If you only want the contracts (schemas, endpoints, IPC channels), jump to §5, §7, §8, and §15.
>
> **Golden rule for contributors:** the schemas, API shapes, and IPC channel names in this document must match the code. If you change one, change the other in the same commit.

---

## Table of Contents

1. [The big picture (mental model)](#1-the-big-picture-mental-model)
2. [Concepts primer](#2-concepts-primer)
3. [Repository layout](#3-repository-layout)
4. [The two databases](#4-the-two-databases)
5. [Shared TypeScript types](#5-shared-typescript-types)
6. [The server, end to end](#6-the-server-end-to-end)
7. [REST API contract](#7-rest-api-contract)
8. [The sync protocol, in depth](#8-the-sync-protocol-in-depth)
9. [The desktop app, end to end](#9-the-desktop-app-end-to-end)
10. [Security model](#10-security-model)
11. [The AI assistant](#11-the-ai-assistant)
12. [Rich text & images](#12-rich-text--images)
13. [Building & running](#13-building--running)
14. [Design system](#14-design-system)
15. [IPC channel reference](#15-ipc-channel-reference)
16. [Glossary](#16-glossary)

---

## 1. The big picture (mental model)

Custom Journal is a **private, offline-first journal that syncs across your own devices** through a server you host yourself (typically a Raspberry Pi on your home network). There is no third-party cloud.

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Windows App │   │   Mac App    │   │  Linux App   │
│  (Electron)  │   │  (Electron)  │   │  (Electron)  │
│              │   │              │   │              │
│  local DB ●  │   │  local DB ●  │   │  local DB ●  │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │
       │       HTTP + JSON REST (port 3377)  │
       └──────────────────┼──────────────────┘
                          │
                 ┌────────▼────────┐
                 │   RPi 5 Server  │
                 │  Node.js + API  │
                 │  SQLite DB  ●   │
                 └─────────────────┘
```

Two ideas drive the entire design:

1. **Every device has its own full copy of the data** (a local SQLite database). You can read and write with the network unplugged. The server is *not* the place you talk to directly while writing — your local database is.
2. **The server is a shared meeting point.** Periodically each app pushes its local changes up and pulls everyone else's changes down. This is **sync**. Because two devices can edit the same entry while offline, sync needs a rule for resolving conflicts — we use **last-write-wins** (the most recently edited version wins).

Keep this picture in mind: **write locally → sync in the background → the server reconciles → other devices pull.** Everything else is detail.

---

## 2. Concepts primer

New to some of this? Read this once and the rest of the document will make sense.

**Client vs. server.** A *server* is a long-running program that waits for requests and answers them. A *client* is a program that makes requests. Here the desktop apps are clients; the Node.js program on the Pi is the server. They talk over **HTTP** (the same protocol web browsers use) exchanging **JSON** (a plain-text data format).

**REST API.** A convention for structuring an HTTP API around *resources* and *verbs*: `GET /journals` reads the list, `POST /journals` creates one, `PUT /journals/:id` updates one, `DELETE /journals/:id` removes one. Each endpoint is a URL; the HTTP method (GET/POST/…) says what to do.

**Offline-first.** The app is fully usable with no network. Writes go to the local database immediately and are marked "not yet synced." When the network returns, they flow to the server. The opposite approach ("online-first") would make every keystroke depend on the server being reachable — which we deliberately avoid.

**SQLite.** A complete SQL database that lives in a single file, with no separate database server to run. Both the Pi and each desktop app use it. We access it through the fast native library **`better-sqlite3`**.

**JWT (JSON Web Token).** After you log in, the server hands you a signed token — a compact string that encodes *who you are* plus an expiry, signed with a secret only the server knows. You attach it to later requests (`Authorization: Bearer <token>`). The server verifies the signature to trust the request without re-checking your password every time. Ours use the **HS256** algorithm (a symmetric secret) and expire after 24 hours.

**Electron.** A framework for building desktop apps with web technology (HTML/CSS/React). An Electron app runs **two kinds of process**, and understanding the split is essential (see §9):
  - the **main process** — a Node.js program with full access to the OS, the filesystem, and the local SQLite database;
  - the **renderer process** — a sandboxed Chromium window running the React UI, with *no* direct access to files or the database.
  The two talk over a controlled channel called **IPC** (inter-process communication).

**Debounce.** "Wait until things stop happening, then act once." When you type, we don't save on every keystroke; we wait ~1 second after you *stop*, then save. This avoids hammering the database and the sync engine.

---

## 3. Repository layout

```
custom_journal/
├── ARCHITECTURE.md          ← You are here (system-wide reference)
├── README.md                ← Product overview & setup steps
├── server/                  ← The sync server (runs on the Raspberry Pi)
│   ├── src/
│   │   ├── index.ts         # Express entry point — wires up middleware + routes
│   │   ├── config.ts        # Reads environment variables (.env) into one config object
│   │   ├── database.ts      # Opens SQLite, creates tables/indexes
│   │   ├── middleware/      # Cross-cutting request logic
│   │   │   ├── auth.ts          # Verifies the JWT on protected routes
│   │   │   ├── errorHandler.ts  # Turns thrown errors into clean JSON responses
│   │   │   └── requestLogger.ts # Logs "METHOD path -> status (ms)"
│   │   ├── routes/          # URL → handler mapping (thin)
│   │   │   ├── auth.ts, journals.ts, sync.ts, health.ts
│   │   ├── services/        # The actual business logic (thick)
│   │   │   ├── authService.ts, journalService.ts, syncService.ts
│   │   └── shared/types.ts  # Types shared across the server
│   └── scripts/
│       ├── install.sh              # One-shot installer for the Pi
│       └── custom-journal.service  # systemd unit so the server auto-starts
├── windows-app/             ← Windows desktop client (Electron) — the reference client
│   └── src/
│       ├── main/            # Main process (Node): DB, sync, network, biometrics, LLM, IPC
│       ├── preload/         # The secure bridge exposed to the UI (index.cts → index.cjs)
│       ├── renderer/        # React UI: components, hooks, styles, lib
│       └── shared/types.ts  # Types shared between main, preload, and renderer
├── mac-app/  linux-app/     ← Same architecture, platform-specific touches
└── iphone-app/              ← Planned
```

**Why routes are thin and services are thick.** A *route* only knows about HTTP: read the request, call a function, send a response, forward errors. A *service* knows about the domain: how to hash a password, how to reconcile a sync. Keeping them separate means the interesting logic is testable without spinning up a web server, and the HTTP layer stays boring and uniform.

---

## 4. The two databases

There are **two** SQLite databases with deliberately different shapes. The server's is the shared source of truth; the client's mirrors it and adds bookkeeping columns the server never sees.

### 4.1 Server database (`server/data/journals.db`)

```sql
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,                                   -- UUIDv4
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,                                      -- bcrypt hash
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS journals (
  id           TEXT PRIMARY KEY,                                    -- UUIDv4 (generated by the client)
  user_id      TEXT NOT NULL,                                       -- which account owns it
  title        TEXT NOT NULL DEFAULT '',
  content      TEXT NOT NULL DEFAULT '',                            -- rich-text HTML
  journal_date TEXT NOT NULL,                                       -- ISO 8601, user-editable
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted      INTEGER NOT NULL DEFAULT 0,                          -- 0 = active, 1 = soft-deleted
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_journals_user_id      ON journals(user_id);
CREATE INDEX IF NOT EXISTS idx_journals_updated_at   ON journals(updated_at);
CREATE INDEX IF NOT EXISTS idx_journals_user_updated ON journals(user_id, updated_at);
```

Notes for learners:
- **The client generates the `id`.** A brand-new entry gets a UUID *on the device* before it has ever touched the server. That's what lets you create entries offline and still have a stable identity when they finally sync.
- **Soft delete.** Deleting sets `deleted = 1` instead of removing the row. A hard delete couldn't propagate — other devices would have no way to learn the entry is gone. The tombstone row *can* sync.
- **`updated_at` is the sync clock.** It changes on every edit and is the single value the conflict rule compares. See §8.
- **PRAGMAs** set at open time: `journal_mode = WAL` (readers don't block the writer — good for a server), `busy_timeout = 5000` (wait up to 5 s for a lock instead of erroring), `foreign_keys = ON` (enforce the `user_id` relationship, so deleting a user cascades to their journals).

### 4.2 Client database (Electron `userData/local_journals.db`)

```sql
CREATE TABLE IF NOT EXISTS journals (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL DEFAULT '',
  content        TEXT NOT NULL DEFAULT '',
  journal_date   TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted        INTEGER NOT NULL DEFAULT 0,
  synced         INTEGER NOT NULL DEFAULT 0,   -- 0 = has local changes to push, 1 = matches server
  last_synced_at TEXT                          -- ISO 8601 or NULL
);

CREATE TABLE IF NOT EXISTS app_config (        -- a simple key/value store
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS journal_images (    -- inline images, base64 data URLs (LOCAL ONLY)
  id         TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL,
  data       TEXT NOT NULL,                     -- e.g. "data:image/png;base64,...."
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_journals_updated ON journals(updated_at);
CREATE INDEX IF NOT EXISTS idx_journals_synced  ON journals(synced);
CREATE INDEX IF NOT EXISTS idx_images_journal   ON journal_images(journal_id);
```

Two columns exist **only on the client** and are the heart of offline-first:
- **`synced`** — `0` means "this row has changes the server hasn't seen yet." The sync engine's outbound queue is literally `SELECT * FROM journals WHERE synced = 0`.
- **`last_synced_at`** — informational timestamp of when the row last matched the server.

**`app_config`** holds everything that isn't a journal. Reserved keys:

| Key | Meaning |
|-----|---------|
| `server_url` | e.g. `http://192.168.1.50:3377` |
| `pin_hash` | bcrypt hash of the local unlock passphrase (the key name is historical — it is a passphrase, not just digits) |
| `auth_token` | the JWT returned by the server |
| `auth_user_id` | the account's UUID on the server |
| `username` | the server account username |
| `last_sync_timestamp` | server clock from the last successful sync (sent on the next sync) |
| `biometric_enabled` | `"true"`/`"false"` — whether Windows Hello unlock is offered |
| `openai_api_key` | your OpenAI key (used by the AI assistant, sent only to OpenAI) |
| `openai_model` | the default chat model, e.g. `gpt-4o` |

> **Known limitation — images don't sync.** `journal_images` lives only on the device that added the images. The sync payload (§8) carries `journals` rows only. This keeps sync simple and payloads small; syncing attachments is on the roadmap.

---

## 5. Shared TypeScript types

These are the contracts every layer agrees on. The server copy lives at `server/src/shared/types.ts`; the client copy at `windows-app/src/shared/types.ts`. Keep the journal/sync/auth shapes identical between them.

```typescript
// ─── A single journal entry (the core object) ────────────────
export interface JournalEntry {
  id: string;              // UUIDv4, generated on the client
  title: string;
  content: string;         // rich-text HTML
  journal_date: string;    // ISO 8601 — user-editable (backdating supported)
  created_at: string;      // ISO 8601 — set once
  updated_at: string;      // ISO 8601 — bumped on every edit; the conflict clock
  deleted: boolean;        // soft-delete flag
}

// ─── Sync ────────────────────────────────────────────────────
export interface SyncRequest {
  lastSyncTimestamp: string | null; // server clock from our last sync (null on first sync)
  entries: JournalEntry[];          // our local changes to push (rows where synced = 0)
}
export interface SyncResponse {
  entries: JournalEntry[];          // server changes we need to apply locally
  serverTimestamp: string;          // we store this as the next lastSyncTimestamp
  conflicts: ConflictRecord[];      // informational: where a version was overwritten
}
export interface ConflictRecord {
  entryId: string;
  clientUpdatedAt: string;
  serverUpdatedAt: string;
  resolution: 'server_wins' | 'client_wins';
}

// ─── Auth ────────────────────────────────────────────────────
export interface AuthRequest  { username: string; password: string; }
export interface AuthResponse { token: string; userId: string; expiresAt: string; }

// ─── Errors (uniform shape for every failure) ────────────────
export interface ApiError { error: string; message: string; statusCode: number; }
```

Client-only additions (in `windows-app/src/shared/types.ts`):

```typescript
export interface JournalImage { id: string; journal_id: string; data: string; created_at: string; }
export interface ChatMessage  { role: 'system' | 'user' | 'assistant'; content: string; }
export interface SyncStatus   { online: boolean; lastSync: string | null; pendingCount: number; syncing: boolean; }
// ElectronAPI — the full list of functions the preload bridge exposes to the UI (see §15).
```

---

## 6. The server, end to end

### 6.1 What happens on startup (`index.ts`)

```
express()                      create the app
  → helmet()                   sensible security headers
  → cors({ origin: '*' })      allow any device on your LAN to call the API
  → express.json({limit:10mb}) parse JSON request bodies (10mb allows large entries)
  → requestLogger              log every request when it finishes
  → /api/auth      → authRouter
  → /api/journals  → journalsRouter   (each route protected by authMiddleware)
  → /api/health    → healthRouter
  → /api/sync      → syncRouter       (protected)
  → errorHandler               last in line: converts thrown errors → JSON
app.listen(PORT, '0.0.0.0')    bind on ALL interfaces so other devices can reach it
```

Binding to `0.0.0.0` (rather than `127.0.0.1`) is what makes the server reachable from other machines on the network — a common first-time gotcha. On `SIGTERM`/`SIGINT` the server stops accepting connections, closes the database, and exits (with a 10-second safety timeout).

### 6.2 Configuration (`config.ts`)

Reads a `.env` file into one frozen `config` object: `port` (3377), `jwtSecret`, `dbPath`, `nodeEnv`, `logLevel`, plus constants `jwtExpiresIn = '24h'` and `bcryptRounds = 12`. **Safety valve:** if `NODE_ENV=production` and `JWT_SECRET` is still the placeholder, the process exits immediately — you can't accidentally run a production server with a guessable signing key.

### 6.3 Middleware (the request pipeline)

Middleware are functions that see a request *on its way* to the handler. Ours:
- **`requestLogger`** — records start time, and on `res.finish` logs `METHOD url -> status (ms)`. `4xx`/`5xx` log at `warn`.
- **`authMiddleware`** — for protected routes. Requires `Authorization: Bearer <token>`, verifies the JWT, and attaches `req.userId` / `req.username`. It throws typed `AppError`s (`401 TOKEN_EXPIRED`, `401 INVALID_TOKEN`, …) which Express routes to the error handler.
- **`errorHandler`** — the single place errors become responses. `AppError` → its own status/code; `ZodError` (validation) → `400 VALIDATION_ERROR` with readable messages; anything else → `500 INTERNAL_ERROR` with a generic message (never leak internals).

**Validation with Zod.** Services parse untrusted input with a Zod *schema* (e.g. username must be 3–50 chars of `[a-zA-Z0-9_]`, password ≥ 8, timestamps must be ISO 8601). If input doesn't match, Zod throws and the error handler returns a clean `400`. This is our first line of defense against malformed or malicious requests.

### 6.4 Services (the logic)

- **`authService.ts`** — `registerUser` (validate → reject duplicate username with `409` → bcrypt-hash the password → insert → issue JWT), `loginUser` (look up → `bcrypt.compare` → issue JWT; identical error for "no such user" and "wrong password" so you can't probe which usernames exist), and `refreshToken` (see §7.1 — deliberately tolerates an *expired* token so the client can stay logged in).
- **`journalService.ts`** — CRUD for the REST endpoints, each scoped by `user_id` so one account can never read or write another's rows. `getAllJournals(userId, since?)` supports delta reads; delete is soft.
- **`syncService.ts`** — the reconciliation engine (§8).

---

## 7. REST API contract

**Base URL:** `http://<server-ip>:3377/api` · **Body:** `application/json` · **Auth:** `Authorization: Bearer <jwt>` on everything except `register`, `login`, and `health`.

Every error uses the uniform shape `{ "error": CODE, "message": "...", "statusCode": n }`.

### 7.1 Authentication

```
POST /api/auth/register
  → { "username": "3-50 chars [a-zA-Z0-9_]", "password": "8+ chars" }
  ← 201 { "token", "userId", "expiresAt" }
  ← 409 { "error": "CONFLICT", "message": "Username already exists", ... }

POST /api/auth/login
  → { "username", "password" }
  ← 200 { "token", "userId", "expiresAt" }
  ← 401 { "error": "UNAUTHORIZED", "message": "Invalid credentials", ... }

POST /api/auth/refresh          Header: Authorization: Bearer <current-or-recently-expired token>
  ← 200 { "token", "userId", "expiresAt" }
```

> **Why refresh accepts an expired token (important design detail).** The client refreshes *reactively*: when a request comes back `401`, it calls `/auth/refresh` to get a new token, then retries. But by the time you hit a `401`, your token has usually just *expired* — so if refresh required a still-valid token, it could never help. Therefore `/auth/refresh` verifies the incoming token with `ignoreExpiration: true`: a recently expired but correctly-signed token is exchanged for a fresh one; a token with a *bad signature* is still rejected. This is what makes "24-hour expiry with seamless auto-refresh" actually work. (Trade-off: it is a sliding session — a valid token can be renewed indefinitely. Acceptable for a personal LAN app; if you needed hard 24-hour cutoffs you'd add separate short-lived access + long-lived refresh tokens.)

### 7.2 Journals (all require auth, all scoped to your account)

```
GET    /api/journals            optional ?since=<iso8601> for a delta read
                                ← 200 { "entries": [ JournalEntry, ... ] }
GET    /api/journals/:id        ← 200 JournalEntry | 404 NOT_FOUND
POST   /api/journals            → { id, title, content, journal_date, created_at, updated_at }
                                ← 201 JournalEntry  (409 if that id already exists)
PUT    /api/journals/:id        → { title?, content?, journal_date?, updated_at }
                                ← 200 JournalEntry
DELETE /api/journals/:id        soft-delete
                                ← 200 { "id", "deleted": true, "updated_at" }
```

> These per-entry endpoints exist for completeness and other clients. **The desktop apps do not use them for normal operation** — they push and pull exclusively through `POST /api/sync`, which batches everything into one round trip.

### 7.3 Sync

```
POST /api/sync
  → { "lastSyncTimestamp": "iso8601 | null", "entries": [ JournalEntry, ... ] }
  ← { "entries": [ JournalEntry, ... ], "serverTimestamp": "iso8601", "conflicts": [ ... ] }
```

The request body is validated by a Zod schema: `id` must be a UUID, every timestamp must be ISO 8601, `deleted` must be a boolean. See §8 for the semantics.

### 7.4 Health

```
GET /api/health   (no auth)   ← 200 { "status": "ok", "version": "1.0.0", "uptime": 12345 }
```

The client polls this to decide whether the server is reachable (§9.4).

---

## 8. The sync protocol, in depth

This is the most important — and most subtle — part of the system. Read it slowly.

### 8.1 When sync runs (triggers)

The client fires a sync:
1. **After a create/edit/delete**, debounced 3 s (so a burst of edits produces one sync).
2. **When connectivity is (re)gained** — including once at startup, as soon as `/api/health` first succeeds.
3. **Every 5 minutes** on a timer.
4. **Manually**, via the "Sync Now" button.
5. **Right after login or registration.**

A guard (`isSyncing`) ensures only one sync runs at a time; another is a no-op while one is in flight.

### 8.2 What the client sends

```
lastSyncTimestamp  ← app_config 'last_sync_timestamp'  (null the very first time)
entries            ← SELECT * FROM journals WHERE synced = 0   (everything with local changes)
```

So the outbound payload is exactly "my unsynced changes" plus "the server clock from last time." Note the client filters purely on `synced = 0`; it does not also filter by `updated_at`.

### 8.3 What the server does (`processSync`, run inside one SQLite transaction)

For **each incoming entry**, compare it to the server's row of the same `id`:

```
if the server has no such row:
    INSERT it            (a brand-new entry from this device)
else compare updated_at (parsed to milliseconds):
    client newer  → UPDATE the server row with the client's version
                    record a conflict { resolution: 'client_wins' }
    server newer  → keep the server row, ADD it to the response so the client updates
                    record a conflict { resolution: 'server_wins' }
    equal         → do nothing (already in sync)
```

Then the server gathers **what to send back**: every row for this user with `updated_at > lastSyncTimestamp` (or *all* rows when it's `null`), **excluding** the ids it just processed above (those are already settled). It replies with those rows, a fresh `serverTimestamp` (its "now"), and the list of conflicts.

Doing all of this in a transaction means a crash mid-sync can't leave the server half-updated — it's all-or-nothing.

### 8.4 What the client does with the response

```
for each entry in response.entries:  upsertFromServer(entry)   -- write it locally, set synced = 1
mark every entry we SENT as synced = 1                          -- the server has them now
store response.serverTimestamp as 'last_sync_timestamp'         -- basis for the next delta
if response.entries is non-empty:  notify the UI to reload the list
```

That last line matters: sync happens in the background **main process**, but the list you see lives in the **renderer**. Without an explicit "journals changed" signal, entries pulled from another device (or the whole history pulled on a fresh login) would sit in the local DB invisibly until the app restarted. The main process emits a `journal:changed` event; the `useJournals` hook listens and re-queries.

### 8.5 Conflict resolution: last-write-wins (LWW)

The rule is simply: **the version with the later `updated_at` wins; the loser is overwritten whole.** Conflicts are reported for visibility but never block a sync.

Why comparing ISO-8601 timestamps as plain strings is safe: because they're all UTC in the same fixed format (`2026-07-22T15:04:05.123Z`), *lexicographic* order equals *chronological* order. The server also parses them to milliseconds for the head-to-head comparison. Everything uses `new Date().toISOString()`, so the format is uniform across devices.

A pleasant consequence: an entry you are *actively editing* has `synced = 0` and a just-now `updated_at`, so an older copy arriving from the server can't clobber your in-progress work — your version is newer and wins.

### 8.6 A worked example

```
Start: server has entry X (updated_at = 10:00).  Laptop and phone both hold X@10:00, both offline.

Phone (offline):   edit X → X@10:05, synced=0
Laptop (offline):  edit X → X@10:03, synced=0

Phone reconnects, syncs:
    sends X@10:05. Server had 10:00 → client newer → server stores X@10:05 (client_wins).
    Phone marks X synced=1.

Laptop reconnects, syncs:
    sends X@10:03. Server has 10:05 → server newer → server keeps 10:05 and returns it (server_wins).
    Laptop applies X@10:05, marks synced=1, UI refreshes.

End state: every device holds X@10:05. The 10:03 edit lost — that is LWW by design.
```

### 8.7 Edge cases & limits worth knowing

- **Deletes are entries too.** A delete is `deleted=1` + a bumped `updated_at`, synced like any edit. Other devices apply it and it drops out of the list (the UI filters `deleted`).
- **First sync** (`lastSyncTimestamp = null`) pulls the account's entire history — this is how a new device is seeded.
- **LWW is per-entry and coarse.** Two people editing different sentences of the same entry: the later save wins the *whole* entry; there is no field-level merge.
- **Clock skew.** LWW trusts device clocks. Wildly wrong clocks can make an older edit "win." On a home network with normal time sync this is a non-issue.
- **Images are not part of the payload** (see §4.2).

---

## 9. The desktop app, end to end

### 9.1 Electron's two processes (and why the split matters)

```
┌─────────────────────────── MAIN PROCESS (Node.js, trusted) ───────────────────────────┐
│  index.ts          window creation, Alt+L global shortcut, lock-on-blur/minimize       │
│  database.ts       the local SQLite database (journals, images, config)                │
│  ipcHandlers.ts    receives requests from the UI, calls the right module               │
│  syncService.ts    the sync engine + server auth (login/register/refresh)              │
│  networkMonitor.ts online/offline detection (net.online + /api/health polling)         │
│  biometric.ts      Windows Hello prompt via PowerShell + WinRT                          │
│  llmService.ts     talks to OpenAI                                                      │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                             │  IPC (contextBridge) — the ONLY doorway
┌───────────────────────────────────────────▼────────────────────────────────────────────┐
│                       RENDERER PROCESS (Chromium + React, sandboxed)                     │
│  window.electronAPI.*   ← a small, fixed set of functions exposed by the preload script │
│  App.tsx, components/, hooks/    the UI. No direct filesystem or database access.        │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Why not just let the React code touch the database directly?** Security. The renderer runs web content; if it could `require('fs')` or open the database, a bug (or malicious pasted content) could read your whole disk. So the renderer runs with **`contextIsolation: true`** and **`nodeIntegration: false`** — it has no Node.js powers. The only way it reaches the OS is through a **preload script** that exposes a hand-picked list of functions on `window.electronAPI`. That list *is* the app's trust boundary.

> `sandbox: false` is set because the main process loads the native `better-sqlite3` module in the same runtime; the renderer stays locked down regardless. The preload is written as `index.cts` and compiled to CommonJS `index.cjs` so it loads correctly in Electron's preload environment.

### 9.2 The preload bridge (`preload/index.cts`)

The preload runs in a privileged context but with access to `contextBridge`. It calls `contextBridge.exposeInMainWorld('electronAPI', { ... })`, wiring each UI-facing function to an IPC call. There are two shapes:
- **Request/response:** `ipcRenderer.invoke('channel', args)` returns a Promise — used for "do this and tell me the result" (get journals, unlock, chat).
- **Subscriptions:** `ipcRenderer.on('channel', handler)` for events the *main* process pushes — lock triggers, sync-status updates, "journals changed." Each returns an unsubscribe function so React can clean up.

### 9.3 A change's full journey (follow one keystroke)

```
You type in the editor
  → JournalEditor debounces ~1s, then calls window.electronAPI.journalUpdate(id, {title, content, journal_date, updated_at})
  → preload forwards it as ipcRenderer.invoke('journal:update', …)
  → ipcHandlers 'journal:update' handler runs updateJournal() in database.ts
        → row updated locally, synced = 0
  → the handler calls debouncedSync() (waits 3s, then sync())
  → syncService.sync() pushes rows where synced=0 to POST /api/sync, applies the response, sets synced=1
  → if the server sent anything back, main emits 'journal:changed'
  → useJournals hook re-queries and the sidebar/editor update
```

Your text was safe in the local database within a second — long before any network call. That is offline-first in action.

### 9.4 Network monitor (`networkMonitor.ts`)

Every 30 seconds (and once at startup) it checks two things: (1) is the OS online at all (`net.online`), and (2) can we actually reach *this* server (`GET /api/health` with a 5 s timeout)? Only if both pass is the app "online." Transitioning from offline→online triggers a sync automatically, so reconnecting after a flight or a dead zone flushes your queue without you doing anything.

### 9.5 Renderer structure

- **`App.tsx`** — top-level state machine: show a loader, then the **LockScreen** if locked, otherwise the main layout (Sidebar + editor/settings, with an optional AI ChatPanel overlay).
- **Hooks** — `useJournals` (CRUD + auto-reload on `journal:changed`), `useLock` (locked/unlocked, passphrase, biometric availability), `useSync` (live `SyncStatus`).
- **Components** — `Sidebar` (entries grouped by month), `JournalEditor` (rich-text surface + toolbar + images + editable date), `DateTimePicker` (backdating), `Settings` (server login, sync status, biometric toggle, OpenAI config, change passphrase), `ChatPanel` (AI), `SyncStatus` (the colored status dot), `LockScreen`.

---

## 10. Security model

Two independent layers: a **local lock** protecting the app on this device, and **server auth** protecting the account over the network.

### 10.1 Local passphrase lock
- On first launch you set a passphrase — **any characters, minimum 6** (not restricted to digits; the internal config key is `pin_hash` for historical reasons).
- It's hashed with **bcrypt (12 rounds)** and stored in the client's `app_config`. The plaintext is never stored.
- Unlock re-hashes your input and compares. The lock screen is a full-window overlay with a blurred backdrop — **no entry content is visible or in the DOM behind it.**

### 10.2 Lock triggers

| Trigger | Windows | Mac | Linux |
|---|---|---|---|
| Hotkey | Alt+L | Cmd+L | Alt+L |
| Window loses focus (blur) | ✓ | ✓ | ✓ |
| Window minimized | ✓ | ✓ | ✓ |

The main process owns these events and pushes a `lock:lock` message; the renderer flips to the LockScreen. Locking on blur means simply switching apps re-locks your journal.

### 10.3 Biometric unlock — Windows Hello (`biometric.ts`)
Electron has no built-in Hello API, so the main process drives the OS's **WinRT `UserConsentVerifier`** through a hidden PowerShell process:
- The PowerShell script is passed as a UTF-16LE **base64 `-EncodedCommand`**, which sidesteps all shell-quoting/escaping issues.
- Because the OS consent dialog attaches to the *calling* process's foreground window, the script briefly creates an invisible top-most window and forces itself foreground so the Hello prompt appears on top (no alt-tab hunting).
- It's strictly **opt-in and best-effort**: only offered once a passphrase exists (so there's always a fallback), can be disabled in Settings, and any cancel/error simply falls back to the passphrase. Verified → unlock; anything else → stay locked.

### 10.4 Server authentication
- Passwords are bcrypt-hashed (12 rounds) server-side; the server never stores plaintext.
- Login/register issue a **JWT (HS256)** carrying `{ userId, username }` with a **24-hour** expiry.
- The token lives in the client's `app_config` (not a browser cookie or `localStorage`) and is attached as `Authorization: Bearer …`.
- On a `401`, the client calls `/auth/refresh` once and retries; if that fails it surfaces "please log in again." (See §7.1 for why refresh tolerates expiry.)

### 10.5 Threat model & honest limitations
- **Transport is plain HTTP.** There is no TLS. This is designed for a **trusted LAN**. Anyone who can sniff your network can see journal content and tokens. For remote access, front the server with a reverse proxy that terminates HTTPS, or a VPN/WireGuard tunnel.
- **`cors: '*'`** is permissive; fine on a private network, reconsider if exposing publicly.
- **No end-to-end encryption yet.** The server stores journal text in plaintext SQLite; anyone with the Pi's disk can read it. E2E encryption is on the roadmap.
- **The OpenAI key and images stay on the device** — never sent to the sync server — but the AI feature does send entry text to OpenAI when you use it (see §11).

---

## 11. The AI assistant

An optional feature to *chat about your journal*. It never runs unless you add a key.

- **Where the key lives.** You paste an OpenAI API key in Settings (or the chat's key gate). It's stored in the client's `app_config` (`openai_api_key`) and used only by the main process.
- **How a message flows.** `ChatPanel` builds a **system prompt** from your entries — for "this entry" mode just the current one; for "all entries" mode it packs entries newest-first up to a ~48,000-character budget, then flips them chronological so the transcript reads oldest→newest. Entry HTML is converted to plain text first. It sends `{ model, messages }` over IPC → `llmService.chatWithLLM` → `POST https://api.openai.com/v1/chat/completions` (temperature 0.7).
- **Privacy boundary.** The request goes **from your machine directly to OpenAI**. It does **not** pass through your sync server. Errors are mapped to friendly messages (bad key → 401 guidance, quota → 429 guidance, network failure → check-connection).
- Models offered: `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini` (all use the same Chat Completions request shape). The default is saved as `openai_model`.

---

## 12. Rich text & images

**Rich text.** The editor content is **HTML**, edited in a `contentEditable` surface. The toolbar (bold/italic/underline/color) uses `document.execCommand` with `styleWithCSS` so colors emit inline `<span style>` rather than legacy `<font>` tags. Two helpers keep things robust:
- On load, older **plain-text** entries (no HTML tags) are detected and their newlines converted to `<br>` so nothing collapses.
- For previews and for feeding the AI, `htmlToText()` strips tags back to readable plain text (turning `<br>`/`<div>`/`<p>` into newlines).

The surface is *uncontrolled*: React doesn't re-render it on every keystroke (that would fight the caret). Instead the HTML is pushed in imperatively when the selected entry changes, and read back out on save.

**Images.** "Add image" reads files as base64 **data URLs** (`FileReader.readAsDataURL`) and stores them in the `journal_images` table via IPC. They render inline from the stored data URL. As noted in §4.2 and §8.7, images are **local to the device** and are not part of sync.

---

## 13. Building & running

### 13.1 Server (on the Raspberry Pi)
```bash
cd server
npm install
npm run build            # tsc → dist/
cp .env.example .env      # then set JWT_SECRET (required in production) and PORT
npm start                 # node dist/index.js   → listens on 0.0.0.0:3377
# health check:
curl http://localhost:3377/api/health   # → {"status":"ok",...}
```
For always-on operation, install the provided `scripts/custom-journal.service` systemd unit so the server starts on boot and restarts on crash.

### 13.2 Desktop app
```bash
cd windows-app          # (or mac-app / linux-app)
npm install
npx @electron/rebuild    # rebuild native modules (better-sqlite3, bcrypt) for Electron's Node
npm run dev              # Vite dev server (5173) + Electron with live reload
npm run package          # production build → NSIS installer in dist-electron/
```

**Native modules — the #1 build gotcha.** `better-sqlite3` and `bcrypt` are *native* (C++) addons. A compiled `.node` file is tied to an exact Node/Electron ABI version. Symptoms of a mismatch: `NODE_MODULE_VERSION 115 … requires 147` or `ERR_DLOPEN_FAILED`. Fixes:
- For the **Electron app**, run `npx @electron/rebuild` so the module is built against *Electron's* bundled Node, not your system Node.
- For the **server**, run under a Node version whose ABI matches the installed binary, or `npm rebuild better-sqlite3` for your current Node (needs C++ build tools — on Windows, the "Desktop development with C++" workload).

### 13.3 How the build is wired
- **Server** (`tsconfig.json`, `noUnusedLocals`/`noUnusedParameters` on for tidiness) → `tsc` → `dist/`.
- **App main + preload** → `tsc -p tsconfig.main.json` → `dist/main`, `dist/preload` (preload `.cts` → `.cjs`).
- **App renderer** → Vite (`root: src/renderer`, output `dist/renderer`) → bundled HTML/JS/CSS.
- **Packaging** → `electron-builder` (`electron-builder.yml`): NSIS installer, `dist/**` + `node_modules` bundled, `main: dist/main/index.js`.

---

## 14. Design system

Dark-first UI, defined as CSS variables in `renderer/styles/global.css`.

```css
:root {
  --bg-primary:#0f0f14; --bg-secondary:#1a1a24; --bg-tertiary:#252533; --bg-elevated:#2a2a3a;
  --text-primary:#e8e8ed; --text-secondary:#9595a8; --text-muted:#5a5a72;
  --accent-primary:#7c6bf0; --accent-secondary:#5b8def;
  --accent-gradient:linear-gradient(135deg,#7c6bf0 0%,#5b8def 100%);
  --danger:#ef4444; --success:#22c55e; --warning:#f59e0b;
  --border-subtle:rgba(255,255,255,.06); --border-default:rgba(255,255,255,.1);
  --radius-sm:6px; --radius-md:10px; --radius-lg:16px; --radius-xl:24px;
  --transition-fast:150ms cubic-bezier(.4,0,.2,1);
  --transition-normal:250ms cubic-bezier(.4,0,.2,1);
}
```
- **Type:** Inter, then system fonts. Sizes 12/14/16/20/28.
- **Layout:** ~260px sidebar + flexible main content. Lock screen is a fixed full-window overlay with `backdrop-filter: blur(20px)`.
- **The sync dot** (`SyncStatus`): blue = syncing, red = offline, yellow = *N* pending, green = synced.

---

## 15. IPC channel reference

The exact channels bridged by the preload. `invoke` = request/response (returns a Promise); `on` = a push event from main → renderer.

```typescript
// Journals
invoke 'journal:get-all'      () => JournalEntry[]
invoke 'journal:get-by-id'    (id) => JournalEntry | null
invoke 'journal:create'       ({title, content, journal_date}) => JournalEntry
invoke 'journal:update'       (id, updates) => JournalEntry
invoke 'journal:delete'       (id) => void
on     'journal:changed'      () => void          // fired after a sync pulls entries down

// Images (local only)
invoke 'image:add'            (journalId, dataUrl) => JournalImage
invoke 'image:list'           (journalId) => JournalImage[]
invoke 'image:delete'         (id) => void

// Sync
invoke 'sync:trigger'         () => { success, message }
invoke 'sync:get-status'      () => SyncStatus
on     'sync:on-status-change'(status: SyncStatus) => void

// Lock (secret is a passphrase, not just digits)
invoke 'lock:lock'            () => void
invoke 'lock:unlock'          (passphrase) => { success }
invoke 'lock:set-pin'         (passphrase) => void
invoke 'lock:has-pin'         () => boolean
invoke 'lock:is-locked'       () => boolean
on     'lock:lock' (event)    () => void          // main tells renderer to lock

// Biometric (Windows Hello)
invoke 'biometric:available'  () => boolean
invoke 'biometric:verify'     (reason?) => boolean

// AI assistant (OpenAI)
invoke 'llm:chat'             ({ model, messages }) => string

// Settings (app_config key/value)
invoke 'settings:get'         (key) => string | null
invoke 'settings:set'         (key, value) => void
invoke 'settings:get-all'     () => Record<string,string>

// Server account auth
invoke 'auth:login'           (serverUrl, username, password) => AuthResponse
invoke 'auth:register'        (serverUrl, username, password) => AuthResponse
invoke 'auth:is-configured'   () => boolean
```

### Electron window configuration
```typescript
new BrowserWindow({
  width: 1200, height: 800, minWidth: 800, minHeight: 600,
  frame: true,                 // native window frame (Windows/Linux); mac uses hiddenInset
  backgroundColor: '#0f0f14',  // avoids a white flash before the UI paints
  webPreferences: {
    preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
    contextIsolation: true,    // REQUIRED — isolate the UI from Node
    nodeIntegration: false,    // REQUIRED — no Node APIs in the renderer
    sandbox: false,            // main process loads native better-sqlite3
  },
  show: false,                 // reveal on 'ready-to-show' (no white flash)
});
```

---

## 16. Glossary

- **ABI** — the binary contract a compiled native module (like `better-sqlite3`) is built against; must match the runtime's (Node or Electron) or it won't load.
- **bcrypt** — a deliberately slow password-hashing function; "12 rounds" sets the work factor.
- **contextEditable / execCommand** — browser APIs for an editable HTML region and applying formatting to a selection.
- **contextBridge / preload** — Electron's mechanism for safely exposing a fixed set of functions from a privileged script to the sandboxed UI.
- **debounce** — collapse a rapid burst of events into a single action after things go quiet.
- **delta read** — fetching only what changed since a timestamp (`?since=`), instead of everything.
- **IPC** — inter-process communication; how the Electron main and renderer processes talk.
- **JWT / HS256** — a signed token proving identity; HS256 signs it with one shared secret.
- **LWW (last-write-wins)** — conflict rule: the version with the newer `updated_at` replaces the other.
- **main vs. renderer** — Electron's trusted Node process vs. its sandboxed UI process.
- **soft delete** — marking a row `deleted = 1` (a tombstone) instead of removing it, so the deletion can sync.
- **UUIDv4** — a random 128-bit identifier, unique enough to generate offline without coordination.
- **WAL** — SQLite's write-ahead logging mode; lets reads proceed concurrently with a write.
- **Zod** — a TypeScript library that validates untrusted input against a schema at runtime.
```
