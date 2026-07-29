import { type Request, type Response, type NextFunction } from 'express';
import { ZodError } from 'zod';

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

export class AppError extends Error {
  public statusCode: number;
  public error: string;

  constructor(statusCode: number, error: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.error = error;
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error(`[error] ${err.name}: ${err.message}`);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.error,
      message: err.message,
      statusCode: err.statusCode,
    } satisfies ApiError);
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: err.issues.map((issue) => issue.message).join('; '),
      statusCode: 400,
    } satisfies ApiError);
    return;
  }

  // body-parser rejects an oversized body with a 413 carried on the error
  // itself. Pass that status through rather than flattening it into a 500 —
  // clients split their image batch when they see it, and can only do that if
  // the status survives.
  const status = (err as { status?: number; statusCode?: number }).status
    ?? (err as { statusCode?: number }).statusCode;

  if (typeof status === 'number' && status >= 400 && status < 500) {
    const tooLarge = (err as { type?: string }).type === 'entity.too.large';
    res.status(status).json({
      error: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
      message: tooLarge
        ? 'Request body is larger than the server upload limit'
        : err.message,
      statusCode: status,
    } satisfies ApiError);
    return;
  }

  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
    statusCode: 500,
  } satisfies ApiError);
}
