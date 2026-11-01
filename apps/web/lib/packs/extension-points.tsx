'use client';

import type { RuntimeNavItem, WidgetSlot as WidgetSlotId } from '@vistar/shared';
import { PackageX } from 'lucide-react';
import { Component, lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { usePackRuntime } from './hooks';
import { PACK_UI, type PackComponentProps } from './ui-index';

/**
 * UI extension points for Industry Packs (SPEC 22.4). OWNER: orchestrator.
 * - <PackPage packKey path /> renders the component of a pack navigation item (route /app/x/<pack>/<...page>).
 * - <WidgetSlot slot /> renders every active pack widget for a slot (dashboard, lead detail, ...).
 * Missing packs/components show a neutral state; a crashing pack component never takes the page down.
 */
/** Lazy components for every registered id, created once at module load (never during render). */
const PACK_COMPONENTS: Readonly<Record<string, LazyExoticComponent<ComponentType<PackComponentProps>>>> = Object.fromEntries(
  Object.entries(PACK_UI).map(([id, loader]) => [id, lazy(loader)]),
);

class PackErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Unavailable({ title, body, compact }: { title: string; body: string; compact?: boolean }) {
  return (
    <div role="status" className={cn('flex flex-col items-center justify-center gap-2 text-center', compact ? 'py-6' : 'min-h-[40vh] py-12')}>
      <PackageX aria-hidden className="size-8 text-muted" />
      <p className="text-sm font-semibold text-fg">{title}</p>
      <p className="max-w-sm text-sm text-muted">{body}</p>
    </div>
  );
}

/** Match "/app/x/<packKey>/<page...>" segments against the runtime nav items (longest page wins). */
export function resolvePackPage(items: readonly RuntimeNavItem[], packKey: string, segments: readonly string[]) {
  const path = segments.join('/');
  const candidates = items.filter((i) => i.packKey === packKey && (path === i.page || path.startsWith(`${i.page}/`))).sort((a, b) => b.page.length - a.page.length);
  const item = candidates[0];
  if (!item) return null;
  const rest = path.slice(item.page.length).split('/').filter(Boolean);
  return { item, params: rest };
}

export function PackPage({ packKey, segments, panel = 'company' }: { packKey: string; segments: readonly string[]; panel?: 'company' | 'employee' }) {
  const rt = usePackRuntime();
  if (rt.isPending) return <Skeleton className="h-[60vh] w-full" />;
  if (rt.isError) return <Unavailable title="Could not load this page" body="Check your connection and try again." />;
  const active = rt.data.packs.find((p) => p.key === packKey);
  const match = active ? resolvePackPage(rt.data.navigation.filter((n) => n.panels.includes(panel)), packKey, segments) : null;
  if (!active || !match) return <Unavailable title="This page is not available" body="The pack that provides it is not active in your workspace, or you do not have access." />;
  const C = PACK_COMPONENTS[match.item.component];
  if (!C) return <Unavailable title="Not available yet" body={`${match.item.label} is part of a pack whose screens are still being built.`} />;
  return (
    <PackErrorBoundary fallback={<Unavailable title="Something went wrong" body={`${match.item.label} failed to load. The rest of the app keeps working.`} />}>
      <Suspense fallback={<Skeleton className="h-[60vh] w-full" />}>
        <C packKey={packKey} modes={active.modes} page={match.item.page} params={match.params} title={match.item.label} />
      </Suspense>
    </PackErrorBoundary>
  );
}

export function WidgetSlot({ slot, className }: { slot: WidgetSlotId; className?: string }) {
  const rt = usePackRuntime();
  const widgets = rt.data?.widgets.filter((w) => w.slot === slot) ?? [];
  if (!widgets.length) return null;
  return (
    <div data-widget-slot={slot} className={cn('grid gap-4', className)}>
      {widgets.map((w) => {
        const C = PACK_COMPONENTS[w.component];
        const modes = rt.data?.packs.find((p) => p.key === w.packKey)?.modes ?? [];
        const fallback = (
          <Card>
            <CardHeader>
              <CardTitle>{w.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <Unavailable compact title="Not available yet" body="This widget is still being built." />
            </CardContent>
          </Card>
        );
        return (
          <div key={`${w.packKey}:${w.key}`} data-widget={`${w.packKey}.${w.key}`} data-size={w.size}>
            {C ? (
              <PackErrorBoundary fallback={fallback}>
                <Suspense fallback={<Skeleton className="h-32 w-full" />}>
                  <C packKey={w.packKey} modes={modes} slot={slot} title={w.title} />
                </Suspense>
              </PackErrorBoundary>
            ) : (
              fallback
            )}
          </div>
        );
      })}
    </div>
  );
}
