'use client';

import { palettes } from '@vistar/shared';
import { Search } from 'lucide-react';
import type { CSSProperties } from 'react';
import { LogoMark } from '@/components/shell/logo';
import { resolveBrandColors, type WorkspaceBranding } from '@/lib/branding';

/**
 * Live preview of the draft branding in both themes: sidebar with logo and selected item, top bar,
 * primary button, link, chips and the chart palette. Colours come from the same derivation the app
 * applies after saving.
 */
function Frame({ draft, theme, name }: { draft: WorkspaceBranding; theme: 'light' | 'dark'; name: string }) {
  const p = palettes[theme];
  const brand = resolveBrandColors(draft)?.[theme] ?? {};
  const c = (k: keyof typeof p) => (brand as Record<string, string | undefined>)[k] ?? p[k];
  const logo = theme === 'dark' ? (draft.logoDarkUrl ?? draft.logoLightUrl) : (draft.logoLightUrl ?? draft.logoDarkUrl);
  const vars = { '--accent': c('accent'), '--accent-fg': c('accent-fg') } as CSSProperties;
  return (
    <figure className="flex min-w-0 flex-1 flex-col gap-1.5">
      <figcaption className="text-xs font-medium text-fg-secondary">{theme === 'light' ? 'Light theme' : 'Dark theme'}</figcaption>
      <div aria-hidden className="flex h-48 overflow-hidden rounded-md border text-[11px]" style={{ ...vars, background: p.bg, borderColor: p.border, color: p.fg }}>
        <div className="flex w-[34%] shrink-0 flex-col gap-1 border-r p-2" style={{ background: p.surface, borderColor: p.border }}>
          <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="h-5 w-auto max-w-16 object-contain" />
            ) : (
              <LogoMark className="size-5" />
            )}
            <span className="truncate font-semibold">{name}</span>
          </div>
          <span className="rounded-sm px-1.5 py-1 font-medium" style={{ background: c('accent-soft'), color: c('accent-soft-fg') }}>
            Leads
          </span>
          {['Dashboard', 'Tasks', 'Reports'].map((l) => (
            <span key={l} className="px-1.5 py-0.5" style={{ color: p['fg-secondary'] }}>
              {l}
            </span>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-7 items-center gap-1 border-b px-2" style={{ background: p.surface, borderColor: p.border }}>
            <span className="flex h-4 flex-1 items-center gap-1 rounded-xs border px-1" style={{ borderColor: p['input-border'], color: p['muted-strong'] }}>
              <Search className="size-2.5" /> Search
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-2 p-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold">Leads</span>
              <span className="rounded-sm px-1.5 py-0.5 font-medium" style={{ background: c('accent'), color: c('accent-fg') }}>
                New lead
              </span>
            </div>
            <div className="flex flex-col gap-1 rounded-sm border p-1.5" style={{ background: p.surface, borderColor: p.border }}>
              <span className="flex items-center justify-between">
                <span>Mehta Traders</span>
                <span className="underline" style={{ color: c('accent-text') }}>
                  Open
                </span>
              </span>
              <span className="flex h-8 items-end gap-0.5">
                {(['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'] as const).map((s, i) => (
                  <span key={s} className="flex-1 rounded-t-[2px]" style={{ height: `${[70, 95, 50, 80, 40, 60][i]}%`, background: c(s) }} />
                ))}
              </span>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}

export function BrandPreview({ draft, name }: { draft: WorkspaceBranding; name: string }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row xl:flex-col 3xl:flex-row">
      <Frame draft={draft} theme="light" name={name} />
      <Frame draft={draft} theme="dark" name={name} />
    </div>
  );
}
