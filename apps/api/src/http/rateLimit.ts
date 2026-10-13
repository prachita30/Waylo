import { rateLimit } from 'express-rate-limit';

/** Rate limiter with WAYLO's standard JSON error body. In-memory store; use a shared store (Redis) when running multiple instances. */
export function limiter(opts: { windowMs: number; limit: number; name: string }) {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    identifier: opts.name,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'rate_limited', message: 'Too many attempts. Please wait a few minutes and try again.' } });
    },
  });
}
