import db from '../database.js';
import type {
  ConflictRecord,
  ImageRow,
  JournalEntry,
  JournalRow,
  MediaRecord,
  MediaRow,
  SyncImage,
  SyncRequest,
  SyncResponse,
} from '../shared/types.js';
import { kindForMime, removeBlob, writeBlob } from './mediaService.js';

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

function rowToMedia(row: MediaRow): MediaRecord {
  return {
    id: row.id,
    journal_id: row.journal_id,
    kind: row.kind,
    mime: row.mime,
    bytes: row.bytes,
    sha256: row.sha256,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted: row.deleted === 1,
  };
}

/** `data:image/png;base64,AAAA…` → mime + bytes. */
function parseDataUrl(data: string): { mime: string; buf: Buffer } | null {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(data);
  if (!match) return null;
  const [, rawMime, isBase64, payload] = match;
  try {
    const buf = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
    return buf.length > 0 ? { mime: rawMime || 'application/octet-stream', buf } : null;
  } catch {
    return null;
  }
}

/**
 * A v1 client still inlines image bytes in the sync payload. Rather than let
 * those photos exist only in the old table, write them into the blob store too
 * so v2 devices see them like any other media.
 */
async function adoptLegacyImages(userId: string, images: SyncImage[]): Promise<MediaRecord[]> {
  const adopted: MediaRecord[] = [];

  for (const image of images) {
    const existing = db.prepare('SELECT id FROM media WHERE id = ? AND user_id = ?').get(image.id, userId);
    if (existing) continue;

    if (image.deleted || !image.data) {
      adopted.push({
        id: image.id,
        journal_id: image.journal_id,
        kind: 'image',
        mime: 'application/octet-stream',
        bytes: 0,
        sha256: '',
        created_at: image.created_at,
        updated_at: image.updated_at,
        deleted: true,
      });
      continue;
    }

    const parsed = parseDataUrl(image.data);
    if (!parsed) continue;

    const sha256 = await writeBlob(userId, image.id, parsed.buf);
    adopted.push({
      id: image.id,
      journal_id: image.journal_id,
      kind: kindForMime(parsed.mime),
      mime: parsed.mime,
      bytes: parsed.buf.length,
      sha256,
      created_at: image.created_at,
      updated_at: image.updated_at,
      deleted: false,
    });
  }

  return adopted;
}

export async function processSync(userId: string, syncRequest: SyncRequest): Promise<SyncResponse> {
  const responseEntries: JournalEntry[] = [];
  const responseImages: SyncImage[] = [];
  const responseMedia: MediaRecord[] = [];
  const conflicts: ConflictRecord[] = [];
  const processedIds = new Set<string>();
  const processedImageIds = new Set<string>();
  const processedMediaIds = new Set<string>();

  // A client that sends a `media` field speaks v2 — even an empty one. A v1
  // client only ever sends `images`, and is answered in kind.
  const clientSpeaksV2 = syncRequest.media !== undefined;

  // Blob writes and deletes are file I/O, so they happen outside the SQLite
  // transaction: gathered here, applied once the metadata has committed.
  const staleBlobs = new Set<string>();
  const legacyMedia = await adoptLegacyImages(userId, syncRequest.images ?? []);
  const clientMedia = [...legacyMedia, ...(syncRequest.media ?? [])];

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

    // Only a v1 client gets base64 image bytes back. Sending them to a v2
    // client would duplicate media it already has records for — and re-inflate
    // the payload that moving bytes out of JSON was meant to fix.
    if (!clientSpeaksV2) {
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
    }

    // ─── Media (v2) ──────────────────────────────────────────
    // Metadata only — the bytes move over /api/media. Same last-write-wins
    // reconciliation as journals, keyed on updated_at.
    for (const clientItem of clientMedia) {
      processedMediaIds.add(clientItem.id);

      const serverItem = db
        .prepare('SELECT * FROM media WHERE id = ? AND user_id = ?')
        .get(clientItem.id, userId) as MediaRow | undefined;

      if (serverItem) {
        const clientTime = new Date(clientItem.updated_at).getTime();
        const serverTime = new Date(serverItem.updated_at).getTime();

        if (clientTime > serverTime) {
          db.prepare(
            `UPDATE media
             SET journal_id = ?, kind = ?, mime = ?, bytes = ?, sha256 = ?,
                 created_at = ?, updated_at = ?, deleted = ?
             WHERE id = ? AND user_id = ?`
          ).run(
            clientItem.journal_id,
            clientItem.kind,
            clientItem.mime,
            clientItem.bytes,
            clientItem.sha256,
            clientItem.created_at,
            clientItem.updated_at,
            clientItem.deleted ? 1 : 0,
            clientItem.id,
            userId
          );

          // Either the file was deleted, or it now describes different bytes.
          // Both make whatever is on disk wrong, so it goes and the client
          // re-uploads against the new checksum.
          if (clientItem.deleted || clientItem.sha256 !== serverItem.sha256) {
            staleBlobs.add(clientItem.id);
          }
        } else if (serverTime > clientTime) {
          responseMedia.push(rowToMedia(serverItem));
        }
      } else {
        db.prepare(
          `INSERT INTO media (id, user_id, journal_id, kind, mime, bytes, sha256, created_at, updated_at, deleted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          clientItem.id,
          userId,
          clientItem.journal_id,
          clientItem.kind,
          clientItem.mime,
          clientItem.bytes,
          clientItem.sha256,
          clientItem.created_at,
          clientItem.updated_at,
          clientItem.deleted ? 1 : 0
        );
      }
    }

    let serverMedia: MediaRow[];
    if (syncRequest.lastSyncTimestamp) {
      serverMedia = db
        .prepare('SELECT * FROM media WHERE user_id = ? AND updated_at > ?')
        .all(userId, syncRequest.lastSyncTimestamp) as MediaRow[];
    } else {
      serverMedia = db.prepare('SELECT * FROM media WHERE user_id = ?').all(userId) as MediaRow[];
    }

    for (const row of serverMedia) {
      if (!processedMediaIds.has(row.id)) {
        responseMedia.push(rowToMedia(row));
      }
    }
  });

  syncTransaction();

  // Metadata has committed; now discard bytes nothing points at any more.
  for (const id of staleBlobs) {
    await removeBlob(userId, id);
  }

  return {
    entries: responseEntries,
    // A v2 server never sends image bytes back. A v1 client keeps its own copies
    // and its pushes are still accepted (adopted into media above) — it simply
    // won't learn about media added elsewhere until it upgrades.
    images: responseImages,
    media: responseMedia,
    serverTimestamp: new Date().toISOString(),
    conflicts,
  };
}
