/** Writes docs/openapi.json from the route source and shared schemas: `npm run docs:openapi`. */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApi } from '../src/docs/openapi';
import pkg from '../package.json';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/openapi.json');
const doc = buildOpenApi(pkg.version);
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
process.stdout.write(`Wrote ${path.relative(process.cwd(), out)} (${Object.keys(doc.paths as object).length} paths).\n`);
