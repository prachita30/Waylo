import { formatMoney } from '@waylo/shared';
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { notificationDeliveries, notifications, rideParticipants, userPreferences, users } from '../../db/schema';
import { type DomainEvent, subscribe } from '../../lib/events';
import { renderEmail } from './email';

export interface NotificationInput {
  userId: string;
  kind: string;
  title: string;
  body: string;
  link?: string | null;
}

const time = (iso: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

async function requestIdFor(ctx: AppContext, groupId: string, userId: string) {
  const [p] = await ctx.db
    .select({ requestId: rideParticipants.requestId })
    .from(rideParticipants)
    .where(and(eq(rideParticipants.groupId, groupId), eq(rideParticipants.userId, userId)))
    .orderBy(desc(rideParticipants.joinedAt))
    .limit(1);
  return p?.requestId;
}

/** Turns a domain event into the messages its recipients should get. */
export async function messagesFor(ctx: AppContext, e: DomainEvent): Promise<NotificationInput[]> {
  const ride = async (userIds: string[], groupId: string, kind: string, title: string, body: string) =>
    Promise.all(userIds.map(async (userId) => ({ userId, kind, title, body, link: `/trips/rides/${(await requestIdFor(ctx, groupId, userId)) ?? ''}` })));
  switch (e.type) {
    case 'flight_booking.confirmed':
      return [{ userId: e.userId, kind: e.type, title: 'Your flight is confirmed', body: `The airline issued your ticket for booking ${e.reference}. Your airline reference (PNR) and ticket numbers are in your trip.`, link: `/trips/flights/${e.bookingId}` }];
    case 'flight_booking.ticketing_failed':
      return [{ userId: e.userId, kind: e.type, title: 'We could not get your ticket issued', body: `The airline did not issue a ticket for booking ${e.reference}. You will receive a full refund to your original payment method.`, link: `/trips/flights/${e.bookingId}` }];
    case 'flight_booking.cancelled':
      return [{ userId: e.userId, kind: e.type, title: 'Booking cancelled', body: e.refundMinor ? `Booking ${e.reference} is cancelled. A refund of ${formatMoney(e.refundMinor)} is on its way.` : `Booking ${e.reference} is cancelled. This fare had no refundable amount.`, link: `/trips/flights/${e.bookingId}` }];
    case 'refund.processed':
      return [
        e.succeeded
          ? { userId: e.userId, kind: e.type, title: 'Refund sent', body: `${formatMoney(e.amountMinor)} has been refunded to your original payment method. Banks usually take 5–7 working days to show it.`, link: '/trips' }
          : { userId: e.userId, kind: e.type, title: 'Your refund needs attention', body: `We could not complete a refund of ${formatMoney(e.amountMinor)}. Our team is looking into it and will contact you.`, link: '/support/tickets' },
      ];
    case 'ride.group_locked':
      return ride(e.userIds, e.groupId, e.type, 'Your shared ride is confirmed', 'Your group is set. Pay your share to keep your seat. Unpaid seats are released before pickup.');
    case 'ride.group_dissolved':
      return [{ userId: e.userId, kind: e.type, title: 'No co-riders this time', body: 'Nobody else joined your shared ride, so we released your request at no cost.', link: `/trips/rides/${e.requestId}` }];
    case 'ride.driver_assigned':
      return ride(e.userIds, e.groupId, e.type, `${e.driverName} is your driver`, `Look for: ${e.vehicle}.`);
    case 'ride.pickup_rescheduled':
      return ride(e.userIds, e.groupId, e.type, 'Pickup time updated', `Your planned pickup is now around ${time(e.plannedPickupAt)} because of a flight change.`);
    case 'ride.status_changed': {
      const text: Record<string, [string, string]> = {
        en_route: ['Your driver is on the way', 'Your driver is heading to the pickup point.'],
        arrived: ['Your driver is at the pickup point', 'Head to the pickup point when you have your bags.'],
        completed: ['Thanks for riding with WAYLO', 'Your shared ride is complete.'],
      };
      const t = text[e.status];
      return t ? ride(e.userIds, e.groupId, `ride.${e.status}`, t[0], t[1]) : [];
    }
    case 'ride.rider_removed': {
      const text: Record<string, [string, string]> = {
        flight_delay: ['Your flight is late, so we moved you', 'Your co-riders could not wait that long. We are looking for a new group for your new arrival time. You have not been charged for the old one.'],
        flight_cancelled: ['Your flight was cancelled', 'We released your shared ride. Any payment for it will be refunded in full.'],
        no_show: ['You were marked as a no-show', 'The driver waited past the grace period. If this is wrong, contact support.'],
        payment_timeout: ['Your seat was released', 'Payment was not completed in time, so the seat was released. You have not been charged.'],
        operator: ['Your ride changed', 'Your ride operator made a change. Check your trip for details.'],
      };
      const [title, body] = text[e.reason]!;
      return [{ userId: e.userId, kind: `ride.removed.${e.reason}`, title, body, link: `/trips/rides/${e.requestId}` }];
    }
    case 'ride.arrival_updated':
      return Math.abs(e.delayMinutes) >= 10
        ? [{ userId: e.userId, kind: e.type, title: `Flight now expected at ${time(e.expectedArrivalAt)}`, body: 'We are following your flight and will adjust your shared ride.', link: `/trips/rides/${e.requestId}` }]
        : [];
    case 'support.ticket_updated':
      return [{ userId: e.userId, kind: e.type, title: 'Update on your support request', body: e.status === 'resolved' ? 'Your request has been resolved. Reply if you still need help.' : 'Our team replied to your request.', link: `/support/tickets/${e.ticketId}` }];
    default:
      return [];
  }
}

/** Stores in-app notifications and queues email/SMS/push according to each user's preferences. */
export async function notify(ctx: AppContext, items: NotificationInput[]) {
  for (const n of items) {
    const [row] = await ctx.db.insert(notifications).values({ userId: n.userId, kind: n.kind, title: n.title, body: n.body, link: n.link ?? null }).returning();
    const [prefs] = await ctx.db.select().from(userPreferences).where(eq(userPreferences.userId, n.userId));
    const channels: ('email' | 'sms' | 'push')[] = [];
    if (prefs?.notifyEmail ?? true) channels.push('email');
    if (prefs?.notifySms ?? true) channels.push('sms');
    if (prefs?.notifyPush ?? true) channels.push('push');
    if (channels.length) await ctx.db.insert(notificationDeliveries).values(channels.map((channel) => ({ notificationId: row!.id, channel })));
  }
}

let registered = false;
export function registerNotifications() {
  if (registered) return;
  registered = true;
  subscribe(async (ctx, e) => {
    const items = await messagesFor(ctx, e);
    if (items.length) await notify(ctx, items);
  });
}

const BACKOFF_MINUTES = [1, 5, 15];

/** Background job: sends queued deliveries. Messaging is retried (it is not a financial operation). */
export async function sendQueuedDeliveries(ctx: AppContext, now = new Date(), limit = 50) {
  const due = await ctx.db
    .select({ d: notificationDeliveries, n: notifications, email: users.email, phone: users.phone, status: users.status })
    .from(notificationDeliveries)
    .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(and(eq(notificationDeliveries.status, 'queued'), lte(notificationDeliveries.nextAttemptAt, now)))
    .orderBy(asc(notificationDeliveries.createdAt))
    .limit(limit);
  const appUrl = ctx.config.webOrigins[0] ?? '';
  for (const { d, n, email, phone, status } of due) {
    if (status === 'deleted' || (d.channel === 'sms' && !phone)) {
      await ctx.db.update(notificationDeliveries).set({ status: 'skipped', error: status === 'deleted' ? 'Account deleted' : 'No mobile number' }).where(eq(notificationDeliveries.id, d.id));
      continue;
    }
    try {
      const link = n.link ? `${appUrl}${n.link}` : undefined;
      const sandbox = ctx.config.WAYLO_MODE === 'demo';
      const result =
        d.channel === 'email'
          ? await ctx.adapters.messaging.sendEmail({ to: email, subject: n.title, ...renderEmail({ title: n.title, body: n.body, ctaLabel: link ? 'Open in WAYLO' : undefined, ctaUrl: link, sandbox }) })
          : d.channel === 'sms'
            ? await ctx.adapters.messaging.sendSms({ to: phone!, body: `WAYLO: ${n.title}. ${n.body}`.slice(0, 300) })
            : await ctx.adapters.messaging.sendPush({ userId: n.userId, title: n.title, body: n.body, link: n.link });
      await ctx.db.update(notificationDeliveries).set({ status: 'sent', sentAt: now, providerMessageId: result.id, attempts: d.attempts + 1 }).where(eq(notificationDeliveries.id, d.id));
    } catch (err) {
      const attempts = d.attempts + 1;
      const giveUp = attempts >= BACKOFF_MINUTES.length;
      await ctx.db
        .update(notificationDeliveries)
        .set({
          attempts,
          status: giveUp ? 'failed' : 'queued',
          error: (err as Error).message.slice(0, 300),
          nextAttemptAt: new Date(now.getTime() + BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)]! * 60_000),
        })
        .where(eq(notificationDeliveries.id, d.id));
    }
  }
  return due.length;
}

export async function listNotifications(ctx: AppContext, userId: string, limit = 30) {
  const [items, [{ unread } = { unread: 0 }]] = await Promise.all([
    ctx.db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(limit),
    ctx.db.select({ unread: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);
  return { items, unread: Number(unread) };
}

export async function markRead(ctx: AppContext, userId: string, ids: string[] | 'all') {
  await ctx.db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), ids === 'all' ? sql`true` : inArray(notifications.id, ids)));
}
