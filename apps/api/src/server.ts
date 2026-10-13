import { createApp } from './app';
import { bootstrap } from './bootstrap';
import { startJobs } from './lib/jobs';
import { expireUnpaidBookings, pollPendingTicketing } from './modules/bookings/service';
import { sendQueuedDeliveries } from './modules/notifications/service';
import { processPendingRefunds } from './modules/payments/refunds';
import { releaseUnpaidSeats } from './modules/payments/ridePayments';
import { refreshFlightStatuses } from './modules/rides/flightAware';
import { lockDueGroups } from './modules/rides/groups';
import { expireUnmatchedRequests } from './modules/rides/requests';

const ctx = await bootstrap();
const app = createApp(ctx);
const server = app.listen(ctx.config.PORT, () => {
  ctx.logger.info(
    { port: ctx.config.PORT, mode: ctx.config.WAYLO_MODE, db: ctx.dbHandle.kind },
    `WAYLO API listening on http://localhost:${ctx.config.PORT}`,
  );
});

const stopJobs = startJobs(ctx, [
  { name: 'expire-unpaid-bookings', everyMs: 30_000, run: expireUnpaidBookings },
  { name: 'poll-ticketing', everyMs: 15_000, run: pollPendingTicketing },
  { name: 'expire-unmatched-ride-requests', everyMs: 60_000, run: expireUnmatchedRequests },
  { name: 'lock-due-ride-groups', everyMs: 30_000, run: lockDueGroups },
  { name: 'refresh-flight-status', everyMs: 120_000, run: refreshFlightStatuses },
  { name: 'process-refunds', everyMs: 20_000, run: (c) => processPendingRefunds(c) },
  { name: 'release-unpaid-seats', everyMs: 30_000, run: releaseUnpaidSeats },
  { name: 'send-notifications', everyMs: 10_000, run: (c) => sendQueuedDeliveries(c) },
]);

async function shutdown(signal: string) {
  ctx.logger.info({ signal }, 'shutting down');
  stopJobs();
  server.close();
  await ctx.dbHandle.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
