import { type Config, loadConfig } from './config';
import { type AppContext, assertAdaptersAllowed, type Adapters } from './context';
import { openDb } from './db/client';
import { createLogger } from './lib/logger';

export interface BootstrapOptions {
  config?: Config;
  /** Override database location (tests use 'memory://'). */
  pgliteDir?: string;
  migrate?: boolean;
}

export function buildAdapters(_config: Config): Adapters {
  return {};
}

export async function bootstrap(opts: BootstrapOptions = {}): Promise<AppContext> {
  const config = opts.config ?? loadConfig();
  const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === 'development');
  const adapters = buildAdapters(config);
  assertAdaptersAllowed(config, adapters);
  const dbHandle = await openDb({ databaseUrl: config.DATABASE_URL, pgliteDir: opts.pgliteDir ?? config.PGLITE_DIR });
  if (opts.migrate ?? true) await dbHandle.migrate();
  return { config, db: dbHandle.db, dbHandle, logger, adapters };
}
