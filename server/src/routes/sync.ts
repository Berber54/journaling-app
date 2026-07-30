import { type Request, type Response, type NextFunction, Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { processSync } from '../services/syncService.js';

export const syncRouter = Router();

const syncRequestSchema = z.object({
  lastSyncTimestamp: z.string().datetime().nullable(),
  entries: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      content: z.string(),
      journal_date: z.string().datetime(),
      created_at: z.string().datetime(),
      updated_at: z.string().datetime(),
      deleted: z.boolean(),
    })
  ),
  // v1 clients only: image bytes inlined as base64 data URLs.
  images: z
    .array(
      z.object({
        id: z.string().uuid(),
        journal_id: z.string().uuid(),
        data: z.string(),
        created_at: z.string().datetime(),
        updated_at: z.string().datetime(),
        deleted: z.boolean(),
      })
    )
    .optional()
    .default([]),
  // v2: metadata for photos and videos. Bytes travel over /api/media, so this
  // stays small however large the files are. Left undefined by v1 clients,
  // which is how the server tells the two apart.
  media: z
    .array(
      z.object({
        id: z.string().uuid(),
        journal_id: z.string().uuid(),
        kind: z.enum(['image', 'video']),
        mime: z.string().max(255),
        bytes: z.number().int().nonnegative(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/).or(z.literal('')),
        created_at: z.string().datetime(),
        updated_at: z.string().datetime(),
        deleted: z.boolean(),
      })
    )
    .optional(),
});

syncRouter.post('/', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = syncRequestSchema.parse(req.body);
    const result = await processSync(req.userId!, parsed);

    console.log(
      `[sync] User ${req.userId}: received ${parsed.entries.length} entries / ` +
        `${parsed.media?.length ?? parsed.images.length} media, ` +
        `sending ${result.entries.length} entries / ${result.media.length} media, ` +
        `${result.conflicts.length} conflicts`
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});
