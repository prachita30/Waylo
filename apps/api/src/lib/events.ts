import type { AppContext } from '../context';

/**
 * In-process domain events. Modules emit facts ("a rider was removed because their flight is
 * late"); other modules (notifications, analytics) subscribe. Handlers run after the emitting
 * transaction commits and their failures never break the emitter.
 */
export type DomainEvent =
  | { type: 'flight.status_changed'; flightId: string; status: string; estimatedArrivalAt: string | null; delayMinutes: number }
  | { type: 'ride.arrival_updated'; userId: string; requestId: string; expectedArrivalAt: string; delayMinutes: number }
  | { type: 'ride.pickup_rescheduled'; userIds: string[]; groupId: string; plannedPickupAt: string }
  | { type: 'ride.rider_removed'; userId: string; requestId: string; groupId: string; reason: 'flight_delay' | 'flight_cancelled' | 'no_show' | 'operator' | 'payment_timeout' }
  | { type: 'ride.group_locked'; userIds: string[]; groupId: string }
  | { type: 'ride.group_dissolved'; userId: string; groupId: string; requestId: string }
  | { type: 'ride.driver_assigned'; userIds: string[]; groupId: string; driverName: string; vehicle: string }
  | { type: 'ride.status_changed'; userIds: string[]; groupId: string; status: string }
  | { type: 'flight_booking.confirmed'; userId: string; bookingId: string; reference: string }
  | { type: 'flight_booking.ticketing_failed'; userId: string; bookingId: string; reference: string }
  | { type: 'flight_booking.cancelled'; userId: string; bookingId: string; reference: string; refundMinor: number | null }
  | { type: 'refund.processed'; userId: string; amountMinor: number; reference: string; succeeded: boolean }
  | { type: 'support.ticket_updated'; userId: string; ticketId: string; status: string };

type Handler = (ctx: AppContext, e: DomainEvent) => Promise<void> | void;
const handlers: Handler[] = [];

export function subscribe(handler: Handler) {
  handlers.push(handler);
}

export async function emit(ctx: AppContext, events: DomainEvent | DomainEvent[]) {
  for (const e of Array.isArray(events) ? events : [events]) {
    for (const h of handlers) {
      try {
        await h(ctx, e);
      } catch (err) {
        ctx.logger.error({ err, event: e.type }, 'event handler failed');
      }
    }
  }
}
