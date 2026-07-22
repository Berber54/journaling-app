import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import type { JournalEntry } from '../shared/types.js';

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
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_journals_updated ON journals(updated_at);
  CREATE INDEX IF NOT EXISTS idx_journals_synced ON journals(synced);
  CREATE INDEX IF NOT EXISTS idx_images_journal ON journal_images(journal_id);
`);

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

// ─── Journal Images ──────────────────────────────────────────

export interface JournalImage {
  id: string;
  journal_id: string;
  data: string; // data: URL (base64-encoded image)
  created_at: string;
}

export function addImage(journalId: string, data: string): JournalImage {
  const id = uuidv4();
  const created_at = new Date().toISOString();
  db.prepare(
    'INSERT INTO journal_images (id, journal_id, data, created_at) VALUES (?, ?, ?, ?)'
  ).run(id, journalId, data, created_at);
  return { id, journal_id: journalId, data, created_at };
}

export function getImages(journalId: string): JournalImage[] {
  return db.prepare(
    'SELECT id, journal_id, data, created_at FROM journal_images WHERE journal_id = ? ORDER BY created_at ASC'
  ).all(journalId) as JournalImage[];
}

export function deleteImage(id: string): void {
  db.prepare('DELETE FROM journal_images WHERE id = ?').run(id);
}

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
