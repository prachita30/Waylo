import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { flightBookings, rideParticipants, safetyIncidents, supportMessages, supportTickets, users } from '../../db/schema';
import { type AuthUser, currentUser, requireAuth, requireRole } from '../../http/auth';
import { badRequest, conflict, notFound } from '../../http/errors';
import { params, query } from '../../http/validate';
import { recordAudit } from '../../lib/audit';
import { emit } from '../../lib/events';
import { sniffDocument } from '../operator/fleet';

const CATEGORIES = ['booking', 'ride', 'payment_refund', 'account', 'safety', 'other'] as const;
const REF = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newRef = () => 'SR' + Array.from(randomBytes(6), (b) => REF[b % REF.length]).join('');

const createSchema = z.object({
  category: z.enum(CATEGORIES),
  subject: z.string().trim().min(4, 'Add a short subject.').max(140),
  message: z.string().trim().min(10, 'Tell us a little more (at least 10 characters).').max(4000),
  bookingRef: z.string().trim().toUpperCase().regex(/^WY[A-Z2-9]{6}$/).optional().or(z.literal('').transform(() => undefined)),
  groupId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
});
const replySchema = z.object({ message: z.string().trim().min(1).max(4000) });

type Ticket = typeof supportTickets.$inferSelect;

export function supportRouter(ctx: AppContext): Router {
  const r = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  const dir = path.resolve(ctx.config.UPLOAD_DIR, 'support');

  /** Runs multer, then the handler; multipart is optional (JSON also accepted). */
  const withUpload = (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => {
    upload.single('attachment')(req, res, async (err: unknown) => {
      try {
        if (err instanceof multer.MulterError) throw badRequest(err.code === 'LIMIT_FILE_SIZE' ? 'Attachments must be 5 MB or smaller.' : 'Upload failed.');
        if (err) throw err;
        await handler(req, res);
      } catch (e) {
        next(e);
      }
    });
  };

  async function storeAttachment(file: Express.Multer.File | undefined) {
    if (!file) return {};
    const kind = sniffDocument(file.buffer);
    if (!kind) throw badRequest('Attach a PDF, PNG or JPEG file.');
    const name = `${randomUUID()}.${kind.ext}`;
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), file.buffer);
    return { attachmentFile: name, attachmentType: kind.type, attachmentName: file.originalname.slice(0, 120) };
  }

  async function loadTicket(user: AuthUser, id: string) {
    const [t] = await ctx.db.select().from(supportTickets).where(eq(supportTickets.id, id));
    if (!t || (t.userId !== user.id && user.role !== 'admin')) throw notFound('Support request');
    return t;
  }

  async function ticketDto(t: Ticket, forAgent: boolean) {
    const msgs = await ctx.db
      .select({ m: supportMessages, name: users.fullName })
      .from(supportMessages)
      .innerJoin(users, eq(users.id, supportMessages.authorUserId))
      .where(and(eq(supportMessages.ticketId, t.id), forAgent ? undefined : eq(supportMessages.internal, false)))
      .orderBy(asc(supportMessages.createdAt));
    return {
      ...t,
      messages: msgs.map(({ m, name }) => ({
        id: m.id,
        author: m.authorRole === 'customer' ? 'You' : forAgent ? name : 'WAYLO Support',
        authorRole: m.authorRole,
        body: m.body,
        internal: m.internal,
        attachment: m.attachmentFile ? { name: m.attachmentName, type: m.attachmentType, url: `/api/v1/support/attachments/${m.id}` } : null,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  // ---- customer
  r.post(
    '/support/tickets',
    requireAuth,
    withUpload(async (req, res) => {
      const user = currentUser(req);
      const input = createSchema.parse(req.body);
      if (input.bookingRef) {
        const [b] = await ctx.db.select({ userId: flightBookings.userId }).from(flightBookings).where(eq(flightBookings.reference, input.bookingRef));
        if (!b || b.userId !== user.id) throw badRequest('That booking reference is not on your account.');
      }
      if (input.groupId) {
        const mine = await ctx.db.select().from(rideParticipants).where(and(eq(rideParticipants.groupId, input.groupId), eq(rideParticipants.userId, user.id)));
        if (!mine.length) throw badRequest('That ride is not on your account.');
      }
      const attachment = await storeAttachment(req.file);
      const safety = input.category === 'safety';
      const ticket = await ctx.db.transaction(async (tx) => {
        let incidentId: string | null = null;
        if (safety) {
          const [inc] = await tx
            .insert(safetyIncidents)
            .values({ reporterUserId: user.id, reporterRole: user.role, groupId: input.groupId ?? null, category: 'safety', severity: 'high', description: `${input.subject}\n\n${input.message}` })
            .returning();
          incidentId = inc!.id;
        }
        const [t] = await tx
          .insert(supportTickets)
          .values({
            reference: newRef(),
            userId: user.id,
            category: input.category,
            subject: input.subject,
            priority: safety ? 'urgent' : input.category === 'payment_refund' ? 'high' : 'normal',
            relatedBookingRef: input.bookingRef ?? null,
            relatedGroupId: input.groupId ?? null,
            incidentId,
          })
          .returning();
        await tx.insert(supportMessages).values({ ticketId: t!.id, authorUserId: user.id, authorRole: 'customer', body: input.message, ...attachment });
        await recordAudit(tx, { actorUserId: user.id, actorRole: user.role, action: 'support.ticket_created', entityType: 'support_ticket', entityId: t!.id, metadata: { category: input.category } });
        return t!;
      });
      if (safety) ctx.logger.warn({ ticketId: ticket.id }, 'SAFETY ESCALATION: support ticket needs urgent review');
      res.status(201).json({ ticket: await ticketDto(ticket, false) });
    }),
  );

  r.get('/support/tickets', requireAuth, async (req, res) => {
    const rows = await ctx.db.select().from(supportTickets).where(eq(supportTickets.userId, currentUser(req).id)).orderBy(desc(supportTickets.lastActivityAt)).limit(100);
    res.json({ items: rows });
  });

  r.get('/support/tickets/:id', requireAuth, async (req, res) => {
    const { id } = params(req, z.object({ id: z.string().uuid() }));
    const user = currentUser(req);
    const t = await loadTicket(user, id);
    res.json({ ticket: await ticketDto(t, user.role === 'admin') });
  });

  r.post(
    '/support/tickets/:id/messages',
    requireAuth,
    withUpload(async (req, res) => {
      const { id } = params(req, z.object({ id: z.string().uuid() }));
      const user = currentUser(req);
      const t = await loadTicket(user, id);
      if (t.userId !== user.id) throw notFound('Support request');
      if (t.status === 'closed') throw conflict('ticket_closed', 'This request is closed. Please open a new one.');
      const { message } = replySchema.parse(req.body);
      const attachment = await storeAttachment(req.file);
      await ctx.db.insert(supportMessages).values({ ticketId: t.id, authorUserId: user.id, authorRole: 'customer', body: message, ...attachment });
      const [updated] = await ctx.db
        .update(supportTickets)
        .set({ status: t.status === 'awaiting_customer' || t.status === 'resolved' ? 'open' : t.status, lastActivityAt: new Date() })
        .where(eq(supportTickets.id, t.id))
        .returning();
      res.status(201).json({ ticket: await ticketDto(updated!, false) });
    }),
  );

  r.post('/support/tickets/:id/close', requireAuth, async (req, res) => {
    const { id } = params(req, z.object({ id: z.string().uuid() }));
    const user = currentUser(req);
    const t = await loadTicket(user, id);
    if (t.userId !== user.id) throw notFound('Support request');
    const [updated] = await ctx.db.update(supportTickets).set({ status: 'closed', lastActivityAt: new Date() }).where(eq(supportTickets.id, t.id)).returning();
    res.json({ ticket: await ticketDto(updated!, false) });
  });

  r.get('/support/attachments/:messageId', requireAuth, async (req, res) => {
    const { messageId } = params(req, z.object({ messageId: z.string().uuid() }));
    const user = currentUser(req);
    const [m] = await ctx.db.select().from(supportMessages).where(eq(supportMessages.id, messageId));
    if (!m?.attachmentFile) throw notFound('Attachment');
    const t = await loadTicket(user, m.ticketId);
    if (m.internal && user.role !== 'admin') throw notFound('Attachment');
    const data = await readFile(path.join(dir, m.attachmentFile)).catch(() => null);
    if (!data || !t) throw notFound('Attachment');
    res.set({ 'Content-Type': m.attachmentType!, 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(data);
  });

  // ---- agents (administrators)
  r.get('/admin/support/tickets', requireRole('admin'), async (req, res) => {
    const { status } = query(req, z.object({ status: z.string().optional() }));
    const statuses = status ? (status.split(',') as Ticket['status'][]) : (['open', 'in_review', 'awaiting_customer'] as Ticket['status'][]);
    const rows = await ctx.db
      .select({ t: supportTickets, customer: users.fullName, email: users.email })
      .from(supportTickets)
      .innerJoin(users, eq(users.id, supportTickets.userId))
      .where(inArray(supportTickets.status, statuses))
      .orderBy(desc(supportTickets.priority), asc(supportTickets.lastActivityAt))
      .limit(200);
    res.json({ items: rows.map(({ t, customer, email }) => ({ ...t, customer, email })) });
  });

  r.post('/admin/support/tickets/:id/messages', requireRole('admin'), async (req, res) => {
    const { id } = params(req, z.object({ id: z.string().uuid() }));
    const input = z.object({ message: z.string().trim().min(1).max(4000), internal: z.boolean().default(false), status: z.enum(['in_review', 'awaiting_customer', 'resolved', 'closed']).optional() }).parse(req.body);
    const agent = currentUser(req);
    const t = await loadTicket(agent, id);
    await ctx.db.insert(supportMessages).values({ ticketId: t.id, authorUserId: agent.id, authorRole: 'agent', body: input.message, internal: input.internal });
    const status = input.status ?? (input.internal ? t.status : 'awaiting_customer');
    const [updated] = await ctx.db.update(supportTickets).set({ status, assignedTo: t.assignedTo ?? agent.id, lastActivityAt: new Date() }).where(eq(supportTickets.id, t.id)).returning();
    await recordAudit(ctx.db, { actorUserId: agent.id, actorRole: 'admin', action: input.internal ? 'support.note_added' : 'support.replied', entityType: 'support_ticket', entityId: t.id, metadata: { status } });
    if (!input.internal) await emit(ctx, { type: 'support.ticket_updated', userId: t.userId, ticketId: t.id, status });
    res.status(201).json({ ticket: await ticketDto(updated!, true) });
  });

  r.patch('/admin/support/tickets/:id', requireRole('admin'), async (req, res) => {
    const { id } = params(req, z.object({ id: z.string().uuid() }));
    const input = z.object({ status: z.enum(['open', 'in_review', 'awaiting_customer', 'resolved', 'closed']).optional(), priority: z.enum(['normal', 'high', 'urgent']).optional() }).parse(req.body);
    const agent = currentUser(req);
    const t = await loadTicket(agent, id);
    const [updated] = await ctx.db.update(supportTickets).set({ ...input, lastActivityAt: new Date() }).where(eq(supportTickets.id, t.id)).returning();
    await recordAudit(ctx.db, { actorUserId: agent.id, actorRole: 'admin', action: 'support.updated', entityType: 'support_ticket', entityId: t.id, metadata: input });
    if (input.status === 'resolved') await emit(ctx, { type: 'support.ticket_updated', userId: t.userId, ticketId: t.id, status: 'resolved' });
    res.json({ ticket: await ticketDto(updated!, true) });
  });

  return r;
}
