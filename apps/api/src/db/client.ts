import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema';

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export interface DbHandle {
  db: Db;
  kind: 'postgres' | 'pglite';
  migrate(): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

/** Finds apps/api/drizzle whether running from src/db (tsx) or dist (bundled). */
function findMigrationsDir(): string {
  if (process.env.WAYLO_MIGRATIONS_DIR) return process.env.WAYLO_MIGRATIONS_DIR;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, 'drizzle');
    if (existsSync(path.join(candidate, 'meta', '_journal.json'))) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('Could not locate the drizzle migrations folder; set WAYLO_MIGRATIONS_DIR.');
}

export interface DbOptions {
  databaseUrl?: string;
  /** Directory for embedded PGlite data, or 'memory://' for an in-memory database (tests). */
  pgliteDir?: string;
}

export async function openDb(opts: DbOptions): Promise<DbHandle> {
  if (opts.databaseUrl) {
    const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 10 });
    const db = drizzlePg(pool, { schema }) as unknown as Db;
    return {
      db,
      kind: 'postgres',
      migrate: () => migratePg(db as never, { migrationsFolder: findMigrationsDir() }),
      ping: async () => (await pool.query('select 1')).rowCount === 1,
      close: () => pool.end(),
    };
  }
  const dir = opts.pgliteDir ?? 'memory://';
  if (!dir.startsWith('memory://')) mkdirSync(dir, { recursive: true });
  const client = await PGlite.create(dir);
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  return {
    db,
    kind: 'pglite',
    migrate: () => migratePglite(db as never, { migrationsFolder: findMigrationsDir() }),
    ping: async () => (await client.query('select 1')).rows.length === 1,
    close: () => client.close(),
  };
}
