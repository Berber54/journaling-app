import { type Request, type Response, type NextFunction, Router } from 'express';
import { AppError } from '../middleware/errorHandler.js';
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

authRouter.post('/refresh', (req: Request, res: Response, next: NextFunction) => {
  try {
    // Parse the token ourselves instead of using authMiddleware: refresh must
    // accept an expired token (that is the whole point), whereas authMiddleware
    // rejects expired tokens with a 401.
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authorization header is required');
    }
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw new AppError(401, 'UNAUTHORIZED', 'Authorization header must be: Bearer <token>');
    }
    const result = refreshToken(parts[1]);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
