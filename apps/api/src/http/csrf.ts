import type { RequestHandler } from 'express';
import { AppError } from './errors';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CLIENT_HEADER = 'x-waylo-client';

/**
 * CSRF defence for cookie-authenticated requests:
 * 1. Session cookies are SameSite=Lax.
 * 2. Unsafe methods must send the custom X-Waylo-Client header, which a cross-site
 *    form cannot set and which forces a CORS preflight for cross-origin scripts.
 * 3. When an Origin header is present it must be an allowed origin.
 * Webhook routes (server-to-server, signature verified) are exempt.
 */
export function csrfGuard(allowedOrigins: string[], exemptPrefixes: string[] = []): RequestHandler {
  return (req, _res, next) => {
    if (SAFE.has(req.method) || exemptPrefixes.some((p) => req.path.startsWith(p))) return next();
    if (!req.get(CLIENT_HEADER)) {
      return next(new AppError(403, 'csrf_rejected', 'Missing client header.'));
    }
    const origin = req.get('origin');
    if (origin && !allowedOrigins.includes(origin)) {
      return next(new AppError(403, 'csrf_rejected', 'Origin not allowed.'));
    }
    next();
  };
}
