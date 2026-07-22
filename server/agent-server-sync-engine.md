# Agent: Server Sync Engine

> **Role**: Build the sync endpoint and conflict resolution logic.
> **Prerequisites**: Server project setup and API/Auth agents complete.
> **Reference**: `../ARCHITECTURE.md` §7 for the full sync protocol.

---

## Deliverables

1. `src/services/syncService.ts` — sync processing and conflict resolution
2. `src/routes/sync.ts` — sync endpoint
3. Update `src/index.ts` to mount the sync route

---

## Step 1: Sync Service

Create **`src/services/syncService.ts`**:

```typescript
import db from '../database.js';
import type { JournalEntry, JournalRow, SyncRequest, SyncResponse, ConflictRecord } from '../shared/types.js';

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

// ─── Process Sync ────────────────────────────────────────────

/**
 * Processes a sync request from a client.
 *
 * Protocol:
 * 1. For each client entry:
 *    a. If server has same ID → compare updated_at, latest wins
 *    b. If server doesn't have it → insert
 * 2. Query server for entries updated since client's lastSyncTimestamp
 *    that weren't just processed from the client
 * 3. Return those entries + new serverTimestamp
 */
export function processSync(userId: string, syncRequest: SyncRequest): SyncResponse {
  const responseEntries: JournalEntry[] = [];
  const conflicts: ConflictRecord[] = [];
  const processedIds = new Set<string>();

  // Use a transaction for atomicity
  const syncTransaction = db.transaction(() => {
    // ── Step 1: Process each client entry ──────────────────
    for (const clientEntry of syncRequest.entries) {
      processedIds.add(clientEntry.id);

      // Look up existing entry on server
      const serverRow = db.prepare(
        'SELECT * FROM journals WHERE id = ? AND user_id = ?'
      ).get(clientEntry.id, userId) as JournalRow | undefined;

      if (serverRow) {
        // Entry exists on server — compare timestamps
        const clientTime = new Date(clientEntry.updated_at).getTime();
        const serverTime = new Date(serverRow.updated_at).getTime();

        if (clientTime > serverTime) {
          // Client wins — update server with client's data
          db.prepare(
            `UPDATE journals
             SET title = ?, content = ?, journal_date = ?,
                 created_at = ?, updated_at = ?, deleted = ?
             WHERE id = ? AND user_id = ?`
          ).run(
            clientEntry.title,
            clientEntry.content,
            clientEntry.journal_date,
            clientEntry.created_at,
            clientEntry.updated_at,
            clientEntry.deleted ? 1 : 0,
            clientEntry.id,
            userId
          );

          conflicts.push({
            entryId: clientEntry.id,
            clientUpdatedAt: clientEntry.updated_at,
            serverUpdatedAt: serverRow.updated_at,
            resolution: 'client_wins',
          });
        } else if (serverTime > clientTime) {
          // Server wins — add server's version to response for client to update
          responseEntries.push(rowToEntry(serverRow));

          conflicts.push({
            entryId: clientEntry.id,
            clientUpdatedAt: clientEntry.updated_at,
            serverUpdatedAt: serverRow.updated_at,
            resolution: 'server_wins',
          });
        }
        // If equal timestamps — entries are in sync, skip
      } else {
        // Entry doesn't exist on server — insert it
        db.prepare(
          `INSERT INTO journals (id, user_id, title, content, journal_date, created_at, updated_at, deleted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          clientEntry.id,
          userId,
          clientEntry.title,
          clientEntry.content,
          clientEntry.journal_date,
          clientEntry.created_at,
          clientEntry.updated_at,
          clientEntry.deleted ? 1 : 0
        );
      }
    }

    // ── Step 2: Get server entries the client needs ────────
    let serverEntries: JournalRow[];

    if (syncRequest.lastSyncTimestamp) {
      serverEntries = db.prepare(
        'SELECT * FROM journals WHERE user_id = ? AND updated_at > ?'
      ).all(userId, syncRequest.lastSyncTimestamp) as JournalRow[];
    } else {
      // First sync — send everything
      serverEntries = db.prepare(
        'SELECT * FROM journals WHERE user_id = ?'
      ).all(userId) as JournalRow[];
    }

    // Filter out entries we just processed from the client
    // (unless the server won the conflict, in which case it's already in responseEntries)
    for (const row of serverEntries) {
      if (!processedIds.has(row.id)) {
        responseEntries.push(rowToEntry(row));
      }
    }
  });

  // Execute the transaction
  syncTransaction();

  // Generate server timestamp AFTER the transaction completes
  const serverTimestamp = new Date().toISOString();

  return {
    entries: responseEntries,
    serverTimestamp,
    conflicts,
  };
}
```

---

## Step 2: Sync Route

Create **`src/routes/sync.ts`**:

```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { processSync } from '../services/syncService.js';

export const syncRouter = Router();

