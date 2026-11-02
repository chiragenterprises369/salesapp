'use client';

import type { FieldLive } from '@vistar/shared';
import { BatteryLow, MapPin, RotateCw, Route } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { formatTimeIn } from '@/components/common/time';
import { useNow } from '@/components/common/use-now';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { PRESENCE_LABEL, PRESENCE_TONE } from '@/features/team-floor/workspace/presence-labels';
import { isApiRequestError } from '@/lib/api-error';
import { cn } from '@/lib/cn';
import { useMe } from '@/lib/session/session';
import { useFieldLive } from './data';
import type { MapPin as Pin } from './field-map';
import { formatPlace, initials, isStale, todayIn } from './logic';

const FieldMap = dynamic(() => import('./field-map'), { ssr: false, loading: () => <Skeleton className="h-full min-h-[420px] w-full rounded-lg" aria-label="Loading the map" /> });

type Item = FieldLive['items'][number];

function ago(at: string, now: number): string {
  const m = Math.max(0, Math.round((now - Date.parse(at)) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min ago`;
}

/** Live field map: the latest position of every checked-in field staff member, with staleness (D-063). */
export function LiveView() {
  const me = useMe()!;
  const tz = me.workspace.timezone;
  const live = useFieldLive(null);
  const now = useNow(30_000);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number; nonce: number } | null>(null);

  const items = useMemo(() => {
    const list = [...(live.data?.items ?? [])];
    // Fresh first, then by name.
    return list.sort((a, b) => Number(isStale(a.at, now, a.stale)) - Number(isStale(b.at, now, b.stale)) || a.user.name.localeCompare(b.user.name));
  }, [live.data, now]);
  const pins = useMemo<Pin[]>(
    () =>
      items.map((i) => {
        const stale = isStale(i.at, now, i.stale);
        return {
          id: i.user.id,
          lat: i.lat,
          lng: i.lng,
          text: initials(i.user.name),
          title: `${i.user.name}, ${stale ? 'last point' : 'position'} ${now ? ago(i.at, now) : ''}`,
          tone: stale ? 'grey' : i.presence ? (PRESENCE_TONE[i.presence] as Pin['tone']) : 'indigo',
          stale,
          accuracy: i.accuracy,
        };
      }),
    [items, now],
  );

  if (isApiRequestError(live.error) && live.error.code === 'FEATURE_DISABLED')
    return <EmptyState title="Field tracking is off for your company" description="Ask Vistar support to switch on field tracking to see positions." />;

  const today = todayIn(tz);
  const show = (i: Item) => {
    setSelected(i.user.id);
    setFocus((f) => ({ lat: i.lat, lng: i.lng, nonce: (f?.nonce ?? 0) + 1 }));
  };

  return (
    <div className="grid min-h-0 gap-3 lg:h-[calc(100dvh-17rem)] lg:min-h-[480px] lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="h-[60dvh] min-h-[360px] lg:h-auto">
        {live.isError ? (
          <EmptyState
            title="The live map did not load"
            description="Check your connection, then try again."
            action={
              <Button onClick={() => void live.refetch()}>
                <RotateCw aria-hidden />
                Try again
              </Button>
            }
            className="h-full justify-center"
          />
        ) : (
          <FieldMap pins={pins} label="Map of field staff positions" fitKey={`live:${items.length}`} focus={focus} onSelect={(id) => setSelected(id)} className="h-full" />
        )}
      </div>

      <section aria-labelledby="field-live-title" className="flex min-h-0 flex-col rounded-lg border border-border bg-surface shadow-card">
        <header data-slot="panel-head" className="flex items-center gap-2 border-b border-border px-3 py-2">
          <h2 id="field-live-title" className="flex-1 text-sm font-semibold text-fg">
            Checked in now {live.data ? `(${items.length})` : ''}
          </h2>
          {live.data && <span className="text-xs text-muted-strong">Updated {formatTimeIn(live.data.generatedAt, tz)}</span>}
          <Button size="icon-sm" variant="ghost" aria-label="Refresh positions" onClick={() => void live.refetch()} loading={live.isFetching && !live.isPending}>
            <RotateCw aria-hidden />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {live.isPending ? (
            <div className="space-y-2 p-3" aria-busy="true" aria-label="Loading positions">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              size="sm"
              className="m-3 border-none"
              icon={<MapPin />}
              title="Nobody is checked in right now"
              description="Positions appear here while field staff are checked in in the Android app, inside working hours."
            />
          ) : (
            <ul className="divide-y divide-border">
              {items.map((i) => {
                const stale = isStale(i.at, now, i.stale);
                return (
                  <li key={i.user.id} data-field-person={i.user.id} data-stale={stale || undefined} className={cn('flex items-start gap-2.5 px-3 py-2.5', selected === i.user.id && 'bg-accent-soft')}>
                    <Avatar name={i.user.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => show(i)} className="focus-ring block max-w-full truncate rounded-sm text-left text-sm font-medium text-fg hover:underline">
                        {i.user.name}
                      </button>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-strong">
                        {i.presence && <Chip tone={PRESENCE_TONE[i.presence]}>{PRESENCE_LABEL[i.presence]}</Chip>}
                        {stale ? <Chip tone="grey">No signal, last point {now ? ago(i.at, now) : ''}</Chip> : <span>{now ? ago(i.at, now) : ''}</span>}
                        {i.battery !== null && (
                          <span className={cn('inline-flex items-center gap-0.5', i.battery < 20 && 'text-warning-text')}>
                            {i.battery < 20 && <BatteryLow aria-hidden className="size-3.5" />}
                            Battery {i.battery}%
                          </span>
                        )}
                      </p>
                      <p className="tabular mt-0.5 truncate text-xs text-muted-strong">{formatPlace(i)}</p>
                    </div>
                    <Button size="icon-sm" variant="ghost" asChild>
                      <Link href={`/app/attendance/routes?user=${i.user.id}&date=${today}`} aria-label={`Route of ${i.user.name} today`}>
                        <Route aria-hidden />
                      </Link>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="border-t border-border px-3 py-2 text-xs text-muted-strong">A point older than 4 minutes is shown as no signal. Phones send one about every 2 minutes.</p>
      </section>
    </div>
  );
}
