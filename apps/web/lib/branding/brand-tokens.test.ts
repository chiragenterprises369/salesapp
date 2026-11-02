import { describe, expect, it } from 'vitest';
import { brandCss, resolveBrandColors } from './brand-css';
import { CHART_PALETTE_PRESETS, chartContrast, deriveBrandTokens, deriveChartPalette } from './brand-tokens';
import { contrast, hexToOklch, normalizeHex, oklchToHex } from './color';

describe('color', () => {
  it('normalises hex and round-trips through OKLCH', () => {
    expect(normalizeHex('#abc')).toBe('#AABBCC');
    expect(normalizeHex('4f46e5')).toBe('#4F46E5');
    expect(normalizeHex('#12345')).toBeNull();
    for (const hex of ['#4F46E5', '#0F172A', '#FACC15', '#22C55E', '#FFFFFF', '#000000', '#E11D48']) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
  });

  it('computes WCAG contrast', () => {
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
    expect(contrast('#4F46E5', '#FFFFFF')).toBeGreaterThan(6);
  });
});

describe('deriveBrandTokens', () => {
  it('keeps the Vistar indigo as it is', () => {
    const d = deriveBrandTokens('#4F46E5');
    expect(d.adjusted).toBe(false);
    expect(d.light.accent).toBe('#4F46E5');
    expect(d.checks.every((c) => c.pass)).toBe(true);
  });

  it.each(['#FACC15', '#22C55E', '#06B6D4', '#F97316', '#EC4899', '#0F172A', '#A3E635', '#FFFFFF'])('passes AA in both themes for %s', (hex) => {
    const d = deriveBrandTokens(hex);
    expect(d.checks.filter((c) => !c.pass)).toEqual([]);
    expect(contrast('#FFFFFF', d.light.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('darkens light brand colours and keeps their hue', () => {
    const d = deriveBrandTokens('#FACC15');
    expect(d.adjusted).toBe(true);
    expect(d.accentLightness).toBeLessThan(d.inputLightness);
    const inH = hexToOklch('#FACC15').h;
    const outH = hexToOklch(d.light.accent).h;
    expect(Math.abs(inH - outH)).toBeLessThan(12);
  });
});

describe('chart palettes', () => {
  it.each(CHART_PALETTE_PRESETS.map((p) => [p.id, p.colors] as const))('%s reaches 3:1 on cards in both themes', (_id, colors) => {
    const c = chartContrast(deriveChartPalette(colors));
    expect(c.light).toBeGreaterThanOrEqual(3);
    expect(c.dark).toBeGreaterThanOrEqual(3);
  });
});

describe('brandCss', () => {
  it('is empty without a brand and scoped to data-brand otherwise', () => {
    expect(brandCss(resolveBrandColors({ brandColor: null, chartPalette: null }))).toBe('');
    const css = brandCss(resolveBrandColors({ brandColor: '#0E9F6E', chartPalette: null }));
    expect(css).toContain("html[data-brand][data-theme='light']");
    expect(css).toContain('--accent:');
    expect(css).toContain("html[data-brand][data-theme='dark']");
  });
});
