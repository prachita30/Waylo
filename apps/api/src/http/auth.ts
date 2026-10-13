import { createHash, randomBytes } from 'node:crypto';
import type { Role } from '@waylo/shared';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { CookieOptions, RequestHandler, Response } from 'express';
import type { AppContext } from '../context';
import type { DbOrTx } from '../db/client';
import { sessions, users } from '../db/schema';
import { forbidden, unauthorized } from './errors';

export const SESSION_COOKIE = 'waylo_session';
const TOUCH_INTERVAL_MS = 5 * 60_000;

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isDemo: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionTokenHash?: string;
    }
  }
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function cookieOptions(ctx: AppContext): CookieOptions {
  return {
    httpOnly: true,
    secure: ctx.config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: ctx.config.SESSION_TTL_HOURS * 3600_000,
  };
}

export async function startSession(
  ctx: AppContext,
  db: DbOrTx,
  res: Response,
  userId: string,
  meta: { ip?: string; userAgent?: string },
): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + ctx.config.SESSION_TTL_HOURS * 3600_000),
    ip: meta.ip?.slice(0, 64),
    userAgent: meta.userAgent?.slice(0, 255),
  });
  res.cookie(SESSION_COOKIE, token, cookieOptions(ctx));
}

export function clearSessionCookie(ctx: AppContext, res: Response) {
  const { maxAge: _maxAge, ...opts } = cookieOptions(ctx);
  res.clearCookie(SESSION_COOKIE, opts);
}

/** Resolves the session cookie into req.user. Never rejects; use requireAuth to enforce. */
export function sessionMiddleware(ctx: AppContext): RequestHandler {
  return async (req, _res, next) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return next();
    const tokenHash = hashToken(token);
    const now = new Date();
    const [row] = await ctx.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        isDemo: users.isDemo,
        lastSeenAt: sessions.lastSeenAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), eq(users.status, 'active')))
      .limit(1);
    if (row) {
      const { lastSeenAt, ...user } = row;
      req.user = user;
      req.sessionTokenHash = tokenHash;
      if (now.getTime() - lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
        await ctx.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.tokenHash, tokenHash));
      }
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  next(req.user ? undefined : unauthorized());
};

/** Role gate. Roles come only from the database-backed session, never from the client. */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    next(roles.includes(req.user.role) ? undefined : forbidden());
  };

/** The signed-in user, asserting that requireAuth ran first. */
export function currentUser(req: Express.Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
