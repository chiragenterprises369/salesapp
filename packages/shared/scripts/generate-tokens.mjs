// Generates apps/web/styles/tokens.css from src/design/tokens.ts. Run: pnpm --filter @vistar/shared tokens
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { darkPalette, lightPalette, motion, spacePalettes, spaceTokens } from '../dist/design/tokens.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', '..', 'apps', 'web', 'styles', 'tokens.css');

const block = (palette) =>
  Object.entries(palette)
    .map(([k, v]) => `  --${k}: ${v};`)
    .join('\n');

const px = (n) => `${n}px`;

const css = `/* GENERATED from packages/shared/src/design/tokens.ts. Do not edit by hand.
   Regenerate: pnpm --filter @vistar/shared tokens */

:root,
[data-theme='light'] {
  color-scheme: light;
${block(lightPalette)}
  /* Space layer, glass and depth (Depth style; Neon Space overrides below). */
${block(spacePalettes.depth.light)}
}

[data-theme='dark'] {
  color-scheme: dark;
${block(darkPalette)}
${block(spacePalettes.depth.dark)}
}

/* Neon Space. Light theme = "Aurora": pastel glass, coloured edges and shadows, no glow. */
[data-interface-style='neon']:not([data-theme='dark']) {
${block(spacePalettes.neon.light)}
}

[data-interface-style='neon'][data-theme='dark'] {
${block(spacePalettes.neon.dark)}
}

:root {
  /* Motion. Radii and type scale live in styles/theme.css (Tailwind @theme). */
  --duration-fast: ${motion.fast}ms;
  --duration: ${motion.base}ms;
  --duration-slow: ${motion.slow}ms;
  --duration-page: ${motion.page}ms;
  --duration-page-exit: ${motion.pageExit}ms;
  --duration-fade: ${motion.fade}ms;
  --easing: ${motion.easing};
  --easing-glide: ${motion.easingGlide};
  --easing-exit: ${motion.easingExit};

  /* Depth limits (hard caps, D-053). */
  --glass-blur: ${px(spaceTokens.glassBlur)};
  --blur-max: ${px(spaceTokens.blurMax)};
  --glow-blur-max: ${px(spaceTokens.glowBlurMax)};
  --glow-alpha-max: ${spaceTokens.glowAlphaMax};
  --parallax-far: ${px(spaceTokens.parallax.far)};
  --parallax-mid: ${px(spaceTokens.parallax.mid)};
  --parallax-near: ${px(spaceTokens.parallax.near)};
  --parallax-sheen: ${px(spaceTokens.parallax.sheen)};
  --tilt-max: ${spaceTokens.tiltMax}deg;
  --lift-y: ${px(-spaceTokens.lift)};
  --page-enter-shift: ${px(spaceTokens.page.enterShift)};
  --page-enter-scale: ${spaceTokens.page.enterScale};
  --page-exit-scale: ${spaceTokens.page.exitScale};
}

/* Motion intensity "reduced": fades only, no travel. "off" also sets data-reduced-motion="on". */
[data-motion='reduced'],
[data-motion='off'] {
  --parallax-far: 0px;
  --parallax-mid: 0px;
  --parallax-near: 0px;
  --parallax-sheen: 0px;
  --tilt-max: 0deg;
  --lift-y: 0px;
  --page-enter-shift: 0px;
  --page-enter-scale: 1;
  --page-exit-scale: 1;
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
