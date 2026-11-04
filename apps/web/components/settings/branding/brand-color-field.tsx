'use client';

import { palettes } from '@vistar/shared';
import { Check, CircleAlert, CircleCheck, RotateCcw } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DEFAULT_BRAND_COLOR, deriveBrandTokens, type BrandDerivation } from '@/lib/branding';
import { formatOklch, normalizeHex } from '@/lib/branding/color';
import { cn } from '@/lib/cn';

export const BRAND_PRESETS: ReadonlyArray<{ hex: string; name: string }> = [
  { hex: '#4F46E5', name: 'Tootodo indigo' },
  { hex: '#1D4ED8', name: 'Royal blue' },
  { hex: '#0E7490', name: 'Teal' },
  { hex: '#059669', name: 'Emerald' },
  { hex: '#F59E0B', name: 'Saffron' },
  { hex: '#DC2626', name: 'Crimson' },
  { hex: '#C026D3', name: 'Magenta' },
  { hex: '#334155', name: 'Charcoal' },
];

function Ratio({ ratio, required }: { ratio: number; required: number }) {
  const pass = ratio >= required - 1e-9;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium tabular', pass ? 'text-success-text' : 'text-danger-text')}>
      {pass ? <CircleCheck aria-hidden className="size-3.5" /> : <CircleAlert aria-hidden className="size-3.5" />}
      {ratio.toFixed(1)}:1
      <span className="sr-only">{pass ? `passes, needs ${required}:1` : `fails, needs ${required}:1`}</span>
    </span>
  );
}

/** Button and link samples in one theme, drawn with the derived tokens. */
function ThemeSample({ d, theme }: { d: BrandDerivation; theme: 'light' | 'dark' }) {
  const t = d[theme];
  const p = palettes[theme];
  return (
    <div className="flex flex-1 flex-col gap-2 rounded-md border p-3" style={{ background: p.surface, borderColor: p.border, color: p.fg }}>
      <span className="text-2xs font-medium" style={{ color: p['muted-strong'] }}>
        {theme === 'light' ? 'Light theme' : 'Dark theme'}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium" style={{ background: t.accent, color: t['accent-fg'] }}>
          Save changes
        </span>
        <span className="text-xs font-medium underline underline-offset-2" style={{ color: t['accent-text'] }}>
          View lead
        </span>
        <span className="inline-flex h-6 items-center rounded-md px-2 text-xs font-medium" style={{ background: t['accent-soft'], color: t['accent-soft-fg'] }}>
          Selected
        </span>
        <span className="inline-flex h-6 items-center rounded-md px-2 text-xs" style={{ outline: `2px solid ${t.ring}`, outlineOffset: 2, color: p['fg-secondary'] }}>
          Focus
        </span>
      </span>
    </div>
  );
}

/**
 * Brand colour with the live AA check (D-060): the colour is moved in OKLCH lightness until white button
 * text, links, selected items and the focus ring pass in both themes, and the result is explained.
 */
export function BrandColorField({ value, onChange, disabled }: { value: string | null; onChange: (hex: string | null) => void; disabled?: boolean }) {
  const id = useId();
  const current = value ?? DEFAULT_BRAND_COLOR;
  const [text, setText] = useState(current);
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    setText(current);
  }
  const d = useMemo(() => deriveBrandTokens(current), [current]);
  const failing = d.checks.filter((c) => !c.pass);

  const commitText = (raw: string) => {
    setText(raw);
    const hex = normalizeHex(raw);
    if (hex) onChange(hex === DEFAULT_BRAND_COLOR ? null : hex);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-hex`} className="text-xs font-medium text-fg-secondary">
            Brand colour
          </label>
          <span className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Pick the brand colour"
              value={current.toLowerCase()}
              disabled={disabled}
              onChange={(e) => commitText(e.target.value)}
              className="focus-ring h-8 w-10 cursor-pointer rounded-md border border-input bg-surface p-0.5 disabled:cursor-not-allowed"
            />
            <Input
              id={`${id}-hex`}
              value={text}
              disabled={disabled}
              onChange={(e) => commitText(e.target.value)}
              aria-invalid={normalizeHex(text) ? undefined : true}
              aria-describedby={`${id}-oklch`}
              className="w-28 font-mono uppercase"
              maxLength={7}
              spellCheck={false}
            />
          </span>
        </div>
        <div role="radiogroup" aria-label="Suggested colours" className="flex flex-wrap items-center gap-1.5 pb-0.5">
          {BRAND_PRESETS.map((p) => {
            const on = p.hex === current;
            return (
              <button
                key={p.hex}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={p.name}
                title={p.name}
                disabled={disabled}
                onClick={() => commitText(p.hex)}
                className="focus-ring relative inline-flex size-7 items-center justify-center rounded-full border border-black/10 disabled:opacity-50"
                style={{ background: p.hex }}
              >
                {on && <Check aria-hidden className="size-3.5 text-white drop-shadow" />}
              </button>
            );
          })}
        </div>
        {value && (
          <Button variant="ghost" size="sm" onClick={() => onChange(null)} disabled={disabled} className="mb-0.5">
            <RotateCcw aria-hidden />
            Use Tootodo indigo
          </Button>
        )}
      </div>
      <p id={`${id}-oklch`} className="text-xs text-muted-strong">
        {formatOklch(current)}
      </p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <ThemeSample d={d} theme="light" />
        <ThemeSample d={d} theme="dark" />
      </div>

      <div role="status" aria-live="polite" className="rounded-md border border-border bg-surface-2 p-3">
        <p className="flex items-start gap-2 text-sm text-fg">
          {failing.length === 0 ? <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success-text" /> : <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger-text" />}
          <span>
            {d.adjusted ? (
              <>
                Adjusted for readability: lightness {d.inputLightness.toFixed(0)}% → {d.accentLightness.toFixed(0)}% ({d.input} → <span className="font-mono">{d.light.accent}</span>), so white text on buttons
                passes AA. The hue stays the same.
              </>
            ) : (
              <>Your colour is used as it is: white text on it already passes AA.</>
            )}{' '}
            {failing.length === 0 ? 'All checks pass in light and dark.' : `${failing.length} check${failing.length === 1 ? '' : 's'} still below AA.`}
          </span>
        </p>
        <table className="mt-2 w-full text-xs" aria-label="Contrast checks">
          <thead className="sr-only">
            <tr>
              <th scope="col">Theme</th>
              <th scope="col">Check</th>
              <th scope="col">Contrast</th>
            </tr>
          </thead>
          <tbody>
            {d.checks.map((c) => (
              <tr key={`${c.theme}-${c.label}`} className="border-t border-border first:border-t-0">
                <td className="py-1 pr-2 whitespace-nowrap text-muted-strong">{c.theme === 'light' ? 'Light' : 'Dark'}</td>
                <td className="py-1 pr-2 text-fg-secondary">
                  <span className="mr-1.5 inline-block size-2.5 rounded-xs align-middle" style={{ background: c.fg, boxShadow: `0 0 0 1px ${c.bg}` }} aria-hidden />
                  {c.label}
                </td>
                <td className="py-1 text-right">
                  <Ratio ratio={c.ratio} required={c.required} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
