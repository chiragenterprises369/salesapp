// Generates packages/shared/openapi/openapi.{json,yaml} from API_ROUTES. Run: pnpm openapi
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { buildOpenApiDocument } from '../dist/api/openapi.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'openapi');
mkdirSync(outDir, { recursive: true });

const doc = buildOpenApiDocument();
writeFileSync(join(outDir, 'openapi.json'), JSON.stringify(doc, null, 2) + '\n');
writeFileSync(join(outDir, 'openapi.yaml'), stringify(doc));
console.info(`OpenAPI: ${Object.keys(doc.paths ?? {}).length} paths -> ${outDir}`);