// Validation schema for sync request
const syncRequestSchema = z.object({
  lastSyncTimestamp: z.string().datetime().nullable(),
  entries: z.array(z.object({
    id: z.string().uuid(),
    title: z.string(),
    content: z.string(),
    journal_date: z.string().datetime(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    deleted: z.boolean(),
  })),
});

// POST /api/sync — requires auth
syncRouter.post('/', authMiddleware, (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate request body
    const parsed = syncRequestSchema.parse(req.body);

    // Process sync
    const result = processSync(req.userId!, parsed);

    console.log(
      `[sync] User ${req.userId}: received ${parsed.entries.length} entries, ` +
      `sending ${result.entries.length} entries, ` +
      `${result.conflicts.length} conflicts`
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});
```

---

## Step 3: Update Entry Point

In **`src/index.ts`**, add the sync route import and mount:

```typescript
// Add to imports:
import { syncRouter } from './routes/sync.js';

// Add to route mounts (after the journals mount):
app.use('/api/sync', syncRouter);
```

---

## Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| Empty `entries` array | Server returns its entries since `lastSyncTimestamp`, no conflicts |
| `lastSyncTimestamp` is `null` | First sync — server returns ALL entries for the user |
| Entry with `deleted: true` | Soft-delete propagates via sync. The `deleted` flag is updated like any other field. |
| Concurrent sync requests | SQLite WAL mode + `busy_timeout` handles concurrent reads/writes safely. The transaction ensures atomicity. |
| Duplicate insert (same ID) | If both client and server have the entry, timestamp comparison determines the winner. |
| Clock skew between devices | Last-write-wins uses the `updated_at` timestamp as-is. If clocks are skewed, the "newer" timestamp wins regardless. Users should keep device clocks synced (NTP). |

---

## Verification: Test with curl

Assuming the server is running and you have a `$TOKEN` from the auth tests:

### 1. First sync (empty client, null timestamp)
```bash
curl -X POST http://localhost:3377/api/sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "lastSyncTimestamp": null,
    "entries": []
  }'
```
**Expected**: `200` with all server entries (if any), a `serverTimestamp`, and empty `conflicts`

### 2. Client sends new entries
```bash
curl -X POST http://localhost:3377/api/sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "lastSyncTimestamp": null,
    "entries": [
      {
        "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee01",
        "title": "Synced Entry 1",
        "content": "This was written offline.",
        "journal_date": "2026-07-22T08:00:00.000Z",
        "created_at": "2026-07-22T08:00:00.000Z",
        "updated_at": "2026-07-22T08:00:00.000Z",
        "deleted": false
      },
      {
        "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee02",
        "title": "Synced Entry 2",
        "content": "Another offline entry.",
        "journal_date": "2026-07-22T09:00:00.000Z",
        "created_at": "2026-07-22T09:00:00.000Z",
        "updated_at": "2026-07-22T09:00:00.000Z",
        "deleted": false
      }
    ]
  }'
```
**Expected**: `200` with `entries` (server entries client doesn't have), `serverTimestamp`, possibly empty `conflicts`

### 3. Conflict scenario — server has newer version
First, update an entry directly on the server:
```bash
curl -X PUT http://localhost:3377/api/journals/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee01 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "title": "Server Updated Title",
    "content": "Server edited this entry.",
    "updated_at": "2026-07-23T12:00:00.000Z"
  }'
```

Then sync with an older client version:
```bash
curl -X POST http://localhost:3377/api/sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "lastSyncTimestamp": "2026-07-22T07:00:00.000Z",
    "entries": [
      {
        "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee01",
        "title": "Client Title (older)",
        "content": "Client version is older.",
        "journal_date": "2026-07-22T08:00:00.000Z",
        "created_at": "2026-07-22T08:00:00.000Z",
        "updated_at": "2026-07-22T10:00:00.000Z",
        "deleted": false
      }
    ]
  }'
```
**Expected**: `200` with `conflicts` showing `server_wins` for that entry, and the server's version in `entries`

### 4. Soft-delete propagation
```bash
curl -X POST http://localhost:3377/api/sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "lastSyncTimestamp": "2026-07-22T07:00:00.000Z",
    "entries": [
      {
        "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee02",
        "title": "Synced Entry 2",
        "content": "Another offline entry.",
        "journal_date": "2026-07-22T09:00:00.000Z",
        "created_at": "2026-07-22T09:00:00.000Z",
        "updated_at": "2026-07-25T00:00:00.000Z",
        "deleted": true
      }
    ]
  }'
```
**Expected**: `200`, and the entry on the server now has `deleted=1`

Verify:
```bash
curl http://localhost:3377/api/journals/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee02 \
  -H "Authorization: Bearer $TOKEN"
```
**Expected**: `deleted: true`

> **Server is complete.** All three server agents have delivered their components. Run `npm run build` and verify zero TypeScript errors before deploying to the Raspberry Pi.
