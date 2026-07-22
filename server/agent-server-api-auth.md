# Agent: Server API & Authentication

> **Role**: Build all authentication and journal CRUD API endpoints.
> **Prerequisites**: Server project setup complete (from `agent-server-project-setup.md`).
> **Reference**: `../ARCHITECTURE.md` §3, §4, §6 for types, schema, and API contracts.

---

## Deliverables

1. `src/shared/types.ts` — shared TypeScript interfaces
2. `src/middleware/auth.ts` — JWT verification middleware
3. `src/services/authService.ts` — registration, login, token refresh
4. `src/services/journalService.ts` — journal CRUD operations
5. `src/routes/auth.ts` — auth endpoints
6. `src/routes/journals.ts` — journal endpoints
7. `src/routes/health.ts` — health check endpoint
8. Update `src/index.ts` to mount all routes

---

## Step 1: Shared Types

Create **`src/shared/types.ts`**:

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

// ─── Database Row Types ──────────────────────────────────────
export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
}

export interface JournalRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  journal_date: string;
  created_at: string;
  updated_at: string;
  deleted: number; // SQLite stores booleans as 0/1
}
```

---

## Step 2: Auth Middleware

Create **`src/middleware/auth.ts`**:

```typescript
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AppError } from './errorHandler.js';

// Extend Express Request to include userId
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      username?: string;
    }
  }
}

interface JwtPayload {
  userId: string;
  username: string;
  iat: number;
  exp: number;
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authorization header is required');
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    throw new AppError(401, 'UNAUTHORIZED', 'Authorization header must be: Bearer <token>');
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Token has expired. Please refresh or login again.');
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw new AppError(401, 'INVALID_TOKEN', 'Token is invalid');
    }
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication failed');
  }
}
```

---

## Step 3: Auth Service

Create **`src/services/authService.ts`**:

```typescript
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import db from '../database.js';
import { config } from '../config.js';
import { AppError } from '../middleware/errorHandler.js';
import type { AuthResponse, UserRow } from '../shared/types.js';

// ─── Validation Schemas ──────────────────────────────────────

export const registerSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be at most 50 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters'),
});

export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

// ─── Helper: Generate JWT ────────────────────────────────────

function generateToken(userId: string, username: string): { token: string; expiresAt: string } {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h
  const token = jwt.sign(
    { userId, username },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
  return { token, expiresAt };
}

// ─── Register ────────────────────────────────────────────────

export async function registerUser(username: string, password: string): Promise<AuthResponse> {
  // Validate input
  const parsed = registerSchema.parse({ username, password });

  // Check if username already exists
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(parsed.username) as UserRow | undefined;
  if (existing) {
    throw new AppError(409, 'CONFLICT', 'Username already exists');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(parsed.password, config.bcryptRounds);

  // Create user
  const userId = uuidv4();
  db.prepare(
    'INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)'
  ).run(userId, parsed.username, passwordHash);

  // Generate JWT
  const { token, expiresAt } = generateToken(userId, parsed.username);

  console.log(`[auth] User registered: ${parsed.username} (${userId})`);

  return { token, userId, expiresAt };
}

// ─── Login ───────────────────────────────────────────────────

export async function loginUser(username: string, password: string): Promise<AuthResponse> {
  // Validate input
  const parsed = loginSchema.parse({ username, password });

  // Find user
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(parsed.username) as UserRow | undefined;
  if (!user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid credentials');
  }

  // Verify password
  const valid = await bcrypt.compare(parsed.password, user.password_hash);
  if (!valid) {
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid credentials');
  }

  // Generate JWT
  const { token, expiresAt } = generateToken(user.id, user.username);

  console.log(`[auth] User logged in: ${user.username} (${user.id})`);

  return { token, userId: user.id, expiresAt };
}

// ─── Refresh Token ───────────────────────────────────────────

export function refreshToken(userId: string): AuthResponse {
  // Verify user still exists
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
  if (!user) {
    throw new AppError(401, 'UNAUTHORIZED', 'User no longer exists');
  }

  const { token, expiresAt } = generateToken(user.id, user.username);

  return { token, userId: user.id, expiresAt };
}
```

---

## Step 4: Journal Service

Create **`src/services/journalService.ts`**:

```typescript
import { z } from 'zod';
import db from '../database.js';
import { AppError } from '../middleware/errorHandler.js';
import type { JournalEntry, JournalRow } from '../shared/types.js';

// ─── Validation Schemas ──────────────────────────────────────

export const createJournalSchema = z.object({
  id: z.string().uuid('id must be a valid UUIDv4'),
  title: z.string().default(''),
  content: z.string().default(''),
  journal_date: z.string().datetime({ message: 'journal_date must be ISO 8601' }),
  created_at: z.string().datetime({ message: 'created_at must be ISO 8601' }),
  updated_at: z.string().datetime({ message: 'updated_at must be ISO 8601' }),
});

export const updateJournalSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  journal_date: z.string().datetime({ message: 'journal_date must be ISO 8601' }).optional(),
  updated_at: z.string().datetime({ message: 'updated_at must be ISO 8601' }),
});

