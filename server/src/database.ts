import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db: Database.Database = new Database(config.dbPath);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS journals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    journal_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_journals_user_id ON journals(user_id);
  CREATE INDEX IF NOT EXISTS idx_journals_updated_at ON journals(updated_at);
  CREATE INDEX IF NOT EXISTS idx_journals_user_updated ON journals(user_id, updated_at);

  -- Image bytes (base64 data URLs). Mirrors the client's journal_images table
  -- but scoped by user_id so images sync across all of an account's devices.
  -- Uses the same sync bookkeeping as journals: updated_at is the LWW clock and
  -- deleted=1 is a tombstone (with the bytes cleared) so removals propagate.
  CREATE TABLE IF NOT EXISTS journal_images (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    journal_id TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_images_user_updated ON journal_images(user_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_images_journal ON journal_images(journal_id);

  -- Media metadata (protocol v2). The bytes live on disk under config.mediaPath,
  -- never in this database and never inside a sync payload — that is what lets
  -- an entry carry video. Rows sync with the same last-write-wins bookkeeping as
  -- journals: updated_at is the clock, deleted=1 is a tombstone.
  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    journal_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'image',
    mime TEXT NOT NULL DEFAULT 'application/octet-stream',
    bytes INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_media_user_updated ON media(user_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_media_journal ON media(journal_id);
`);

console.log(`[database] Connected to SQLite at ${config.dbPath}`);
console.log('[database] WAL mode enabled, busy_timeout=5000ms');

export default db;
