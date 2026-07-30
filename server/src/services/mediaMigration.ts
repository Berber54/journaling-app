import db from '../database.js';
import type { ImageRow } from '../shared/types.js';
import { kindForMime, writeBlob } from './mediaService.js';

/**
 * One-time lift of v1 image rows (base64 text in SQLite) into v2 media rows
 * (metadata here, bytes on disk).
 *
 * The original `journal_images` rows are deliberately left untouched. Clearing
 * them would halve the database, but a v1 client that pulled a row with empty
 * bytes would overwrite the copy it still holds locally — destroying photos on
 * an old device to save space here. See ARCHITECTURE §8.8 for the manual
 * reclaim once every device is on v2.
 */

/** `data:image/png;base64,AAAA…` → mime + bytes. */
function parseDataUrl(data: string): { mime: string; buf: Buffer } | null {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(data);
  if (!match) return null;

  const [, rawMime, isBase64, payload] = match;
  const mime = rawMime || 'application/octet-stream';
  try {
    const buf = isBase64
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
    return buf.length > 0 ? { mime, buf } : null;
  } catch {
    return null;
  }
}

export async function migrateLegacyImages(): Promise<void> {
  const pending = db.prepare(`
    SELECT i.* FROM journal_images i
    LEFT JOIN media m ON m.id = i.id
    WHERE m.id IS NULL
  `).all() as ImageRow[];

  if (pending.length === 0) return;

  const insert = db.prepare(
    `INSERT INTO media (id, user_id, journal_id, kind, mime, bytes, sha256, created_at, updated_at, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // Migrated rows are stamped with the migration time rather than the image's
  // original updated_at. A device that already synced past that original
  // timestamp would otherwise never be told these files exist — and a device
  // that does already hold the bytes recognises them by checksum and skips the
  // download, so re-announcing them costs nothing.
  const now = new Date().toISOString();
  let migrated = 0;
  let tombstoned = 0;
  let skipped = 0;

  for (const row of pending) {
    if (row.deleted === 1 || !row.data) {
      insert.run(row.id, row.user_id, row.journal_id, 'image', 'application/octet-stream',
        0, '', row.created_at, now, 1);
      tombstoned++;
      continue;
    }

    const parsed = parseDataUrl(row.data);
    if (!parsed) {
      console.warn(`[media] Skipping image ${row.id}: not a readable data URL`);
      skipped++;
      continue;
    }

    const sha256 = await writeBlob(row.user_id, row.id, parsed.buf);
    insert.run(row.id, row.user_id, row.journal_id, kindForMime(parsed.mime), parsed.mime,
      parsed.buf.length, sha256, row.created_at, now, 0);
    migrated++;
  }

  console.log(
    `[media] Migrated ${migrated} image(s) to on-disk blobs` +
      (tombstoned > 0 ? `, ${tombstoned} tombstone(s)` : '') +
      (skipped > 0 ? `, ${skipped} unreadable and left alone` : '')
  );
}