// ─── Helper: Row → Entry ────────────────────────────────────

function rowToEntry(row: JournalRow): JournalEntry {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    journal_date: row.journal_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted: row.deleted === 1,
  };
}

// ─── Get All Journals ────────────────────────────────────────

export function getAllJournals(userId: string, since?: string): JournalEntry[] {
  let rows: JournalRow[];

  if (since) {
    rows = db.prepare(
      'SELECT * FROM journals WHERE user_id = ? AND updated_at > ? ORDER BY journal_date DESC'
    ).all(userId, since) as JournalRow[];
  } else {
    rows = db.prepare(
      'SELECT * FROM journals WHERE user_id = ? ORDER BY journal_date DESC'
    ).all(userId) as JournalRow[];
  }

  return rows.map(rowToEntry);
}

// ─── Get Journal By ID ───────────────────────────────────────

export function getJournalById(userId: string, id: string): JournalEntry {
  const row = db.prepare(
    'SELECT * FROM journals WHERE id = ? AND user_id = ?'
  ).get(id, userId) as JournalRow | undefined;

  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'Journal not found');
  }

  return rowToEntry(row);
}

// ─── Create Journal ──────────────────────────────────────────

export function createJournal(userId: string, entry: z.infer<typeof createJournalSchema>): JournalEntry {
  const parsed = createJournalSchema.parse(entry);

  // Check for duplicate ID
  const existing = db.prepare('SELECT id FROM journals WHERE id = ?').get(parsed.id);
  if (existing) {
    throw new AppError(409, 'CONFLICT', 'Journal with this ID already exists');
  }

  db.prepare(
    `INSERT INTO journals (id, user_id, title, content, journal_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(parsed.id, userId, parsed.title, parsed.content, parsed.journal_date, parsed.created_at, parsed.updated_at);

  return getJournalById(userId, parsed.id);
}

// ─── Update Journal ──────────────────────────────────────────

export function updateJournal(userId: string, id: string, updates: z.infer<typeof updateJournalSchema>): JournalEntry {
  const parsed = updateJournalSchema.parse(updates);

  // Verify journal exists and belongs to user
  const existing = db.prepare(
    'SELECT id FROM journals WHERE id = ? AND user_id = ?'
  ).get(id, userId);

  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Journal not found');
  }

  // Build dynamic update query
  const setClauses: string[] = [];
  const values: (string)[] = [];

  if (parsed.title !== undefined) {
    setClauses.push('title = ?');
    values.push(parsed.title);
  }
  if (parsed.content !== undefined) {
    setClauses.push('content = ?');
    values.push(parsed.content);
  }
  if (parsed.journal_date !== undefined) {
    setClauses.push('journal_date = ?');
    values.push(parsed.journal_date);
  }

  // Always update updated_at
  setClauses.push('updated_at = ?');
  values.push(parsed.updated_at);

  values.push(id, userId);

  db.prepare(
    `UPDATE journals SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`
  ).run(...values);

  return getJournalById(userId, id);
}

// ─── Delete Journal (Soft Delete) ────────────────────────────

export function deleteJournal(userId: string, id: string): { id: string; deleted: boolean; updated_at: string } {
  // Verify journal exists and belongs to user
  const existing = db.prepare(
    'SELECT id FROM journals WHERE id = ? AND user_id = ?'
  ).get(id, userId);

  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Journal not found');
  }

  const now = new Date().toISOString();

  db.prepare(
    'UPDATE journals SET deleted = 1, updated_at = ? WHERE id = ? AND user_id = ?'
  ).run(now, id, userId);

  return { id, deleted: true, updated_at: now };
}
```

---

## Step 5: Auth Routes

Create **`src/routes/auth.ts`**:

```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { registerUser, loginUser, refreshToken } from '../services/authService.js';
import { authMiddleware } from '../middleware/auth.js';

export const authRouter = Router();

// POST /api/auth/register
authRouter.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = req.body;
    const result = await registerUser(username, password);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = req.body;
    const result = await loginUser(username, password);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/refresh — requires valid (or recently expired) token
authRouter.post('/refresh', authMiddleware, (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = refreshToken(req.userId!);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
```

---

## Step 6: Journal Routes

Create **`src/routes/journals.ts`**:

```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  getAllJournals,
  getJournalById,
  createJournal,
  updateJournal,
  deleteJournal,
} from '../services/journalService.js';

export const journalsRouter = Router();

// All journal routes require authentication
journalsRouter.use(authMiddleware);

// GET /api/journals?since=<iso8601>
journalsRouter.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const since = req.query.since as string | undefined;
    const entries = getAllJournals(req.userId!, since);
    res.json({ entries });
  } catch (err) {
    next(err);
  }
});

// GET /api/journals/:id
journalsRouter.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = getJournalById(req.userId!, req.params.id);
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

// POST /api/journals
journalsRouter.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = createJournal(req.userId!, req.body);
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

// PUT /api/journals/:id
journalsRouter.put('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = updateJournal(req.userId!, req.params.id, req.body);
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/journals/:id
journalsRouter.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = deleteJournal(req.userId!, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
```

---

## Step 7: Health Route

Create **`src/routes/health.ts`**:

```typescript
import { Router, Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let version = '1.0.0';
try {
  const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));
  version = pkg.version;
} catch {
  // fallback to default
}

export const healthRouter = Router();

// GET /api/health — no auth required
healthRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version,
    uptime: Math.floor(process.uptime()),
  });
});
```

---

## Step 8: Update Entry Point

Replace the route-related section in **`src/index.ts`**. Remove the commented-out imports and the temporary health endpoint, and replace with:

```typescript
// Replace the commented-out import block with:
import { authRouter } from './routes/auth.js';
import { journalsRouter } from './routes/journals.js';
import { healthRouter } from './routes/health.js';
// Note: syncRouter will be added by the sync-engine agent

// Replace the temporary health route and commented route mounts with:
app.use('/api/auth', authRouter);
app.use('/api/journals', journalsRouter);
app.use('/api/health', healthRouter);
// app.use('/api/sync', syncRouter);  // Uncomment when sync agent delivers
```

---

## Verification: Test with curl

Run the server in dev mode first:
```bash
npm run dev
```

### 1. Register a user
```bash
curl -X POST http://localhost:3377/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"testpass123"}'
```
**Expected**: `201` with `{ "token": "...", "userId": "...", "expiresAt": "..." }`

### 2. Login
```bash
curl -X POST http://localhost:3377/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"testpass123"}'
```
**Expected**: `200` with token

### 3. Create a journal (use the token from step 1 or 2)
```bash
TOKEN="<paste-token-here>"
curl -X POST http://localhost:3377/api/journals \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "My First Journal",
    "content": "Hello world! This is my first journal entry.",
    "journal_date": "2026-07-22T10:00:00.000Z",
    "created_at": "2026-07-22T10:00:00.000Z",
    "updated_at": "2026-07-22T10:00:00.000Z"
  }'
```
**Expected**: `201` with the created journal entry

### 4. Get all journals
```bash
curl http://localhost:3377/api/journals \
  -H "Authorization: Bearer $TOKEN"
```
**Expected**: `200` with `{ "entries": [...] }`

### 5. Update a journal
```bash
curl -X PUT http://localhost:3377/api/journals/550e8400-e29b-41d4-a716-446655440000 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "title": "Updated Title",
    "content": "Updated content here.",
    "updated_at": "2026-07-22T11:00:00.000Z"
  }'
```
**Expected**: `200` with updated entry

### 6. Delete a journal (soft delete)
```bash
curl -X DELETE http://localhost:3377/api/journals/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer $TOKEN"
```
**Expected**: `200` with `{ "id": "...", "deleted": true, "updated_at": "..." }`

### 7. Test auth rejection (no token)
```bash
curl http://localhost:3377/api/journals
```
**Expected**: `401` with `{ "error": "UNAUTHORIZED", ... }`

### 8. Refresh token
```bash
curl -X POST http://localhost:3377/api/auth/refresh \
  -H "Authorization: Bearer $TOKEN"
```
**Expected**: `200` with new token

### 9. Health check
```bash
curl http://localhost:3377/api/health
```
**Expected**: `200` with `{ "status": "ok", "version": "1.0.0", "uptime": ... }`

> **Next**: Hand off to the sync engine agent (`agent-server-sync-engine.md`).
