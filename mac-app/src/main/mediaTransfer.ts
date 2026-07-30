import fs from 'node:fs';
import { Readable } from 'node:stream';
import {
  getMediaNeedingDownload,
  getMediaNeedingUpload,
  markMediaSynced,
  markMediaUploaded,
} from './database.js';
import * as mediaStore from './mediaStore.js';
import type { MediaRecord, MediaStatus, MediaTransferProgress } from '../shared/types.js';

/**
 * Moving photo and video bytes, resumably.
 *
 * Metadata syncs through /api/sync; this module moves the files themselves over
 * /api/media, a chunk at a time, remembering how far it got. A dropped
 * connection costs one chunk, not the whole transfer — which is the difference
 * between a 900 MB video eventually arriving and it never arriving at all.
 */

// Big enough that per-request overhead is noise, small enough that losing one
// chunk to a dropped connection is cheap, and that memory stays flat.
const CHUNK_BYTES = 8 * 1024 * 1024;

export type ApiFetch = (endpoint: string, options?: RequestInit) => Promise<Response>;
export type ProgressCallback = (progress: MediaTransferProgress | null) => void;

export interface TransferResult {
  uploaded: number;
  downloaded: number;
  /** Files the server will not accept at all — reported, not retried for ever. */
  rejected: string[];
  /** Transfers that failed for a reason worth retrying next sync. */
  deferred: number;
}

// A plain ArrayBuffer-backed Uint8Array, which is what fetch accepts as a body
// (a Node Buffer may sit on a SharedArrayBuffer, which BodyInit rules out).
function readChunk(id: string, offset: number, length: number): Uint8Array<ArrayBuffer> {
  const fd = fs.openSync(mediaStore.finalPath(id), 'r');
  try {
    const buf = Buffer.alloc(length);
    const read = fs.readSync(fd, buf, 0, length, offset);
    const chunk = new Uint8Array(read);
    chunk.set(buf.subarray(0, read));
    return chunk;
  } finally {
    fs.closeSync(fd);
  }
}

// ─── Upload ──────────────────────────────────────────────────

/**
 * Push one file's bytes, starting from whatever the server already holds.
 * Returns 'done', 'rejected' (never going to work) or 'deferred' (try later).
 */
async function uploadOne(
  apiFetch: ApiFetch,
  item: MediaRecord,
  onProgress: ProgressCallback
): Promise<'done' | 'rejected' | 'deferred'> {
  // Ask where to start rather than trusting a local cursor: the server may have
  // been restored from a backup, or another device may have finished the job.
  const statusResponse = await apiFetch(`/media/${item.id}/status`);
  if (statusResponse.status === 404) {
    // Metadata hasn't landed yet — it will on the next sync, then bytes follow.
    return 'deferred';
  }
  if (!statusResponse.ok) return 'deferred';

  let status = (await statusResponse.json()) as MediaStatus;
  if (status.complete) {
    markMediaUploaded(item.id);
    return 'done';
  }

  let offset = status.uploaded;

  while (offset < item.bytes) {
    onProgress({
      id: item.id,
      kind: item.kind,
      direction: 'upload',
      done: offset,
      total: item.bytes,
    });

    const chunk = readChunk(item.id, offset, Math.min(CHUNK_BYTES, item.bytes - offset));
    if (chunk.length === 0) return 'deferred'; // local file shrank underneath us

    const response = await apiFetch(`/media/${item.id}?offset=${offset}`, {
      method: 'PUT',
      headers: { 'Content-Type': item.mime },
      body: chunk,
    });

    if (response.status === 413) {
      const body = await response.json().catch(() => ({}) as any);
      console.error(
        `[media] Server refuses ${item.kind} ${item.id} (${item.bytes} bytes): ` +
          `${body.message ?? 'too large'}`
      );
      return 'rejected';
    }

    if (response.status === 409 || response.status === 422) {
      // Our idea of the cursor was wrong, or the bytes didn't verify. Both come
      // back with the server's real position; carry on from there.
      const body = await response.json().catch(() => ({}) as any);
      const corrected = body?.status as MediaStatus | undefined;
      if (!corrected || corrected.uploaded === offset) return 'deferred';
      offset = corrected.uploaded;
      continue;
    }

    if (!response.ok) return 'deferred';

    status = (await response.json()) as MediaStatus;
    offset = status.uploaded;

    if (status.complete) {
      markMediaUploaded(item.id);
      return 'done';
    }
  }

  return offset >= item.bytes ? 'done' : 'deferred';
}

// ─── Download ────────────────────────────────────────────────

async function downloadOne(
  apiFetch: ApiFetch,
  item: MediaRecord,
  onProgress: ProgressCallback
): Promise<'done' | 'rejected' | 'deferred'> {
  let offset = mediaStore.partialBytes(item.id);

  // A stale part file bigger than the record can't be resumed from.
  if (offset > item.bytes) {
    await mediaStore.discardPart(item.id);
    offset = 0;
  }

  while (offset < item.bytes) {
    onProgress({
      id: item.id,
      kind: item.kind,
      direction: 'download',
      done: offset,
      total: item.bytes,
    });

    const end = Math.min(offset + CHUNK_BYTES, item.bytes) - 1;
    const response = await apiFetch(`/media/${item.id}`, {
      headers: { Range: `bytes=${offset}-${end}` },
    });

    if (response.status === 409) {
      // The device that owns these bytes hasn't finished uploading them.
      return 'deferred';
    }
    if (response.status === 404 || response.status === 410) {
      return 'rejected';
    }
    if (!response.ok || !response.body) return 'deferred';

    const written = await mediaStore.appendPart(item.id, Readable.fromWeb(response.body as any));
    if (written <= offset) return 'deferred'; // no progress; don't spin
    offset = written;
  }

  const ok = await mediaStore.finishPart(item.id, item.sha256);
  if (!ok) {
    console.error(`[media] Downloaded ${item.id} failed its checksum — discarded, will retry`);
    return 'deferred';
  }
  return 'done';
}

// ─── Passes ──────────────────────────────────────────────────

/**
 * Move every byte that is out of place, in both directions. Called by sync once
 * the metadata is in step, so both ends already agree on what should exist.
 */
export async function transferMedia(
  apiFetch: ApiFetch,
  onProgress: ProgressCallback
): Promise<TransferResult> {
  const result: TransferResult = { uploaded: 0, downloaded: 0, rejected: [], deferred: 0 };

  try {
    for (const item of getMediaNeedingUpload()) {
      const outcome = await uploadOne(apiFetch, item, onProgress);
      if (outcome === 'done') result.uploaded++;
      else if (outcome === 'rejected') result.rejected.push(item.id);
      else result.deferred++;
    }

    for (const item of getMediaNeedingDownload()) {
      const outcome = await downloadOne(apiFetch, item, onProgress);
      if (outcome === 'done') result.downloaded++;
      else if (outcome === 'rejected') result.rejected.push(item.id);
      else result.deferred++;
    }
  } finally {
    onProgress(null);
  }

  return result;
}

// Re-exported so syncService can mark metadata pushed in one place.
export { markMediaSynced };
