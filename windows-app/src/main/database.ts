import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import * as mediaStore from './mediaStore.js';
import type { JournalEntry, JournalMedia, MediaKind, MediaRecord } from '../shared/types.js';

// ─── Database Setup ──────────────────────────────────────────

const DB_PATH = path.join(app.getPath('userData'), 'local_journals.db');

// Ensure directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS journals (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    journal_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    synced INTEGER NOT NULL DEFAULT 0,
    last_synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS journal_images (
    id TEXT PRIMARY KEY,
    journal_id TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT '',
    deleted INTEGER NOT NULL DEFAULT 0,
    synced INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS journal_media (
    id TEXT PRIMARY KEY,
    journal_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'image',
    mime TEXT NOT NULL DEFAULT 'application/octet-stream',
    bytes INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    synced INTEGER NOT NULL DEFAULT 0,
    uploaded INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_journals_updated ON journals(updated_at);
  CREATE INDEX IF NOT EXISTS idx_journals_synced ON journals(synced);
  CREATE INDEX IF NOT EXISTS idx_images_journal ON journal_images(journal_id);
  CREATE INDEX IF NOT EXISTS idx_media_journal ON journal_media(journal_id);
  CREATE INDEX IF NOT EXISTS idx_media_synced ON journal_media(synced);
`);

// ─── Migration: image sync columns ───────────────────────────
// Older installs created journal_images with only (id, journal_id, data,
// created_at). Image bytes now sync (ARCHITECTURE §8), which needs the same
// bookkeeping journals have. Add the columns if they're missing and mark any
// pre-existing local images as pending so they upload to the server once.
{
  const cols = db.prepare('PRAGMA table_info(journal_images)').all() as { name: string }[];
  const has = (name: string) => cols.some((c) => c.name === name);
  if (!has('updated_at')) db.exec("ALTER TABLE journal_images ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
  if (!has('deleted')) db.exec('ALTER TABLE journal_images ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0');
  if (!has('synced')) db.exec('ALTER TABLE journal_images ADD COLUMN synced INTEGER NOT NULL DEFAULT 0');
  // Backfill updated_at for legacy rows; leaving synced=0 queues them to upload.
  db.exec("UPDATE journal_images SET updated_at = created_at WHERE updated_at = '' OR updated_at IS NULL");
  // Index the sync column here rather than in the schema block above: on an
  // upgrade the legacy table survives CREATE TABLE IF NOT EXISTS, so indexing
  // `synced` before the ALTER runs would throw and take the app down at launch.
  db.exec('CREATE INDEX IF NOT EXISTS idx_images_synced ON journal_images(synced)');
}

console.log(`[database] Local DB initialized at ${DB_PATH}`);

// ─── Journal Row Type ────────────────────────────────────────

interface JournalRow {
  id: string;
  title: string;
  content: string;
  journal_date: string;
  created_at: string;
  updated_at: string;
  deleted: number;
  synced: number;
  last_synced_at: string | null;
}

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

// ─── Journal CRUD ────────────────────────────────────────────

export function getAllJournals(): JournalEntry[] {
  const rows = db.prepare(
    'SELECT * FROM journals WHERE deleted = 0 ORDER BY journal_date DESC'
  ).all() as JournalRow[];
  return rows.map(rowToEntry);
}

export function getJournalById(id: string): JournalEntry | null {
  const row = db.prepare('SELECT * FROM journals WHERE id = ?').get(id) as JournalRow | undefined;
  return row ? rowToEntry(row) : null;
}

export function createJournal(entry: {
  title: string;
  content: string;
  journal_date: string;
}): JournalEntry {
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO journals (id, title, content, journal_date, created_at, updated_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  ).run(id, entry.title, entry.content, entry.journal_date, now, now);

  return getJournalById(id)!;
}

export function updateJournal(id: string, updates: Partial<JournalEntry>): JournalEntry {
  const existing = db.prepare('SELECT * FROM journals WHERE id = ?').get(id) as JournalRow | undefined;
  if (!existing) throw new Error(`Journal ${id} not found`);

  const now = new Date().toISOString();
  const title = updates.title ?? existing.title;
  const content = updates.content ?? existing.content;
  const journal_date = updates.journal_date ?? existing.journal_date;
  const updated_at = updates.updated_at ?? now;

  db.prepare(
    `UPDATE journals SET title = ?, content = ?, journal_date = ?, updated_at = ?, synced = 0
     WHERE id = ?`
  ).run(title, content, journal_date, updated_at, id);

  return getJournalById(id)!;
}

export function deleteJournal(id: string): void {
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE journals SET deleted = 1, updated_at = ?, synced = 0 WHERE id = ?'
  ).run(now, id);
}

// ─── Sync Helpers ────────────────────────────────────────────

export function getPendingSyncEntries(): JournalEntry[] {
  const rows = db.prepare(
    'SELECT * FROM journals WHERE synced = 0'
  ).all() as JournalRow[];
  return rows.map(rowToEntry);
}

export function getPendingSyncCount(): number {
  const result = db.prepare('SELECT COUNT(*) as count FROM journals WHERE synced = 0').get() as { count: number };
  return result.count;
}

export function upsertFromServer(entry: JournalEntry): void {
  const existing = db.prepare('SELECT id FROM journals WHERE id = ?').get(entry.id);
  const now = new Date().toISOString();

  if (existing) {
    db.prepare(
      `UPDATE journals SET title = ?, content = ?, journal_date = ?,
       created_at = ?, updated_at = ?, deleted = ?, synced = 1, last_synced_at = ?
       WHERE id = ?`
    ).run(
      entry.title, entry.content, entry.journal_date,
      entry.created_at, entry.updated_at, entry.deleted ? 1 : 0, now,
      entry.id
    );
  } else {
    db.prepare(
      `INSERT INTO journals (id, title, content, journal_date, created_at, updated_at, deleted, synced, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      entry.id, entry.title, entry.content, entry.journal_date,
      entry.created_at, entry.updated_at, entry.deleted ? 1 : 0, now
    );
  }
}

