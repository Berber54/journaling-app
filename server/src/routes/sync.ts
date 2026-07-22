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
});

syncRouter.post('/', authMiddleware, (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = syncRequestSchema.parse(req.body);
    const result = processSync(req.userId!, parsed);

    console.log(
      `[sync] User ${req.userId}: received ${parsed.entries.length} entries, ` +
        `sending ${result.entries.length} entries, ` +
        `${result.conflicts.length} conflicts`
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});
