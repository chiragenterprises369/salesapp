'use client';

import { CalendarDays, ChevronLeft, ChevronRight, Footprints, LocateFixed, Route } from 'lucide-react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { NativeSelect } from '@/components/common/native-select';
import { formatTimeIn } from '@/components/common/time';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiRequestError } from '@/lib/api-error';
import { useMe } from '@/lib/session/session';
import { useAttendanceRegister, useFieldRoute } from './data';
import type { MapLine, MapPin } from './field-map';
import { addDays, detectStops, formatDistance, formatPlace, formatWorked, splitBySession, todayIn } from './logic';

const FieldMap = dynamic(() => import('./field-map'), { ssr: false, loading: () => <Skeleton className="h-full min-h-[420px] w-full rounded-lg" aria-label="Loading the map" /> });

/** A person's route for a date: polyline per session, check-in and check-out, stops (D-063). */
export function RouteView() {
  const me = useMe()!;
  const tz = me.workspace.timezone;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = todayIn(tz);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? (params.get('date') as string) : today;
  const personParam = params.get('user');
  const [focus, setFocus] = useState<{ lat: number; lng: number; nonce: number } | null>(null);

  // People to pick: field staff of the register for that day (the API scope applies).
  const register = useAttendanceRegister({ date, teamId: null, fieldStaffOnly: true });
  const people = register.data?.items ?? [];
  const personId = personParam ?? people.find((p) => p.sessions.length > 0)?.user.id ?? null;
  const route = useFieldRoute(personId, date);

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const data = route.data ?? null;
  const points = data?.points;
  const stops = useMemo(() => (points ? detectStops(points) : []), [points]);
  const lines = useMemo<MapLine[]>(() => (points ? splitBySession(points).map((l, i) => ({ id: `${l.sessionId}:${i}`, points: l.points })) : []), [points]);
  const pins = useMemo<MapPin[]>(() => {
    if (!data) return [];
    const out: MapPin[] = [];
    for (const s of data.sessions) {
      out.push({ id: `in:${s.id}`, lat: s.checkIn.lat, lng: s.checkIn.lng, text: 'In', title: `Checked in at ${formatTimeIn(s.checkInAt, tz)}`, tone: 'green', accuracy: s.checkIn.accuracy });
      if (s.checkOut && s.checkOutAt)
        out.push({ id: `out:${s.id}`, lat: s.checkOut.lat, lng: s.checkOut.lng, text: 'Out', title: `Checked out at ${formatTimeIn(s.checkOutAt, tz)}`, tone: 'red', accuracy: s.checkOut.accuracy });
    }
    for (const st of stops)
      out.push({ id: `stop:${st.index}`, lat: st.lat, lng: st.lng, text: String(st.index), title: `Stop ${st.index}: ${formatTimeIn(st.from, tz)} to ${formatTimeIn(st.to, tz)}, ${formatWorked(st.durationMin)}`, tone: 'amber', small: true });
    return out;
  }, [data, stops, tz]);

  const featureOff = [register.error, route.error].some((e) => isApiRequestError(e) && e.code === 'FEATURE_DISABLED');
  if (featureOff) return <EmptyState title="Field tracking is off for your company" description="Ask Vistar support to switch on field tracking to see routes." />;

  const workedMin = data?.sessions.reduce((s, x) => s + x.workedMin, 0) ?? 0;
  const notFound = isApiRequestError(route.error) && route.error.status === 404;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Route filters">
        <NativeSelect aria-label="Person" value={personId ?? ''} onChange={(e) => setParam({ user: e.target.value || null })} wrapperClassName="w-56" disabled={register.isPending}>
          {people.length === 0 && <option value="">{register.isPending ? 'Loading people' : 'No field staff'}</option>}
          {personParam && !people.some((p) => p.user.id === personParam) && <option value={personParam}>Selected person</option>}
          {people.map((p) => (
            <option key={p.user.id} value={p.user.id}>
              {p.user.name}
              {p.sessions.length === 0 ? ' (no check-in)' : ''}
            </option>
          ))}
        </NativeSelect>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Previous day" onClick={() => setParam({ date: addDays(date, -1) })}>
            <ChevronLeft aria-hidden />
          </Button>
          <label className="sr-only" htmlFor="route-date">
            Date
          </label>
          <Input id="route-date" type="date" value={date} max={today} onChange={(e) => e.target.value && setParam({ date: e.target.value === today ? null : e.target.value })} className="w-40" />
          <Button size="icon" variant="ghost" aria-label="Next day" disabled={date >= today} onClick={() => setParam({ date: addDays(date, 1) === today ? null : addDays(date, 1) })}>
            <ChevronRight aria-hidden />
          </Button>
          {date !== today && (
            <Button size="sm" variant="ghost" onClick={() => setParam({ date: null })}>
              <CalendarDays aria-hidden />
              Today
            </Button>
          )}
        </div>
        {data && (
          <ul className="ml-auto flex flex-wrap items-center gap-1.5" aria-label="Route summary">
            <li>
              <Chip tone="indigo">{formatDistance(data.distanceM)}</Chip>
            </li>
            <li>
              <Chip tone="blue">{formatWorked(workedMin)} worked</Chip>
            </li>
            <li>
              <Chip tone="amber">
                {stops.length} {stops.length === 1 ? 'stop' : 'stops'}
              </Chip>
            </li>
            <li>
              <Chip tone="neutral">{data.points.length} points</Chip>
            </li>
          </ul>
        )}
      </div>

      <div className="grid min-h-0 gap-3 lg:h-[calc(100dvh-20rem)] lg:min-h-[460px] lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="h-[55dvh] min-h-[340px] lg:h-auto">
          {!personId && !register.isPending ? (
            <EmptyState icon={<Route />} title="Pick a person" description="Choose someone from field staff to see their route for the day." className="h-full justify-center" />
          ) : route.isError && !notFound ? (
            <EmptyState title="The route did not load" description="Check your connection, then try again." action={<Button onClick={() => void route.refetch()}>Try again</Button>} className="h-full justify-center" />
          ) : (
            <FieldMap pins={pins} lines={lines} label={data ? `Route of ${data.user.name} on ${date}` : 'Route map'} fitKey={`${personId}:${date}:${data?.points.length ?? 0}`} focus={focus} className="h-full" />
          )}
        </div>

        <section aria-labelledby="route-details-title" className="flex min-h-0 flex-col rounded-lg border border-border bg-surface shadow-card">
          <header data-slot="panel-head" className="border-b border-border px-3 py-2">
            <h2 id="route-details-title" className="text-sm font-semibold text-fg">
              {data ? data.user.name : 'Route'}
            </h2>
          </header>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
            {route.isPending && personId ? (
              <Skeleton className="h-40 w-full" />
            ) : notFound ? (
              <p className="text-sm text-muted">This person is outside your team or does not exist.</p>
            ) : !data || data.points.length === 0 ? (
              <EmptyState
                size="sm"
                className="border-none"
                icon={<Footprints />}
                title="No route for this day"
                description="Points are recorded only while the person is checked in in the Android app, inside working hours."
              />
            ) : null}
            {data && data.sessions.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-strong">Sessions</h3>
                <ol className="mt-1 space-y-1.5">
                  {data.sessions.map((s) => (
                    <li key={s.id} className="text-sm">
                      <span className="tabular text-fg">
                        {formatTimeIn(s.checkInAt, tz)} to {s.checkOutAt ? formatTimeIn(s.checkOutAt, tz) : 'now'}
                      </span>
                      <span className="text-muted-strong"> · {formatWorked(s.workedMin)}</span>
                      <span className="tabular block text-xs text-muted-strong">In: {formatPlace(s.checkIn)}</span>
                      {s.checkOut && <span className="tabular block text-xs text-muted-strong">Out: {formatPlace(s.checkOut)}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {stops.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-strong">Stops of 10 minutes or more</h3>
                <ol className="mt-1 space-y-1">
                  {stops.map((st) => (
                    <li key={st.index} className="flex items-start gap-2 text-sm">
                      <span aria-hidden className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-status-amber-border bg-status-amber-bg text-2xs font-semibold text-status-amber-fg">
                        {st.index}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="tabular block text-fg">
                          {formatTimeIn(st.from, tz)} to {formatTimeIn(st.to, tz)} · {formatWorked(st.durationMin)}
                        </span>
                        <span className="tabular block truncate text-xs text-muted-strong">{formatPlace(st)}</span>
                      </span>
                      <Button size="icon-sm" variant="ghost" aria-label={`Show stop ${st.index} on the map`} onClick={() => setFocus((f) => ({ lat: st.lat, lng: st.lng, nonce: (f?.nonce ?? 0) + 1 }))}>
                        <LocateFixed aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
