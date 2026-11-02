'use client';

import { Columns2, ExternalLink, PictureInPicture2, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { Tooltip } from '@/components/common/tooltip';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { ModuleDef } from './modules';
import type { DockLayout, ModuleId } from './store';
import { isTypingTarget, modalOpen } from './use-fullscreen';

/**
 * The panel area of the floor workspace: open modules as tabs, the active module's page below. Used
 * docked beside the floor, floating over it, or inside a sheet on small screens. Only the active module
 * is mounted (switching back is instant: the data stays in the query cache).
 */
export function ModuleDock({
  id,
  modules,
  tabs,
  active,
  layout,
  onActivate,
  onClose,
  onLayout,
  leadsKey,
  autoFocusKey,
  className,
  showLayoutToggle = true,
}: {
  /** id of the panel element (the resize handle controls it). */
  id: string;
  modules: readonly ModuleDef[];
  tabs: readonly ModuleId[];
  active: ModuleId;
  layout: DockLayout;
  onActivate: (m: ModuleId) => void;
  onClose: (m: ModuleId) => void;
  onLayout: (l: DockLayout) => void;
  leadsKey: number;
  /** Changes when a module was opened from outside: focus moves to the panel. */
  autoFocusKey: number;
  className?: string;
  showLayoutToggle?: boolean;
}) {
  const uid = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<ModuleId, HTMLButtonElement>());
  const open = tabs.map((t) => modules.find((m) => m.id === t)).filter((m): m is ModuleDef => !!m);
  const def = open.find((m) => m.id === active) ?? open[0];

  useEffect(() => {
    if (autoFocusKey > 0) bodyRef.current?.focus({ preventScroll: true });
  }, [autoFocusKey]);

  if (!def) return null;
  const tabId = (m: ModuleId) => `${uid}-tab-${m}`;
  const panelId = `${uid}-panel`;
  const Body = def.Component;

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, m: ModuleId) => {
    const i = open.findIndex((x) => x.id === m);
    let next: ModuleDef | undefined;
    if (e.key === 'ArrowRight') next = open[(i + 1) % open.length];
    else if (e.key === 'ArrowLeft') next = open[(i - 1 + open.length) % open.length];
    else if (e.key === 'Home') next = open[0];
    else if (e.key === 'End') next = open[open.length - 1];
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const after = open[i + 1] ?? open[i - 1];
      onClose(m);
      if (after) requestAnimationFrame(() => tabRefs.current.get(after.id)?.focus());
      return;
    }
    if (!next) return;
    e.preventDefault();
    onActivate(next.id);
    tabRefs.current.get(next.id)?.focus();
  };

  return (
    <section
      id={id}
      aria-label={`${def.label} panel`}
      data-floor-dock={layout}
      className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface', layout === 'float' ? 'shadow-overlay' : 'shadow-card', className)}
      onKeyDown={(e) => {
        // Esc closes the active panel unless a field, menu or dialog inside handles it.
        if (e.key !== 'Escape' || e.defaultPrevented || isTypingTarget(e.target) || modalOpen()) return;
        e.stopPropagation();
        onClose(def.id);
      }}
    >
      <header data-slot="panel-head" className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-1.5">
        <div role="tablist" aria-label="Open panels" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {open.map((m) => {
            const selected = m.id === def.id;
            const Icon = m.icon;
            return (
              <div key={m.id} className={cn('group flex shrink-0 items-center rounded-md', selected ? 'bg-accent-soft' : 'hover:bg-surface-2')}>
                <button
                  ref={(el) => {
                    if (el) tabRefs.current.set(m.id, el);
                    else tabRefs.current.delete(m.id);
                  }}
                  type="button"
                  role="tab"
                  id={tabId(m.id)}
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onActivate(m.id)}
                  onKeyDown={(e) => onTabKey(e, m.id)}
                  className={cn(
                    'focus-ring inline-flex h-8 items-center gap-1.5 rounded-md pr-1 pl-2 text-sm font-medium',
                    selected ? 'text-accent-soft-fg' : 'text-fg-secondary hover:text-fg',
                  )}
                >
                  <Icon aria-hidden className="size-4" />
                  {m.label}
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Close ${m.label} panel`}
                  onClick={() => onClose(m.id)}
                  className="mr-1 inline-flex size-6 items-center justify-center rounded-sm text-muted-strong hover:bg-surface-3 hover:text-fg [&_svg]:size-3.5"
                >
                  <X aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
        {showLayoutToggle && (
          <Tooltip content={layout === 'dock' ? 'Float over the floor' : 'Dock beside the floor'} side="bottom">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={layout === 'dock' ? 'Float the panel over the floor' : 'Dock the panel beside the floor'}
              onClick={() => onLayout(layout === 'dock' ? 'float' : 'dock')}
            >
              {layout === 'dock' ? <PictureInPicture2 aria-hidden /> : <Columns2 aria-hidden />}
            </Button>
          </Tooltip>
        )}
        <Tooltip content="Open as a page (leaves the floor)" side="bottom">
          <Button size="icon-sm" variant="ghost" asChild>
            <Link href={def.href} aria-label={`Open ${def.label} as a page`} data-floor-leave="">
              <ExternalLink aria-hidden />
            </Link>
          </Button>
        </Tooltip>
        <Tooltip content="Close panel (Esc)" side="bottom">
          <Button size="icon-sm" variant="ghost" aria-label={`Close ${def.label} panel`} onClick={() => onClose(def.id)}>
            <X aria-hidden />
          </Button>
        </Tooltip>
      </header>
      <div
        ref={bodyRef}
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(def.id)}
        tabIndex={-1}
        className={cn('min-h-0 flex-1 overflow-auto outline-none', !def.flush && 'p-4')}
      >
        <Body key={def.id === 'leads' ? `leads-${leadsKey}` : def.id} />
      </div>
    </section>
  );
}
