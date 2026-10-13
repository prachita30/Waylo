import { Router } from 'express';
import { z } from 'zod';
import { SandboxMessagingAdapter } from '../../adapters/messaging/sandbox';
import type { AppContext } from '../../context';
import { currentUser, requireAuth, requireRole } from '../../http/auth';
import { notFound } from '../../http/errors';
import { body, query } from '../../http/validate';
import { listNotifications, markRead } from './service';

export function notificationsRouter(ctx: AppContext): Router {
  const r = Router();

  r.get('/notifications', requireAuth, async (req, res) => {
    const { limit } = query(req, z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }));
    res.json(await listNotifications(ctx, currentUser(req).id, limit));
  });

  r.post('/notifications/read', requireAuth, async (req, res) => {
    const { ids } = body(req, z.object({ ids: z.union([z.array(z.string().uuid()).max(100), z.literal('all')]) }));
    await markRead(ctx, currentUser(req).id, ids);
    res.status(204).end();
  });

  /** Sandbox outbox (administrators): what email/SMS/push would have been sent. */
  r.get('/admin/sandbox/outbox', requireRole('admin'), async (_req, res) => {
    if (!(ctx.adapters.messaging instanceof SandboxMessagingAdapter)) throw notFound('Sandbox outbox');
    res.json({
      items: ctx.adapters.messaging.outbox.slice(0, 100).map((m) => ({
        channel: m.channel,
        at: m.at,
        to: 'to' in m.message ? m.message.to : m.message.userId,
        subject: 'subject' in m.message ? m.message.subject : 'title' in m.message ? m.message.title : m.message.body.slice(0, 60),
        html: 'html' in m.message ? m.message.html : null,
        text: 'text' in m.message ? m.message.text : 'body' in m.message ? m.message.body : null,
      })),
    });
  });

  return r;
}
