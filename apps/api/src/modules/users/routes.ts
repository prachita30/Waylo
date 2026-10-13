import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { changePasswordSchema, deleteAccountSchema, preferencesSchema, updateProfileSchema } from '@waylo/shared';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { airports, cities, savedDestinations, sessions, userPreferences, users } from '../../db/schema';
import { clearSessionCookie, currentUser, requireAuth } from '../../http/auth';
import { AppError, badRequest, conflict, notFound } from '../../http/errors';
import { limiter } from '../../http/rateLimit';
import { body, params } from '../../http/validate';
import { recordAudit } from '../../lib/audit';
import { hashPassword, verifyPassword } from '../../lib/password';
import { findDeletionBlockers, getPreferences, getUserById, listSavedDestinations, toPublicUser } from './service';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_FILE = /^[0-9a-f-]{36}\.(png|jpg|webp)$/;

/** Identify an image by its magic bytes; the client-supplied MIME type is not trusted. */
export function sniffImage(buf: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}
const CONTENT_TYPE = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;

export function usersRouter(ctx: AppContext): Router {
  const r = Router();
  const avatarDir = path.resolve(ctx.config.UPLOAD_DIR, 'avatars');
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AVATAR_BYTES, files: 1 } });
  const sensitive = limiter({ windowMs: 15 * 60_000, limit: ctx.config.AUTH_RATE_LIMIT, name: 'sensitive' });

  r.get('/users/me', requireAuth, async (req, res) => {
    const me = currentUser(req);
    const user = await getUserById(ctx.db, me.id);
    if (!user) throw notFound('User');
    const [preferences, saved] = await Promise.all([getPreferences(ctx.db, me.id), listSavedDestinations(ctx.db, me.id)]);
    res.json({ user: toPublicUser(user), preferences, savedDestinations: saved });
  });

  r.patch('/users/me', requireAuth, async (req, res) => {
    const me = currentUser(req);
    const input = body(req, updateProfileSchema);
    if (input.homeAirport) {
      const [a] = await ctx.db.select({ code: airports.code }).from(airports).where(eq(airports.code, input.homeAirport));
      if (!a) throw badRequest('Unknown home airport.');
    }
    const [user] = await ctx.db.update(users).set(input).where(eq(users.id, me.id)).returning();
    res.json({ user: toPublicUser(user!) });
  });

  r.put('/users/me/preferences', requireAuth, async (req, res) => {
    const me = currentUser(req);
    const input = body(req, preferencesSchema);
    await ctx.db
      .insert(userPreferences)
      .values({ userId: me.id, ...input })
      .onConflictDoUpdate({ target: userPreferences.userId, set: input });
    res.json({ preferences: await getPreferences(ctx.db, me.id) });
  });

  // ---- saved destinations
  r.get('/users/me/saved-destinations', requireAuth, async (req, res) => {
    res.json({ items: await listSavedDestinations(ctx.db, currentUser(req).id) });
  });

  r.put('/users/me/saved-destinations/:cityId', requireAuth, async (req, res) => {
    const { cityId } = params(req, z.object({ cityId: z.string().min(1).max(32) }));
    const [c] = await ctx.db.select({ id: cities.id }).from(cities).where(eq(cities.id, cityId));
    if (!c) throw notFound('Destination');
    await ctx.db.insert(savedDestinations).values({ userId: currentUser(req).id, cityId }).onConflictDoNothing();
    res.status(204).end();
  });

  r.delete('/users/me/saved-destinations/:cityId', requireAuth, async (req, res) => {
    const { cityId } = params(req, z.object({ cityId: z.string().min(1).max(32) }));
    await ctx.db
      .delete(savedDestinations)
      .where(and(eq(savedDestinations.userId, currentUser(req).id), eq(savedDestinations.cityId, cityId)));
    res.status(204).end();
  });

  // ---- avatar
  r.post('/users/me/avatar', requireAuth, (req, res, next) => {
    upload.single('avatar')(req, res, async (err: unknown) => {
      try {
        if (err instanceof multer.MulterError) {
          throw badRequest(err.code === 'LIMIT_FILE_SIZE' ? 'Profile photos must be 2 MB or smaller.' : 'Upload failed.');
        }
        if (err) throw err;
        if (!req.file) throw badRequest('Choose an image to upload.');
        const kind = sniffImage(req.file.buffer);
        if (!kind) throw badRequest('Upload a PNG, JPEG or WebP image.');
        const me = currentUser(req);
        const file = `${randomUUID()}.${kind}`;
        await mkdir(avatarDir, { recursive: true });
        await writeFile(path.join(avatarDir, file), req.file.buffer);
        const old = await getUserById(ctx.db, me.id);
        const [user] = await ctx.db.update(users).set({ avatarFile: file }).where(eq(users.id, me.id)).returning();
        if (old?.avatarFile) await unlink(path.join(avatarDir, old.avatarFile)).catch(() => undefined);
        res.json({ user: toPublicUser(user!) });
      } catch (e) {
        next(e);
      }
    });
  });

  r.delete('/users/me/avatar', requireAuth, async (req, res) => {
    const me = currentUser(req);
    const old = await getUserById(ctx.db, me.id);
    const [user] = await ctx.db.update(users).set({ avatarFile: null }).where(eq(users.id, me.id)).returning();
    if (old?.avatarFile) await unlink(path.join(avatarDir, old.avatarFile)).catch(() => undefined);
    res.json({ user: toPublicUser(user!) });
  });

  /** Avatars are visible to signed-in users only (e.g. co-riders); file names are unguessable UUIDs. */
  r.get('/avatars/:file', requireAuth, async (req, res) => {
    const { file } = params(req, z.object({ file: z.string().regex(AVATAR_FILE) }));
    const data = await readFile(path.join(avatarDir, file)).catch(() => null);
    if (!data) throw notFound('Image');
    const ext = file.split('.').pop() as keyof typeof CONTENT_TYPE;
    res.set({ 'Content-Type': CONTENT_TYPE[ext], 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).send(data);
  });

  // ---- security
  r.post('/users/me/password', requireAuth, sensitive, async (req, res) => {
    const me = currentUser(req);
    const input = body(req, changePasswordSchema);
    const user = await getUserById(ctx.db, me.id);
    if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new AppError(400, 'invalid_password', 'Your current password is incorrect.', [
        { path: 'currentPassword', message: 'Your current password is incorrect.' },
      ]);
    }
    const passwordHash = await hashPassword(input.newPassword);
    await ctx.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, me.id));
      // Sign out every other device.
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, me.id), isNull(sessions.revokedAt), ne(sessions.tokenHash, req.sessionTokenHash ?? '')));
      await recordAudit(tx, { actorUserId: me.id, actorRole: me.role, action: 'user.password_changed', entityType: 'user', entityId: me.id, ip: req.ip });
    });
    res.status(204).end();
  });

  /**
   * Account deletion: personal data is erased immediately; booking and payment records are retained
   * (without contact details) where financial or legal record-keeping requires it.
   */
  r.delete('/users/me', requireAuth, sensitive, async (req, res) => {
    const me = currentUser(req);
    const input = body(req, deleteAccountSchema);
    const user = await getUserById(ctx.db, me.id);
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new AppError(400, 'invalid_password', 'Your password is incorrect.', [{ path: 'password', message: 'Your password is incorrect.' }]);
    }
    const blockers = await findDeletionBlockers(ctx.db, me.id);
    if (blockers.length) {
      throw conflict('deletion_blocked', 'Finish or cancel your active trips before deleting your account.', blockers);
    }
    await ctx.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          email: `deleted+${me.id}@deleted.invalid`,
          fullName: 'Deleted user',
          phone: null,
          avatarFile: null,
          homeAirport: null,
          passwordHash: await hashPassword(randomUUID()),
          status: 'deleted',
          deletedAt: new Date(),
        })
        .where(eq(users.id, me.id));
      await tx.delete(savedDestinations).where(eq(savedDestinations.userId, me.id));
      await tx.delete(userPreferences).where(eq(userPreferences.userId, me.id));
      await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, me.id), isNull(sessions.revokedAt)));
      await recordAudit(tx, { actorUserId: me.id, actorRole: me.role, action: 'user.deleted', entityType: 'user', entityId: me.id, ip: req.ip });
    });
    if (user.avatarFile) await unlink(path.join(avatarDir, user.avatarFile)).catch(() => undefined);
    clearSessionCookie(ctx, res);
    res.status(204).end();
  });

  return r;
}
