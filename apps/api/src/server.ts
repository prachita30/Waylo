import { createApp } from './app';
import { bootstrap } from './bootstrap';
import { startJobs } from './lib/jobs';
import { expireUnpaidBookings, pollPendingTicketing } from './modules/bookings/service';

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
