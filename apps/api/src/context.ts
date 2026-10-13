import type { Config } from './config';
import type { Db, DbHandle } from './db/client';
import type { Logger } from './lib/logger';

/** How an external integration is backed. Sandbox implementations are always labelled in the UI. */
export type AdapterMode = 'sandbox' | 'live';

export interface AdapterInfo {
  /** Stable key, e.g. "airline", "payments". */
  kind: string;
  provider: string;
  mode: AdapterMode;
}

export interface Adapter {
  readonly info: AdapterInfo;
}

/** Registered integrations. Each later module adds its adapter here. */
export type Adapters = Record<string, Adapter>;

export interface AppContext {
  config: Config;
  db: Db;
  dbHandle: DbHandle;
  logger: Logger;
  adapters: Adapters;
}

/**
 * Production mode must fail safely: refuse to start when any registered
 * integration is still a sandbox implementation.
 */
export function assertAdaptersAllowed(config: Config, adapters: Adapters): void {
  if (config.WAYLO_MODE !== 'production') return;
  const sandboxed = Object.values(adapters).filter((a) => a.info.mode === 'sandbox');
  if (sandboxed.length) {
    const names = sandboxed.map((a) => `${a.info.kind}:${a.info.provider}`).join(', ');
    throw new Error(`WAYLO_MODE=production but these integrations are sandbox-only: ${names}. Configure live adapters or run in demo mode.`);
  }
}
