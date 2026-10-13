import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/server.ts', cli: 'src/db/cli.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle the workspace package (shipped as TypeScript source); keep npm deps external.
  noExternal: ['@waylo/shared'],
});
