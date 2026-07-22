import { type Request, type Response, type NextFunction, Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { loginUser, refreshToken, registerUser } from '../services/authService.js';

export const authRouter = Router();

authRouter.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = req.body;
    const result = await registerUser(username, password);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = req.body;
    const result = await loginUser(username, password);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/refresh', authMiddleware, (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = refreshToken(req.userId!);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
