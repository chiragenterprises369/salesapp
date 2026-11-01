// Generates apps/web/styles/tokens.css from src/design/tokens.ts. Run: pnpm --filter @vistar/shared tokens
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { darkPalette, lightPalette, motion } from '../dist/design/tokens.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', '..', 'apps', 'web', 'styles', 'tokens.css');

const block = (palette) =>
  Object.entries(palette)
    .map(([k, v]) => `  --${k}: ${v};`)
    .join('\n');

const css = `/* GENERATED from packages/shared/src/design/tokens.ts. Do not edit by hand.
   Regenerate: pnpm --filter @vistar/shared tokens */

:root,
[data-theme='light'] {
  color-scheme: light;
${block(lightPalette)}
}

[data-theme='dark'] {
  color-scheme: dark;
${block(darkPalette)}
}

:root {
  /* Motion. Radii and type scale live in styles/theme.css (Tailwind @theme). */
  --duration-fast: ${motion.fast}ms;
  --duration: ${motion.base}ms;
  --duration-slow: ${motion.slow}ms;
  --easing: ${motion.easing};
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-fast: 0ms;
    --duration: 0ms;
    --duration-slow: 0ms;
  }
}

[data-reduced-motion='on'] {
  --duration-fast: 0ms;
  --duration: 0ms;
  --duration-slow: 0ms;
}
`;

writeFileSync(out, css);
console.info(`tokens.css -> ${out}`);
