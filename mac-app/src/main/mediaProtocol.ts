import fs from 'node:fs';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { getMediaRow } from './database.js';
import * as mediaStore from './mediaStore.js';

/**
 * `journal-media://<id>` — how the editor reads a photo or video.
 *
 * The alternative would be handing the renderer a base64 data URL, which is
 * what v1 did. That cannot work for video: the whole file would have to be in
 * memory as a string before a single frame played. Serving the file over a
 * scheme that honours Range requests instead means <video> streams it and can
 * seek, and a 2 GB clip costs no more memory than a thumbnail.
 */

export const MEDIA_SCHEME = 'journal-media';

// Must be registered before the app is ready. `stream: true` is the part that
// lets <video> seek; without it Chromium refuses to treat this as a media
// source it can range-request.
export const MEDIA_SCHEME_PRIVILEGES = {
  scheme: MEDIA_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
  },
};

/** `bytes=0-1023` / `bytes=1024-` → inclusive [start, end], or null. */
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  if (rawStart === '') {
    const length = Math.min(Number(rawEnd), size);
    return { start: size - length, end: size - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  return { start, end };
}

function streamOf(id: string, start: number, end: number): ReadableStream {
  return Readable.toWeb(mediaStore.openRead(id, start, end)) as unknown as ReadableStream;
}

export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    // With `standard: true` the id lands in the host position of the URL.
    const id = new URL(request.url).hostname;

    const row = getMediaRow(id);
    if (!row || row.deleted === 1) {
      return new Response(null, { status: 404 });
    }

    // Size comes from the file, not the record: while a download is still in
    // progress there is nothing here to serve, and the editor shows its
    // placeholder instead of a half-file.
    const size = mediaStore.localBytes(id);
    if (size === 0) {
      return new Response(null, { status: 404 });
    }

    const headers: Record<string, string> = {
      'Content-Type': row.mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    };

    const range = parseRange(request.headers.get('range'), size);

    if (!range) {
      return new Response(streamOf(id, 0, size - 1), {
        status: 200,
        headers: { ...headers, 'Content-Length': String(size) },
      });
    }

    if (range.start >= size || range.start > range.end) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'Content-Range': `bytes */${size}` },
      });
    }

    return new Response(streamOf(id, range.start, range.end), {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        'Content-Length': String(range.end - range.start + 1),
      },
    });
  });
}
