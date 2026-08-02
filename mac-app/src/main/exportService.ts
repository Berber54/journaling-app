import fsp from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, dialog, shell } from 'electron';
import { getAllJournals, getMedia } from './database.js';
import { renderEntryHtml } from './entryText.js';
import * as mediaStore from './mediaStore.js';
import type {
  ExportOptions,
  ExportResult,
  JournalEntry,
  JournalMedia,
} from '../shared/types.js';

/**
 * Export entries to files on disk.
 *
 * The point of this is to get your journal *out* — as plain files you can hand
 * to an external LLM, drop in another app, or keep as an offline copy. It reads
 * the local SQLite database and the local media store only: no server, no
 * network, and it works while offline.
 *
 * Entry bodies are stored as rich-text HTML (ARCHITECTURE §12), which is not
 * what you want to paste into a model, so `entryText.ts` renders them down to
 * text first. Photos and videos are placeholders in that HTML; their bytes are
 * files in the media store, copied into a `media/` folder when asked for.
 */

// ─── Naming ──────────────────────────────────────────────────

/** Local calendar date of an entry, as `YYYY-MM-DD` — the filename prefix. */
function dateStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'undated';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function longDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Claim a filename, adding `-2`, `-3`… if the stem is already taken. */
function uniqueName(taken: Set<string>, stem: string, ext: string): string {
  let candidate = `${stem}${ext}`;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${stem}-${n}${ext}`;
    n += 1;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/avif': '.avif', 'image/bmp': '.bmp',
  'image/svg+xml': '.svg', 'image/heic': '.heic', 'image/heif': '.heif',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
  'video/ogg': '.ogv', 'video/x-matroska': '.mkv', 'video/x-msvideo': '.avi',
};

function extForMime(mime: string): string {
  return EXT_BY_MIME[mime.toLowerCase()] ?? '.bin';
}

// ─── Rendering one entry ─────────────────────────────────────

/** An attachment as the export sees it: where its bytes are and where they go. */
interface ExportMedia {
  record: JournalMedia;
  /** Path relative to the export root; null when the file was not copied. */
  relPath: string | null;
  /** Wanted, but its bytes haven't reached this device — worth saying out loud. */
  missing: boolean;
}

function renderMarkdown(
  entry: JournalEntry,
  media: Map<string, ExportMedia>,
  heading: string
): string {
  const body = renderEntryHtml(entry.content, {
    markdown: true,
    figure: (id, kind) => {
      const found = id ? media.get(id) : undefined;
      const label = kind === 'video' ? 'Video' : 'Photo';
      if (found?.missing) return `_[${label} — not downloaded to this device]_`;
      if (!found?.relPath) return `_[${label}]_`;
      const url = encodeURI(found.relPath);
      return kind === 'video' ? `[${label}](${url})` : `![${label}](${url})`;
    },
  });

  return [
    `${heading} ${entry.title || 'Untitled'}`,
    '',
    `*${longDate(entry.journal_date)}*`,
    '',
    body || '_(empty entry)_',
    '',
  ].join('\n');
}

function renderPlainText(entry: JournalEntry, media: Map<string, ExportMedia>): string {
  const body = renderEntryHtml(entry.content, {
    markdown: false,
    figure: (id, kind) => {
      const found = id ? media.get(id) : undefined;
      const label = kind === 'video' ? 'video' : 'photo';
      if (found?.missing) return `[${label}: not downloaded to this device]`;
      if (!found?.relPath) return `[${label}]`;
      return `[${label}: ${found.relPath}]`;
    },
  });

  return [
    entry.title || 'Untitled',
    longDate(entry.journal_date),
    '',
    body || '(empty entry)',
    '',
  ].join('\n');
}

function renderJson(entry: JournalEntry, media: Map<string, ExportMedia>): Record<string, unknown> {
  return {
    id: entry.id,
    title: entry.title || 'Untitled',
    date: entry.journal_date,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    // Plain text first: it is what a model should read. The original HTML is
    // kept alongside it so nothing about the entry is lost in the export.
    text: renderEntryHtml(entry.content, {
      markdown: false,
      figure: (_id, kind) => `[${kind === 'video' ? 'video' : 'photo'}]`,
    }),
    html: entry.content,
    media: [...media.values()]
      .filter((m) => m.record.journal_id === entry.id)
      .map((m) => ({
        id: m.record.id,
        kind: m.record.kind,
        mime: m.record.mime,
        bytes: m.record.bytes,
        file: m.relPath,
      })),
  };
}

// ─── The export itself ───────────────────────────────────────

const FORMAT_EXT = { markdown: '.md', text: '.txt', json: '.json' } as const;

export async function exportJournals(
  parent: BrowserWindow | null,
  options: ExportOptions
): Promise<ExportResult> {
  const empty: ExportResult = {
    canceled: true, path: '', entryCount: 0, fileCount: 0, missingMediaCount: 0,
  };

  // Oldest first: a journal read start-to-finish makes more sense that way, and
  // it is the order a model should see when asked about change over time.
  const wanted = options.ids === null ? null : new Set(options.ids);
  const entries = getAllJournals()
    .filter((e) => !e.deleted && (wanted === null || wanted.has(e.id)))
    .sort((a, b) => new Date(a.journal_date).getTime() - new Date(b.journal_date).getTime());

  if (entries.length === 0) {
    throw new Error('No entries selected to export.');
  }

  const ext = FORMAT_EXT[options.format];
  const stamp = timeStamp(new Date());
  const singleFile = options.layout === 'single' && !options.includeMedia;

  // One file and no attachments is a plain "save as". Anything else produces a
  // directory of files, so the user picks a place to put that directory.
  let root: string;
  let singleFilePath = '';
  if (singleFile) {
    const result = await showSave(parent, `journal-export-${stamp}${ext}`, options.format);
    if (result === null) return empty;
    singleFilePath = result;
    root = path.dirname(result);
  } else {
    const parentDir = await showFolder(parent);
    if (parentDir === null) return empty;
    root = path.join(parentDir, `journal-export-${stamp}`);
    await fsp.mkdir(root, { recursive: true });
  }

  // ── Attachments ──
  // Resolved before any text is written: the rendered placeholders have to name
  // the files that actually made it into the export.
  const media = new Map<string, ExportMedia>();
  let missingMediaCount = 0;
  const mediaNames = new Set<string>();

  for (const entry of entries) {
    for (const record of getMedia(entry.id)) {
      if (!options.includeMedia) {
        // Not asked for, so not missing — the placeholder just says a photo was
        // here, without implying something went wrong.
        media.set(record.id, { record, relPath: null, missing: false });
        continue;
      }
      if (!record.available) {
        // Added on another device and not synced down yet — there is nothing on
        // this disk to copy, so say so instead of writing a dead link.
        media.set(record.id, { record, relPath: null, missing: true });
        missingMediaCount += 1;
        continue;
      }
      const stem = `${dateStamp(entry.journal_date)}-${slugify(entry.title) || 'untitled'}`;
      const name = uniqueName(mediaNames, stem, extForMime(record.mime));
      media.set(record.id, { record, relPath: `media/${name}`, missing: false });
    }
  }

  if (options.includeMedia) {
    const mediaDir = path.join(root, 'media');
    await fsp.mkdir(mediaDir, { recursive: true });
    for (const { record, relPath } of media.values()) {
      if (!relPath) continue;
      await fsp.copyFile(mediaStore.finalPath(record.id), path.join(root, relPath));
    }
  }

  // ── Text ──
  let fileCount = 0;

  if (options.layout === 'single') {
    const target = singleFile ? singleFilePath : path.join(root, `journal-export-${stamp}${ext}`);
    await fsp.writeFile(target, buildBundle(entries, media, options.format), 'utf8');
    fileCount = 1;
    return {
      canceled: false,
      path: singleFile ? target : root,
      entryCount: entries.length,
      fileCount,
      missingMediaCount,
    };
  }

  const names = new Set<string>();
  for (const entry of entries) {
    const stem = `${dateStamp(entry.journal_date)}-${slugify(entry.title) || 'untitled'}`;
    const name = uniqueName(names, stem, ext);
    const body =
      options.format === 'json'
        ? JSON.stringify(renderJson(entry, media), null, 2)
        : options.format === 'markdown'
          ? renderMarkdown(entry, media, '#')
          : renderPlainText(entry, media);
    await fsp.writeFile(path.join(root, name), body, 'utf8');
    fileCount += 1;
  }

  return { canceled: false, path: root, entryCount: entries.length, fileCount, missingMediaCount };
}

/** Every entry in one file, oldest first, with a short header saying what it is. */
function buildBundle(
  entries: JournalEntry[],
  media: Map<string, ExportMedia>,
  format: ExportOptions['format']
): string {
  if (format === 'json') {
    return JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        entry_count: entries.length,
        entries: entries.map((e) => renderJson(e, media)),
      },
      null,
      2
    );
  }

  const span =
    entries.length === 1
      ? dateStamp(entries[0].journal_date)
      : `${dateStamp(entries[0].journal_date)} to ${dateStamp(entries[entries.length - 1].journal_date)}`;

  if (format === 'markdown') {
    const header = `# Journal export\n\n${entries.length} ${
      entries.length === 1 ? 'entry' : 'entries'
    }, ${span}, oldest first.\n`;
    return [header, ...entries.map((e) => renderMarkdown(e, media, '##'))].join('\n---\n\n');
  }

  const rule = '='.repeat(60);
  const header = `JOURNAL EXPORT\n${entries.length} ${
    entries.length === 1 ? 'entry' : 'entries'
  }, ${span}, oldest first.\n`;
  return [header, ...entries.map((e) => renderPlainText(e, media))].join(`\n${rule}\n\n`);
}

// ─── Dialogs ─────────────────────────────────────────────────

async function showSave(
  parent: BrowserWindow | null,
  defaultName: string,
  format: ExportOptions['format']
): Promise<string | null> {
  const filters =
    format === 'markdown'
      ? [{ name: 'Markdown', extensions: ['md'] }]
      : format === 'json'
        ? [{ name: 'JSON', extensions: ['json'] }]
        : [{ name: 'Text', extensions: ['txt'] }];

  const result = parent
    ? await dialog.showSaveDialog(parent, { defaultPath: defaultName, filters })
    : await dialog.showSaveDialog({ defaultPath: defaultName, filters });

  return result.canceled || !result.filePath ? null : result.filePath;
}

async function showFolder(parent: BrowserWindow | null): Promise<string | null> {
  const opts: Electron.OpenDialogOptions = {
    title: 'Choose where to put the export folder',
    buttonLabel: 'Export here',
    properties: ['openDirectory', 'createDirectory'],
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, opts)
    : await dialog.showOpenDialog(opts);

  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
}

/** Show a finished export in the OS file manager. */
export function revealExport(target: string): void {
  if (target) shell.showItemInFolder(target);
}