export function markEntriesSynced(ids: string[]): void {
  const now = new Date().toISOString();
  const stmt = db.prepare('UPDATE journals SET synced = 1, last_synced_at = ? WHERE id = ?');
  const transaction = db.transaction(() => {
    for (const id of ids) {
      stmt.run(now, id);
    }
  });
  transaction();
}

// ─── Media (images + video) ──────────────────────────────────
// Metadata lives here, the bytes live on disk in the media store. That split is
// what lets an entry hold video: nothing base64-encodes a file into SQLite or
// into a sync payload any more (protocol v2 — ARCHITECTURE §8).

interface MediaRow {
  id: string;
  journal_id: string;
  kind: MediaKind;
  mime: string;
  bytes: number;
  sha256: string;
  created_at: string;
  updated_at: string;
  deleted: number;
  /** Has this row's metadata been pushed to the server? */
  synced: number;
  /** Has the server confirmed it holds every byte? */
  uploaded: number;
}

function rowToRecord(row: MediaRow): MediaRecord {
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

// `available` is read from the filesystem rather than a column: the bytes are
// either fully here or they are not, and the file itself is the only honest
// answer to that.
function rowToJournalMedia(row: MediaRow): JournalMedia {
  return {
    id: row.id,
    journal_id: row.journal_id,
    kind: row.kind,
    mime: row.mime,
    bytes: row.bytes,
    url: `journal-media://${row.id}`,
    available: mediaStore.hasComplete(row.id),
    created_at: row.created_at,
  };
}

/** Register a file that has already been copied into the media store. */
export function addMedia(journalId: string, imported: mediaStore.ImportedMedia): JournalMedia {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO journal_media
       (id, journal_id, kind, mime, bytes, sha256, created_at, updated_at, deleted, synced, uploaded)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`
  ).run(imported.id, journalId, imported.kind, imported.mime, imported.bytes, imported.sha256, now, now);
  return rowToJournalMedia(getMediaRow(imported.id)!);
}

export function getMediaRow(id: string): MediaRow | null {
  return (db.prepare('SELECT * FROM journal_media WHERE id = ?').get(id) as MediaRow | undefined) ?? null;
}

export function getMedia(journalId: string): JournalMedia[] {
  const rows = db.prepare(
    'SELECT * FROM journal_media WHERE journal_id = ? AND deleted = 0 ORDER BY created_at ASC'
  ).all(journalId) as MediaRow[];
  return rows.map(rowToJournalMedia);
}

/**
 * Soft delete: keep a tombstone so the removal reaches every device, and drop
 * the local bytes straight away — the user asked for the file to be gone.
 */
export function deleteMedia(id: string): void {
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE journal_media SET deleted = 1, bytes = 0, sha256 = \'\', updated_at = ?, synced = 0 WHERE id = ?'
  ).run(now, id);
  mediaStore.removeLocal(id);
}

// ─── Media sync helpers ──────────────────────────────────────

/** Metadata waiting to be pushed. Small records, so no batching is needed. */
export function getPendingSyncMedia(): MediaRecord[] {
  const rows = db.prepare('SELECT * FROM journal_media WHERE synced = 0 ORDER BY updated_at ASC').all() as MediaRow[];
  return rows.map(rowToRecord);
}

export function markMediaSynced(ids: string[]): void {
  const stmt = db.prepare('UPDATE journal_media SET synced = 1 WHERE id = ?');
  const transaction = db.transaction(() => {
    for (const id of ids) stmt.run(id);
  });
  transaction();
}

export function upsertMediaFromServer(record: MediaRecord): void {
  const existing = getMediaRow(record.id);

  if (existing) {
    db.prepare(
      `UPDATE journal_media
         SET journal_id = ?, kind = ?, mime = ?, bytes = ?, sha256 = ?,
             created_at = ?, updated_at = ?, deleted = ?, synced = 1,
             uploaded = ?
       WHERE id = ?`
    ).run(
      record.journal_id, record.kind, record.mime, record.bytes, record.sha256,
      record.created_at, record.updated_at, record.deleted ? 1 : 0,
      // The server is telling us about this file, so it has the bytes — unless
      // it's a tombstone, where there are none to have.
      record.deleted ? 0 : 1,
      record.id
    );
  } else {
    db.prepare(
      `INSERT INTO journal_media
         (id, journal_id, kind, mime, bytes, sha256, created_at, updated_at, deleted, synced, uploaded)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      record.id, record.journal_id, record.kind, record.mime, record.bytes, record.sha256,
      record.created_at, record.updated_at, record.deleted ? 1 : 0, record.deleted ? 0 : 1
    );
  }

  // Deleted elsewhere — reclaim the space here too.
  if (record.deleted) mediaStore.removeLocal(record.id);
}

