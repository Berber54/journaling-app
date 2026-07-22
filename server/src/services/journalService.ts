import { z } from 'zod';
import db from '../database.js';
import { AppError } from '../middleware/errorHandler.js';
import type { JournalEntry, JournalRow } from '../shared/types.js';

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

export function getAllJournals(userId: string, since?: string): JournalEntry[] {
  let rows: JournalRow[];

  if (since) {
    rows = db
      .prepare('SELECT * FROM journals WHERE user_id = ? AND updated_at > ? ORDER BY journal_date DESC')
      .all(userId, since) as JournalRow[];
  } else {
    rows = db.prepare('SELECT * FROM journals WHERE user_id = ? ORDER BY journal_date DESC').all(userId) as JournalRow[];
  }

  return rows.map(rowToEntry);
}

export function getJournalById(userId: string, id: string): JournalEntry {
  const row = db.prepare('SELECT * FROM journals WHERE id = ? AND user_id = ?').get(id, userId) as
    | JournalRow
    | undefined;

  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'Journal not found');
  }

  return rowToEntry(row);
}

export function createJournal(userId: string, entry: z.infer<typeof createJournalSchema>): JournalEntry {
  const parsed = createJournalSchema.parse(entry);

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

export function updateJournal(
  userId: string,
  id: string,
  updates: z.infer<typeof updateJournalSchema>
): JournalEntry {
  const parsed = updateJournalSchema.parse(updates);

  const existing = db.prepare('SELECT id FROM journals WHERE id = ? AND user_id = ?').get(id, userId);
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Journal not found');
  }

  const setClauses: string[] = [];
  const values: string[] = [];

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

  setClauses.push('updated_at = ?');
  values.push(parsed.updated_at, id, userId);

  db.prepare(`UPDATE journals SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);

  return getJournalById(userId, id);
}

export function deleteJournal(userId: string, id: string): { id: string; deleted: boolean; updated_at: string } {
  const existing = db.prepare('SELECT id FROM journals WHERE id = ? AND user_id = ?').get(id, userId);
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', 'Journal not found');
  }

  const now = new Date().toISOString();

  db.prepare('UPDATE journals SET deleted = 1, updated_at = ? WHERE id = ? AND user_id = ?').run(now, id, userId);

  return { id, deleted: true, updated_at: now };
}
