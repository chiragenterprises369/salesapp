'use client';

import { palettes } from '@vistar/shared';
import { Check, CircleCheck } from 'lucide-react';
import { RadioGroup } from 'radix-ui';
import { useMemo } from 'react';
import { CHART_PALETTE_PRESETS, CHART_SLOTS, chartContrast, deriveChartPalette, type ChartPaletteChoice } from '@/lib/branding';
import { normalizeHex } from '@/lib/branding/color';
import { cn } from '@/lib/cn';

const BARS = [62, 88, 48, 74, 36, 56];

function MiniChart({ colors, theme }: { colors: Record<(typeof CHART_SLOTS)[number], string>; theme: 'light' | 'dark' }) {
  const p = palettes[theme];
  return (
    <div className="flex flex-1 flex-col gap-1.5 rounded-md border p-2.5" style={{ background: p.surface, borderColor: p.border }}>
      <span className="text-2xs font-medium" style={{ color: p['muted-strong'] }}>
        {theme === 'light' ? 'Light theme' : 'Dark theme'}
      </span>
      <span className="flex h-16 items-end gap-1.5 border-b" style={{ borderColor: p['chart-grid'] }}>
        {CHART_SLOTS.map((s, i) => (
          <span key={s} className="flex-1 rounded-t-xs" style={{ height: `${BARS[i]}%`, background: colors[s] }} />
        ))}
      </span>
    </div>
  );
}

/** Dashboard and chart colours: presets (incl. a colour-blind safe set) or six custom colours, checked for 3:1 on cards. */
export function ChartPaletteField({
  value,
  brandColor,
  onChange,
  disabled,
}: {
  value: ChartPaletteChoice | null;
  brandColor: string | null;
  onChange: (v: ChartPaletteChoice | null) => void;
  disabled?: boolean;
}) {
  const preset = value?.preset ?? 'vistar';
  const base = useMemo(() => {
    const colors = [...(value?.colors ?? CHART_PALETTE_PRESETS[0]!.colors)];
    if (preset === 'brand' && brandColor) colors[0] = brandColor;
    return colors;
  }, [value, preset, brandColor]);
  const derived = useMemo(() => deriveChartPalette(base), [base]);
  const check = chartContrast(derived);

  const pick = (id: string) => {
    if (id === 'vistar') return onChange(null);
    if (id === 'custom') return onChange({ preset: 'custom', colors: [...base] });
    const p = CHART_PALETTE_PRESETS.find((x) => x.id === id)!;
    onChange({ preset: id, colors: [...p.colors] });
  };

  const options = [...CHART_PALETTE_PRESETS.map((p) => ({ id: p.id, label: p.label, hint: p.hint, colors: p.id === 'brand' && brandColor ? [brandColor, ...p.colors.slice(1)] : [...p.colors] })), { id: 'custom', label: 'Custom', hint: 'Pick each of the six series colours', colors: base }];

  return (
    <div className="flex flex-col gap-4">
      <RadioGroup.Root value={preset} onValueChange={pick} aria-label="Chart palette" disabled={disabled} className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
        {options.map((o) => (
          <RadioGroup.Item
            key={o.id}
            value={o.id}
            className={cn(
              'focus-ring group flex flex-col items-stretch gap-2 rounded-md border border-border bg-surface p-2.5 text-left',
              'transition-[border-color,background-color] duration-150 ease-standard hover:border-border-strong hover:bg-surface-2',
              'data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            <span aria-hidden className="flex h-3 overflow-hidden rounded-xs">
              {o.colors.map((c, i) => (
                <span key={i} className="flex-1" style={{ background: c }} />
              ))}
            </span>
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-fg group-data-[state=checked]:text-accent-soft-fg">{o.label}</span>
                <span className="block text-xs text-muted group-data-[state=checked]:text-muted-strong">{o.hint}</span>
              </span>
              <RadioGroup.Indicator className="mt-0.5 shrink-0">
                <Check aria-hidden className="size-4 text-accent-soft-fg" />
              </RadioGroup.Indicator>
            </span>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>

      {preset === 'custom' && (
        <fieldset className="flex flex-wrap gap-3" disabled={disabled}>
          <legend className="mb-1.5 text-xs font-medium text-fg-secondary">Series colours</legend>
          {CHART_SLOTS.map((s, i) => (
            <label key={s} className="flex items-center gap-1.5 text-xs text-fg-secondary">
              <input
                type="color"
                value={(normalizeHex(base[i] ?? '') ?? '#64748B').toLowerCase()}
                onChange={(e) => {
                  const colors = [...base];
                  colors[i] = e.target.value.toUpperCase();
                  onChange({ preset: 'custom', colors });
                }}
                className="focus-ring h-8 w-10 cursor-pointer rounded-md border border-input bg-surface p-0.5"
              />
              Series {i + 1}
            </label>
          ))}
        </fieldset>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <MiniChart colors={derived.light} theme="light" />
        <MiniChart colors={derived.dark} theme="dark" />
      </div>
      <p role="status" className="flex items-start gap-2 text-xs text-muted-strong">
        <CircleCheck aria-hidden className="mt-px size-3.5 shrink-0 text-success-text" />
        Every series reaches at least 3:1 against cards (light {check.light.toFixed(1)}:1, dark {check.dark.toFixed(1)}:1); colours were adjusted in lightness where needed. Charts also
        keep their table equivalents.
      </p>
    </div>
  );
}
