import { randomBytes } from 'node:crypto';
import { SandboxAirlineAdapter } from './adapters/airline/sandbox';
import { SandboxPaymentAdapter } from './adapters/payments/sandbox';
import { type Config, loadConfig } from './config';
import { type AppContext, assertAdaptersAllowed, type Adapters } from './context';
import { openDb } from './db/client';
import { createLogger } from './lib/logger';
import { handleWebhook } from './modules/payments/service';

export interface BootstrapOptions {
  config?: Config;
  /** Override database location (tests use 'memory://'). */
  pgliteDir?: string;
  migrate?: boolean;
  /** Replace specific integrations (tests). */
  adapters?: Partial<Adapters>;
}

/**
 * Wires integrations. Only sandbox implementations exist today; live adapters are added here
 * once a partner grants access, selected by environment configuration.
 */
export function buildAdapters(config: Config): Adapters {
  // Outside production a random per-process secret is acceptable for the sandbox provider.
  const webhookSecret = config.PAYMENT_WEBHOOK_SECRET ?? randomBytes(24).toString('hex');
  return {
    airline: new SandboxAirlineAdapter(),
    payments: new SandboxPaymentAdapter(webhookSecret),
  };
}

export async function bootstrap(opts: BootstrapOptions = {}): Promise<AppContext> {
  const config = opts.config ?? loadConfig();
  const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === 'development');
  const adapters = { ...buildAdapters(config), ...opts.adapters };
  assertAdaptersAllowed(config, adapters);
  const dbHandle = await openDb({ databaseUrl: config.DATABASE_URL, pgliteDir: opts.pgliteDir ?? config.PGLITE_DIR });
  if (opts.migrate ?? true) await dbHandle.migrate();
  const ctx: AppContext = { config, db: dbHandle.db, dbHandle, logger, adapters };
  // The sandbox provider "sends" webhooks by calling the same handler the HTTP endpoint uses.
  if (adapters.payments instanceof SandboxPaymentAdapter) {
    adapters.payments.deliver = async (raw, sig) => {
      await handleWebhook(ctx, raw, sig);
    };
  }
  return ctx;
}
