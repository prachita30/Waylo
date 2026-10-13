import { realpathSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const here = realpathSync.native(import.meta.dirname);

export default defineConfig({
  root: here,
  resolve: {
    // Resolve the workspace package from source, independent of node_modules symlinks.
    alias: { '@waylo/shared': path.resolve(here, '../../packages/shared/src/index.ts') },
  },
  test: {
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
