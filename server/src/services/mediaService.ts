import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import db from '../database.js';
import { config } from '../config.js';
import type { MediaKind, MediaRow, MediaStatus } from '../shared/types.js';

/**
 * On-disk store for photo and video bytes.
 *
 * Layout: `<mediaPath>/<user_id>/<media_id>` for a finished file and
 * `<media_id>.part` while one is still arriving. A partial upload is only
 * renamed into place once every declared byte is present *and* the sha256
 * matches, so any file sitting at its final name is whole and verified — which
 * is what makes `GET /api/media/:id` safe to serve without further checks.
 *
 * Nothing here ever reads a whole file into memory; everything is streamed.
 */

function userDir(userId: string): string {
  return path.join(config.mediaPath, userId);
}

export function blobPath(userId: string, id: string): string {
  return path.join(userDir(userId), id);
}

export function partPath(userId: string, id: string): string {
  return path.join(userDir(userId), `${id}.part`);
}

async function ensureUserDir(userId: string): Promise<void> {
  await fsp.mkdir(userDir(userId), { recursive: true });
}

async function sizeOf(file: string): Promise<number | null> {
  try {
    const stat = await fsp.stat(file);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

// ─── Rows ────────────────────────────────────────────────────

export function getMediaRow(id: string, userId: string): MediaRow | undefined {
  return db.prepare('SELECT * FROM media WHERE id = ? AND user_id = ?').get(id, userId) as MediaRow | undefined;
}

/** Kind implied by a content type — the only two things an entry can hold. */
export function kindForMime(mime: string): MediaKind {
  return mime.toLowerCase().startsWith('video/') ? 'video' : 'image';
}

// ─── Transfer state ──────────────────────────────────────────

/**
 * How much of `row` is on disk. `complete` means the finished file is present,
 * so a client can download it; anything less is a resume cursor for uploading.
 */
export async function readStatus(row: MediaRow): Promise<MediaStatus> {
  const finished = await sizeOf(blobPath(row.user_id, row.id));
  if (finished !== null) {
    return { id: row.id, bytes: row.bytes, uploaded: finished, complete: true };
  }
  const partial = await sizeOf(partPath(row.user_id, row.id));
  return { id: row.id, bytes: row.bytes, uploaded: partial ?? 0, complete: false };
}

// One upload at a time per media id. Two clients appending to the same part
// file would interleave their chunks and produce a corrupt blob that only the
// final sha256 check would catch — after wasting the whole transfer.
const uploadsInFlight = new Set<string>();

export function isUploading(id: string): boolean {
  return uploadsInFlight.has(id);
}

export class MediaTransferError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly status?: MediaStatus
  ) {
    super(message);
    this.name = 'MediaTransferError';
  }
}

/**
 * Append a chunk at `offset`, then finish the file if it is now complete.
 *
 * `offset` must equal what the server already holds; a mismatch means the
 * client's idea of the cursor is stale, so it is told the real one rather than
 * being allowed to write a hole into the middle of a video.
 */
export async function appendChunk(row: MediaRow, offset: number, body: Readable): Promise<MediaStatus> {
  if (row.bytes > config.maxMediaBytes) {
    throw new MediaTransferError(
      413,
      'MEDIA_TOO_LARGE',
      `File is ${row.bytes} bytes; this server accepts at most ${config.maxMediaBytes}`
    );
  }
  if (uploadsInFlight.has(row.id)) {
    throw new MediaTransferError(409, 'UPLOAD_IN_FLIGHT', 'Another upload for this file is in progress');
  }

  uploadsInFlight.add(row.id);
  try {
    await ensureUserDir(row.user_id);
    const current = await readStatus(row);

    // Already have it — a client retrying after a lost response, which is the
    // normal outcome of a connection dropping at the very end of a transfer.
    if (current.complete) return current;

    if (offset !== current.uploaded) {
      throw new MediaTransferError(
        409,
        'OFFSET_MISMATCH',
        `Expected offset ${current.uploaded}, got ${offset}`,
        current
      );
    }

    const part = partPath(row.user_id, row.id);
    // Cap the write at the declared size so a client can't grow a file
    // unbounded past the length its metadata (and sha256) promised.
    const remaining = row.bytes - current.uploaded;
    let written = 0;
    let overflowed = false;

    const sink = fs.createWriteStream(part, { flags: current.uploaded === 0 ? 'w' : 'a' });
    const limiter = async function* () {
      for await (const chunk of body) {
        const buf = chunk as Buffer;
        if (written + buf.length > remaining) {
          overflowed = true;
          const keep = remaining - written;
          if (keep > 0) {
            written += keep;
            yield buf.subarray(0, keep);
          }
          break;
        }
        written += buf.length;
        yield buf;
      }
    };

    await pipeline(limiter, sink);

    if (overflowed) {
      throw new MediaTransferError(
        400,
        'MEDIA_OVERFLOW',
        `Upload exceeds the declared size of ${row.bytes} bytes`,
        await readStatus(row)
      );
    }

    const after = await readStatus(row);
    if (after.uploaded < row.bytes) return after;

    return await finalize(row);
  } finally {
    uploadsInFlight.delete(row.id);
  }
}

/**
 * Verify a fully-received part file and move it to its final name. A checksum
 * mismatch throws away the bytes and resets the cursor to zero: a corrupt blob
 * is worse than a missing one, because it would sync everywhere looking valid.
 */
async function finalize(row: MediaRow): Promise<MediaStatus> {
  const part = partPath(row.user_id, row.id);
  const digest = await sha256File(part);

  if (row.sha256 && digest !== row.sha256) {
    await fsp.rm(part, { force: true });
    throw new MediaTransferError(
      422,
      'CHECKSUM_MISMATCH',
      `Received bytes hash to ${digest}, expected ${row.sha256}`,
      { id: row.id, bytes: row.bytes, uploaded: 0, complete: false }
    );
  }

  await fsp.rename(part, blobPath(row.user_id, row.id));

  // A row created by a legacy client may not have carried a checksum; record
  // the one we computed so later transfers can be verified against it.
  if (!row.sha256) {
    db.prepare('UPDATE media SET sha256 = ? WHERE id = ? AND user_id = ?').run(digest, row.id, row.user_id);
  }

  return { id: row.id, bytes: row.bytes, uploaded: row.bytes, complete: true };
}

export async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

export function sha256Buffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ─── Reading ─────────────────────────────────────────────────

/** A byte range of a finished blob, as a stream. */
export function openBlob(row: MediaRow, start: number, end: number): fs.ReadStream {
  return fs.createReadStream(blobPath(row.user_id, row.id), { start, end });
}

// ─── Writing whole files (migration + legacy clients) ────────

/** Store bytes we already hold in memory, e.g. a decoded base64 image. */
export async function writeBlob(userId: string, id: string, data: Buffer): Promise<string> {
  await ensureUserDir(userId);
  const part = partPath(userId, id);
  await fsp.writeFile(part, data);
  await fsp.rename(part, blobPath(userId, id));
  return sha256Buffer(data);
}

/** Drop the bytes for a tombstoned or replaced file. */
export async function removeBlob(userId: string, id: string): Promise<void> {
  await Promise.all([
    fsp.rm(blobPath(userId, id), { force: true }),
    fsp.rm(partPath(userId, id), { force: true }),
  ]);
}
