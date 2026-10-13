import { createApp } from './app';
import { bootstrap } from './bootstrap';

const ctx = await bootstrap();
const app = createApp(ctx);
const server = app.listen(ctx.config.PORT, () => {
  ctx.logger.info(
    { port: ctx.config.PORT, mode: ctx.config.WAYLO_MODE, db: ctx.dbHandle.kind },
    `WAYLO API listening on http://localhost:${ctx.config.PORT}`,
  );
});

async function shutdown(signal: string) {
  ctx.logger.info({ signal }, 'shutting down');
  server.close();
  await ctx.dbHandle.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
