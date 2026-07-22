import { type Request, type Response, type NextFunction, Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  createJournal,
  deleteJournal,
  getAllJournals,
  getJournalById,
  updateJournal,
} from '../services/journalService.js';

export const journalsRouter = Router();

journalsRouter.use(authMiddleware);

journalsRouter.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const since = req.query.since as string | undefined;
    const entries = getAllJournals(req.userId!, since);
    res.json({ entries });
  } catch (err) {
    next(err);
  }
});

journalsRouter.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = getJournalById(req.userId!, req.params.id as string);
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

journalsRouter.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = createJournal(req.userId!, req.body);
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

journalsRouter.put('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = updateJournal(req.userId!, req.params.id as string, req.body);
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

journalsRouter.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = deleteJournal(req.userId!, req.params.id as string);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
