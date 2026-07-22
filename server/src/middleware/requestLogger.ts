import { type Request, type Response, type NextFunction } from 'express';
import { config } from '../config.js';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? 'warn' : 'info';

    if (config.logLevel === 'debug' || level === 'warn' || config.logLevel === 'info') {
      console.log(`[${level}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
    }
  });

  next();
}
