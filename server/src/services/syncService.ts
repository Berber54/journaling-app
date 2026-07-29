import db from '../database.js';
import type {
  ConflictRecord,
  ImageRow,
  JournalEntry,
  JournalRow,
  SyncImage,
  SyncRequest,
  SyncResponse,
} from '../shared/types.js';

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

function rowToImage(row: ImageRow): SyncImage {
  return {
    id: row.id,
    journal_id: row.journal_id,
    data: row.data,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted: row.deleted === 1,
  };
}

export function processSync(userId: string, syncRequest: SyncRequest): SyncResponse {
  const responseEntries: JournalEntry[] = [];
  const responseImages: SyncImage[] = [];
  const conflicts: ConflictRecord[] = [];
  const processedIds = new Set<string>();
  const processedImageIds = new Set<string>();

  const syncTransaction = db.transaction(() => {
    for (const clientEntry of syncRequest.entries) {
      processedIds.add(clientEntry.id);

      const serverRow = db.prepare('SELECT * FROM journals WHERE id = ? AND user_id = ?').get(clientEntry.id, userId) as
        | JournalRow
        | undefined;

      if (serverRow) {
        const clientTime = new Date(clientEntry.updated_at).getTime();
        const serverTime = new Date(serverRow.updated_at).getTime();

        if (clientTime > serverTime) {
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
          responseEntries.push(rowToEntry(serverRow));

          conflicts.push({
            entryId: clientEntry.id,
            clientUpdatedAt: clientEntry.updated_at,
            serverUpdatedAt: serverRow.updated_at,
            resolution: 'server_wins',
          });
        }
      } else {
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

    let serverEntries: JournalRow[];

    if (syncRequest.lastSyncTimestamp) {
      serverEntries = db
        .prepare('SELECT * FROM journals WHERE user_id = ? AND updated_at > ?')
        .all(userId, syncRequest.lastSyncTimestamp) as JournalRow[];
    } else {
      serverEntries = db.prepare('SELECT * FROM journals WHERE user_id = ?').all(userId) as JournalRow[];
    }

    for (const row of serverEntries) {
      if (!processedIds.has(row.id)) {
        responseEntries.push(rowToEntry(row));
      }
    }

    // ─── Images ──────────────────────────────────────────────
    // Same last-write-wins reconciliation as journals, keyed on updated_at.
    // Image bytes are effectively immutable, so in practice the only "conflict"
    // is an add racing a delete tombstone — LWW settles that too.
    for (const clientImage of syncRequest.images ?? []) {
      processedImageIds.add(clientImage.id);

      const serverImage = db
        .prepare('SELECT * FROM journal_images WHERE id = ? AND user_id = ?')
        .get(clientImage.id, userId) as ImageRow | undefined;

      if (serverImage) {
        const clientTime = new Date(clientImage.updated_at).getTime();
        const serverTime = new Date(serverImage.updated_at).getTime();
        if (clientTime > serverTime) {
          db.prepare(
            `UPDATE journal_images
             SET journal_id = ?, data = ?, created_at = ?, updated_at = ?, deleted = ?
             WHERE id = ? AND user_id = ?`
          ).run(
            clientImage.journal_id,
            clientImage.data,
            clientImage.created_at,
            clientImage.updated_at,
            clientImage.deleted ? 1 : 0,
            clientImage.id,
            userId
          );
        } else if (serverTime > clientTime) {
          responseImages.push(rowToImage(serverImage));
        }
      } else {
        db.prepare(
          `INSERT INTO journal_images (id, user_id, journal_id, data, created_at, updated_at, deleted)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          clientImage.id,
          userId,
          clientImage.journal_id,
          clientImage.data,
          clientImage.created_at,
          clientImage.updated_at,
          clientImage.deleted ? 1 : 0
        );
      }
    }

    let serverImages: ImageRow[];
    if (syncRequest.lastSyncTimestamp) {
      serverImages = db
        .prepare('SELECT * FROM journal_images WHERE user_id = ? AND updated_at > ?')
        .all(userId, syncRequest.lastSyncTimestamp) as ImageRow[];
    } else {
      serverImages = db.prepare('SELECT * FROM journal_images WHERE user_id = ?').all(userId) as ImageRow[];
    }

    for (const row of serverImages) {
      if (!processedImageIds.has(row.id)) {
        responseImages.push(rowToImage(row));
      }
    }
  });

  syncTransaction();

  return {
    entries: responseEntries,
    images: responseImages,
    serverTimestamp: new Date().toISOString(),
    conflicts,
  };
}
