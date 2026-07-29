import { type Request, type Response, type NextFunction, Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { chatWithLLM } from '../services/llmService.js';

export const llmRouter = Router();

llmRouter.use(authMiddleware);

const chatRequestSchema = z.object({
  model: z.string().min(1),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string(),
      })
    )
    .min(1),
});

llmRouter.post('/chat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { model, messages } = chatRequestSchema.parse(req.body);
    const content = await chatWithLLM(model, messages);
    res.json({ content });
  } catch (err) {
    next(err);
  }
});
