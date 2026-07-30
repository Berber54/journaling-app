import { type Request, type Response, type NextFunction, Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  MediaTransferError,
  appendChunk,
  getMediaRow,
  openBlob,
  readStatus,
} from '../services/mediaService.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Byte transfer for photos and videos.
 *
 * Metadata (what files exist, their size and checksum) travels through
 * /api/sync. This router moves only the bytes, and does it resumably:
 *
 *   GET  /api/media/:id/status          → how much the server holds
 *   PUT  /api/media/:id?offset=N        → append raw bytes from N
 *   GET  /api/media/:id  (Range: …)     → download, whole or partial
 *
 * Every route streams, so memory use is flat regardless of file size. A row must
 * already exist (created by a sync) before its bytes can be pushed — that keeps
 * one source of truth for which files an account owns.
 */
export const mediaRouter = Router();

function requireRow(req: Request) {
  const row = getMediaRow(String(req.params.id), req.userId!);
  if (!row) {
    throw new AppError(404, 'MEDIA_NOT_FOUND', 'No such file for this account — sync its metadata first');
  }
  return row;
}

// ─── Status: the resume cursor ───────────────────────────────

mediaRouter.get('/:id/status', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = requireRow(req);
    res.json(await readStatus(row));
  } catch (err) {
    next(err);
  }
});

// ─── Upload ──────────────────────────────────────────────────

mediaRouter.put('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = requireRow(req);

    if (row.deleted) {
      throw new AppError(410, 'MEDIA_DELETED', 'That file has been deleted');
    }

    const rawOffset = (req.query.offset as string | undefined) ?? '0';
    const offset = Number(rawOffset);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new AppError(400, 'BAD_OFFSET', `offset must be a non-negative integer, got "${rawOffset}"`);
    }

    const status = await appendChunk(row, offset, req);
    res.status(status.complete ? 200 : 202).json(status);
  } catch (err) {
    if (err instanceof MediaTransferError) {
      res.status(err.statusCode).json({
        error: err.code,
        message: err.message,
        statusCode: err.statusCode,
        ...(err.status ? { status: err.status } : {}),
      });
      return;
    }
    next(err);
  }
});

// ─── Download ────────────────────────────────────────────────

/** `bytes=0-1023` / `bytes=1024-` → inclusive [start, end], or null if absent. */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  // A suffix range ("bytes=-500") means the last 500 bytes.
  if (rawStart === '') {
    const length = Math.min(Number(rawEnd), size);
    return { start: size - length, end: size - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  return { start, end };
}

mediaRouter.get('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = requireRow(req);

    if (row.deleted) {
      throw new AppError(410, 'MEDIA_DELETED', 'That file has been deleted');
    }

    const status = await readStatus(row);
    if (!status.complete) {
      // The uploader hasn't finished. Not an error the caller can fix, but it
      // must not be mistaken for "the file is this short".
      throw new AppError(
        409,
        'MEDIA_INCOMPLETE',
        `Only ${status.uploaded} of ${row.bytes} bytes have been uploaded so far`
      );
    }

    res.setHeader('Content-Type', row.mime);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    if (row.sha256) res.setHeader('ETag', `"${row.sha256}"`);

    const range = parseRange(req.headers.range, row.bytes);

    if (!range) {
      res.setHeader('Content-Length', String(row.bytes));
      openBlob(row, 0, row.bytes - 1).pipe(res);
      return;
    }

    if (range.start >= row.bytes || range.start > range.end) {
      res.status(416).setHeader('Content-Range', `bytes */${row.bytes}`);
      res.end();
      return;
    }

    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${row.bytes}`);
    res.setHeader('Content-Length', String(range.end - range.start + 1));
    openBlob(row, range.start, range.end).pipe(res);
  } catch (err) {
    next(err);
  }
});