/** Files whose bytes this device holds but the server does not yet. */
export function getMediaNeedingUpload(): MediaRecord[] {
  const rows = db.prepare(
    'SELECT * FROM journal_media WHERE deleted = 0 AND uploaded = 0 AND bytes > 0 ORDER BY created_at ASC'
  ).all() as MediaRow[];
  // Only offer files we can actually read in full; a half-downloaded file has
  // nothing to contribute.
  return rows.filter((row) => mediaStore.localBytes(row.id) === row.bytes).map(rowToRecord);
}

/** Files that exist on the server but aren't (fully) on this device yet. */
export function getMediaNeedingDownload(): MediaRecord[] {
  const rows = db.prepare(
    'SELECT * FROM journal_media WHERE deleted = 0 AND bytes > 0 AND uploaded = 1 ORDER BY created_at ASC'
  ).all() as MediaRow[];
  return rows.filter((row) => mediaStore.localBytes(row.id) !== row.bytes).map(rowToRecord);
}

export function markMediaUploaded(id: string): void {
  db.prepare('UPDATE journal_media SET uploaded = 1 WHERE id = ?').run(id);
}

/** Metadata still to push. Counted in the pending badge alongside entries. */
export function getPendingMediaCount(): number {
  const result = db.prepare('SELECT COUNT(*) as count FROM journal_media WHERE synced = 0').get() as { count: number };
  return result.count;
}

/** Files whose bytes still have to move, in either direction. */
export function getPendingTransferCount(): number {
  return getMediaNeedingUpload().length + getMediaNeedingDownload().length;
}

// ─── Migration: v1 base64 images → media store ───────────────
// v1 kept image bytes as base64 text in `journal_images`. Move each one into the
// media store as a file and give it a media row, so old photos and new videos
// are the same kind of thing from here on.
//
// The original rows are left in place: they cost disk, but they are also the
// only copy an older build of the app could read, and destroying them to save
// space is not a trade this migration gets to make on the user's behalf.
function migrateLegacyImagesToMedia(): void {
  const legacy = db.prepare(`
    SELECT i.* FROM journal_images i
    LEFT JOIN journal_media m ON m.id = i.id
    WHERE m.id IS NULL
  `).all() as { id: string; journal_id: string; data: string; created_at: string; updated_at: string; deleted: number }[];

  if (legacy.length === 0) return;

  const insert = db.prepare(
    `INSERT INTO journal_media
       (id, journal_id, kind, mime, bytes, sha256, created_at, updated_at, deleted, synced, uploaded)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`
  );

  let migrated = 0;
  let tombstoned = 0;

  for (const row of legacy) {
    if (row.deleted === 1 || !row.data) {
      insert.run(row.id, row.journal_id, 'image', 'application/octet-stream', 0, '',
        row.created_at, row.updated_at || row.created_at, 1);
      tombstoned++;
      continue;
    }

    const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(row.data);
    if (!match) {
      console.warn(`[media] Legacy image ${row.id} is not a readable data URL — left alone`);
      continue;
    }

    const [, rawMime, isBase64, payload] = match;
    const mime = rawMime || 'application/octet-stream';
    const buf = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
    const sha256 = mediaStore.writeBlobSync(row.id, buf);

    insert.run(row.id, row.journal_id, mediaStore.kindForMime(mime), mime, buf.length, sha256,
      row.created_at, row.updated_at || row.created_at, 0);
    migrated++;
  }

  console.log(
    `[media] Migrated ${migrated} stored image(s) to the media store` +
      (tombstoned > 0 ? `, ${tombstoned} tombstone(s)` : '')
  );
}

migrateLegacyImagesToMedia();

// ─── App Config ──────────────────────────────────────────────

export function getConfig(key: string): string | null {
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setConfig(key: string, value: string): void {
  db.prepare(
    'INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
  ).run(key, value, value);
}

export function getAllConfig(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM app_config').all() as { key: string; value: string }[];
  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.key] = row.value;
  }
  return config;
}

export function closeDatabase(): void {
  db.close();
}
