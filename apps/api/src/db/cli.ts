import { rmSync } from 'node:fs';
import { loadConfig } from '../config';
import { openDb } from './client';
import { seed } from './seed';

const cmd = process.argv[2];
const config = loadConfig();

if (cmd === 'reset') {
  if (config.DATABASE_URL) {
    console.error('db:reset only deletes the embedded development database. Refusing to touch DATABASE_URL.');
    process.exit(1);
  }
  rmSync(config.PGLITE_DIR, { recursive: true, force: true });
  console.log(`Removed ${config.PGLITE_DIR}`);
}

const handle = await openDb({ databaseUrl: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR });
try {
  await handle.migrate();
  console.log(`Migrations applied (${handle.kind}).`);
  if (cmd === 'seed' || cmd === 'reset') {
    await seed(handle.db, { demo: config.WAYLO_MODE === 'demo' });
    console.log(config.WAYLO_MODE === 'demo' ? 'Reference and demo data loaded.' : 'Reference data loaded (production mode: no demo data).');
  }
} finally {
  await handle.close();
}
