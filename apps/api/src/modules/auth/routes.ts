import { loginSchema, registerSchema } from '@waylo/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { Router } from 'express';
import type { AppContext } from '../../context';
import { sessions, userPreferences, users } from '../../db/schema';
import { clearSessionCookie, startSession } from '../../http/auth';
import { AppError, conflict } from '../../http/errors';
import { limiter } from '../../http/rateLimit';
import { body } from '../../http/validate';
import { recordAudit } from '../../lib/audit';
import { dummyHash, hashPassword, verifyPassword } from '../../lib/password';
import { getUserByEmail, toPublicUser } from '../users/service';

const invalidCredentials = () => new AppError(401, 'invalid_credentials', 'Email or password is incorrect.');

export function authRouter(ctx: AppContext): Router {
  const r = Router();
  const authLimit = limiter({ windowMs: 15 * 60_000, limit: ctx.config.AUTH_RATE_LIMIT, name: 'auth' });

  r.post('/auth/register', authLimit, async (req, res) => {
    const input = body(req, registerSchema);
    if (await getUserByEmail(ctx.db, input.email)) {
      throw conflict('email_taken', 'An account with this email already exists. Try signing in instead.');
    }
    const passwordHash = await hashPassword(input.password);
    const user = await ctx.db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({ email: input.email, passwordHash, fullName: input.fullName, phone: input.phone ?? null, role: input.accountType })
        .onConflictDoNothing({ target: users.email })
        .returning();
      // A concurrent registration with the same email won the race.
      if (!u) throw conflict('email_taken', 'An account with this email already exists. Try signing in instead.');
      await tx.insert(userPreferences).values({ userId: u.id });
      await startSession(ctx, tx, res, u.id, { ip: req.ip, userAgent: req.get('user-agent') });
      await recordAudit(tx, { actorUserId: u.id, actorRole: u.role, action: 'user.registered', entityType: 'user', entityId: u.id, ip: req.ip });
      return u;
    });
    res.status(201).json({ user: toPublicUser(user) });
  });

  r.post('/auth/login', authLimit, async (req, res) => {
    const input = body(req, loginSchema);
    const user = await getUserByEmail(ctx.db, input.email);
    const ok = await verifyPassword(input.password, user?.passwordHash ?? (await dummyHash()));
    if (!user || !ok || user.status === 'deleted') throw invalidCredentials();
    if (user.status === 'suspended') {
      throw new AppError(403, 'account_suspended', 'This account is suspended. Please contact support.');
    }
    await ctx.db.transaction(async (tx) => {
      await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await startSession(ctx, tx, res, user.id, { ip: req.ip, userAgent: req.get('user-agent') });
    });
    res.json({ user: toPublicUser(user) });
  });

  r.post('/auth/logout', async (req, res) => {
    if (req.sessionTokenHash) {
      await ctx.db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.tokenHash, req.sessionTokenHash), isNull(sessions.revokedAt)));
    }
    clearSessionCookie(ctx, res);
    res.status(204).end();
  });

  return r;
}
