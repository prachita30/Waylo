import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

/**
 * Every API error response has the shape:
 *   { "error": { "code": "snake_case", "message": "Human readable", "details"?: unknown } }
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Please sign in to continue.') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have access to this resource.') => new AppError(403, 'forbidden', message);
export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found.`);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);
export const gone = (code: string, message: string, details?: unknown) => new AppError(410, code, message, details);
export const unavailable = (code: string, message: string) => new AppError(503, code, message);

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'route_not_found', `No route for ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Some fields are invalid.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  // Body-parser errors (malformed JSON, payload too large) carry a status.
  const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status < 500) {
    res.status(status).json({ error: { code: 'bad_request', message: err.message ?? 'Bad request.' } });
    return;
  }
  req.log?.error({ err }, 'unhandled error');
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong on our side. Please try again.' } });
};
