import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { app } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import type { MediaKind } from '../shared/types.js';

/**
 * Local store for photo and video bytes.
 *
 * Files live in `userData/media/<id>`, with `<id>.part` for one that is still
 * downloading. A file only takes its final name once every byte is present and
 * its sha256 matches, so anything at a final path is whole — the editor can
 * point an <img> or <video> straight at it without checking.
 *
 * This is why an entry can hold video at all: bytes stay on disk and stream,
 * instead of becoming a base64 string in SQLite and then in a JSON payload.
 */

const MEDIA_DIR = path.join(app.getPath('userData'), 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

export function mediaDir(): string {
  return MEDIA_DIR;
}

export function finalPath(id: string): string {
  return path.join(MEDIA_DIR, id);
}

export function partPath(id: string): string {
  return path.join(MEDIA_DIR, `${id}.part`);
}

function sizeOf(file: string): number {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

/** Size of the finished file, or 0 if it isn't here (yet). */
export function localBytes(id: string): number {
  return sizeOf(finalPath(id));
}

/** How much of a partial download is on disk — the resume cursor. */
export function partialBytes(id: string): number {
  return sizeOf(partPath(id));
}

export function hasComplete(id: string): boolean {
  return localBytes(id) > 0;
}

// ─── Types ───────────────────────────────────────────────────

// Only formats Chromium can actually display or play are worth mapping; see
// ARCHITECTURE §12.4 for the ones it can't (HEIC, most .avi/.mkv codecs).
const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
};

export function mimeForPath(file: string): string {
  return MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export function kindForMime(mime: string): MediaKind {
  return mime.toLowerCase().startsWith('video/') ? 'video' : 'image';
}

// ─── Adding a local file ─────────────────────────────────────

export interface ImportedMedia {
  id: string;
  mime: string;
  kind: MediaKind;
  bytes: number;
  sha256: string;
}

/**
 * Copy a file the user picked into the store, hashing it on the way through so
 * a multi-gigabyte video is never held in memory.
 */
export async function importFile(sourcePath: string): Promise<ImportedMedia> {
  const id = uuidv4();
  const mime = mimeForPath(sourcePath);
  const hash = crypto.createHash('sha256');

  const hasher = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  const part = partPath(id);
  try {
    await pipeline(fs.createReadStream(sourcePath), hasher, fs.createWriteStream(part));
  } catch (err) {
    await fsp.rm(part, { force: true });
    throw err;
  }

  const bytes = sizeOf(part);
  await fsp.rename(part, finalPath(id));

  return { id, mime, kind: kindForMime(mime), bytes, sha256: hash.digest('hex') };
}

/** Store bytes already in memory — used to migrate v1 base64 images. */
export function writeBlobSync(id: string, data: Buffer): string {
  const part = partPath(id);
  fs.writeFileSync(part, data);
  fs.renameSync(part, finalPath(id));
  return crypto.createHash('sha256').update(data).digest('hex');
}

// ─── Downloading ─────────────────────────────────────────────

/** Append a downloaded chunk to the partial file; returns the new size. */
export async function appendPart(id: string, body: Readable): Promise<number> {
  const part = partPath(id);
  await pipeline(body, fs.createWriteStream(part, { flags: 'a' }));
  return sizeOf(part);
}

/**
 * Verify a completed download and move it into place. A checksum mismatch
 * throws the bytes away rather than keeping a file that looks valid but isn't.
 */
export async function finishPart(id: string, expectedSha256: string): Promise<boolean> {
  const part = partPath(id);
  if (expectedSha256) {
    const actual = await sha256File(part);
    if (actual !== expectedSha256) {
      await fsp.rm(part, { force: true });
      return false;
    }
  }
  await fsp.rename(part, finalPath(id));
  return true;
}

export async function discardPart(id: string): Promise<void> {
  await fsp.rm(partPath(id), { force: true });
}

export function removeLocal(id: string): void {
  fs.rmSync(finalPath(id), { force: true });
  fs.rmSync(partPath(id), { force: true });
}

export async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

// ─── Reading ─────────────────────────────────────────────────

/** A byte range of a finished file — how the editor streams video. */
export function openRead(id: string, start?: number, end?: number): fs.ReadStream {
  return fs.createReadStream(finalPath(id), { start, end });
}
