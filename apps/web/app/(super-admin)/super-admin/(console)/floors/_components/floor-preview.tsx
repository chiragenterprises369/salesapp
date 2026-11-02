'use client';

import type { ResolvedTheme } from '@vistar/shared';
import { Moon, Sun } from 'lucide-react';
import dynamic from 'next/dynamic';
import { Component, useCallback, useMemo, useState, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { FloorMap } from '@/features/team-floor/flat/floor-map';
import { detectGpu } from '@/features/team-floor/state/env';
import { previewFloorState } from '@/features/team-floor/state/layout/preview';
import type { FloorTemplate } from '@/features/team-floor/state/template';

// three.js stays in this lazily loaded chunk (same scene as the live Team Floor).
const FloorScene = dynamic(() => import('@/features/team-floor/scene/floor-scene'), {
  ssr: false,
  loading: () => (
    <Skeleton className="absolute inset-0 rounded-none" aria-label="Loading the 3D preview" />
  ),
});

class PreviewBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    this.props.onError();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

const NOOP = () => {};
const NO_ATTENTION = new Map();

/** 3D and flat preview of a floor version as the company will see it, in the Day and Evening looks. */
export function FloorPreview({
  template,
  problem,
  loading,
}: {
  template: FloorTemplate | null;
  problem: string | null;
  loading: boolean;
}) {
  const [mode, setMode] = useState<'3d' | 'flat'>('3d');
  const [look, setLook] = useState<ResolvedTheme>('light');
  const [people, setPeople] = useState(true);
  const [failed, setFailed] = useState(false);
  const [gpu] = useState(detectGpu);
  const reducedMotion = useReducedMotion();
  const state = useMemo(
    () => (template ? previewFloorState(template, { withPeople: people }) : null),
    [template, people],
  );
  const onLost = useCallback(() => setFailed(true), []);
  const can3d = gpu.webgl && !failed;
  const view = can3d ? mode : 'flat';

  return (
    <Card className="flex min-w-0 flex-col" data-floor-preview={view} data-look={look}>
      <CardHeader className="flex-wrap">
        <CardTitle>Preview</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Preview view"
            value={view}
            onChange={(v) => setMode(v as '3d' | 'flat')}
            options={[
              { value: '3d', label: '3D', disabled: !can3d },
              { value: 'flat', label: 'Flat plan' },
            ]}
          />
          <Segmented
            label="Light look"
            value={look}
            onChange={(v) => setLook(v as ResolvedTheme)}
            options={[
              { value: 'light', label: 'Day', icon: <Sun aria-hidden /> },
              { value: 'dark', label: 'Evening', icon: <Moon aria-hidden /> },
            ]}
          />
          <label className="flex items-center gap-1.5 text-xs text-fg-secondary">
            <input
              type="checkbox"
              checked={people}
              onChange={(e) => setPeople(e.target.checked)}
              className="focus-ring size-4 accent-[var(--accent)]"
            />
            Stand-in people at the desks
          </label>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {!can3d && mode === '3d' && (
          <p className="text-xs text-muted-strong">
            {failed
              ? 'The 3D preview stopped working on this device; the flat plan is shown.'
              : 'This browser has no WebGL, so only the flat plan can be previewed.'}
          </p>
        )}
        <div
          className={cn(
            'relative overflow-hidden rounded-md border border-border',
            view === '3d' ? 'h-[min(62dvh,560px)] min-h-[320px] bg-surface' : 'bg-surface p-2',
          )}
        >
          {loading || (!template && !problem) ? (
            <Skeleton className="absolute inset-0 rounded-none" aria-label="Building the preview" />
          ) : problem || !template || !state ? (
            <p role="alert" className="p-4 text-sm text-danger-text">
              {problem ?? 'The preview could not be built.'}
            </p>
          ) : view === '3d' ? (
            <PreviewBoundary onError={onLost}>
              <FloorScene
                state={state}
                template={template}
                theme={look}
                tier={gpu.tier}
                initialTier={gpu.tier}
                reducedMotion={reducedMotion}
                selectedId={null}
                focusRequest={null}
                readOnly
                onSelect={NOOP}
                onBubble={NOOP}
                onTierDrop={NOOP}
                onContextLost={onLost}
                className="absolute inset-0"
              />
            </PreviewBoundary>
          ) : (
            <FloorMap
              state={state}
              template={template}
              theme={look}
              attention={NO_ATTENTION}
              selectedId={null}
              onOpen={NOOP}
              className="mx-auto max-h-[62dvh]"
            />
          )}
        </div>
        <p className="text-xs text-muted">
          The stand-in people are named after their seat and only appear in this preview. Companies
          see their real team.
        </p>
      </CardContent>
    </Card>
  );
}

function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; icon?: ReactNode; disabled?: boolean }[];
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex gap-0.5 rounded-md border border-border bg-surface p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className="focus-ring flex h-6 items-center gap-1 rounded px-2 text-xs font-medium text-fg-secondary hover:bg-surface-3 disabled:opacity-50 aria-pressed:bg-accent-soft aria-pressed:text-accent-soft-fg [&_svg]:size-3.5"
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
