'use client';

import { OUTBOUND_WEBHOOK_EVENTS, WEBHOOK_DELIVERY_STATUSES, WEBHOOK_TEST_EVENT, type WebhookDelivery, type WebhookEndpoint } from '@vistar/shared';
import { ArrowDownToLine, ArrowUpFromLine, History, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { NativeSelect } from '@/components/common/native-select';
import { useMediaQuery } from '@/components/common/use-media-query';
import { useNow } from '@/components/common/use-now';
import { Segmented } from '@/components/dashboard/segmented';
import { LoadError } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { FormField, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { addDays, parseDayKey, zonedToUtc } from '@/lib/crm/tz';
import { DELIVERY_STATUS, formatInstant, formatLatency, httpTone, inFuture, statusOf } from '@/lib/hub/format';
import { useDeliveries, type DeliveryFilters } from '@/lib/hub/webhooks';
import { useMe } from '@/lib/session/session';
import { DeliveryDrawer, deliveryEventLabel } from './delivery-drawer';

type Direction = 'all' | 'inbound' | 'outbound';

/**
 * Delivery log of inbound requests and outbound deliveries: filters (direction, status, endpoint,
 * event, date range in the workspace time zone), newest first with "Load more", a table on wide
 * screens and cards on phones; a row opens the detail drawer.
 */
export function DeliveryLog({
  endpoints,
  endpointId,
  onEndpointChange,
  deliveryId,
  onOpenDelivery,
}: {
  endpoints: readonly WebhookEndpoint[];
  endpointId: string | null;
  onEndpointChange: (id: string | null) => void;
  deliveryId: string | null;
  onOpenDelivery: (id: string | null) => void;
}) {
  const me = useMe();
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const wide = useMediaQuery('(min-width: 768px)');
  const now = useNow(15_000);
  const [direction, setDirection] = useState<Direction>('all');
  const [status, setStatus] = useState<string>('');
  const [event, setEvent] = useState('');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');

  const filters = useMemo<DeliveryFilters>(() => {
    const f: DeliveryFilters = {};
    if (direction !== 'all') f.direction = direction;
    if (status) f.status = status as WebhookDelivery['status'];
    if (endpointId) f.endpointId = endpointId;
    if (event) f.event = event;
    if (fromDay) f.from = zonedToUtc(parseDayKey(fromDay), tz).toISOString();
    if (toDay) f.to = new Date(zonedToUtc(parseDayKey(addDays(toDay, 1)), tz).getTime() - 1).toISOString();
    return f;
  }, [direction, status, endpointId, event, fromDay, toDay, tz]);
  const q = useDeliveries(filters);
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const total = q.data?.pages[0]?.total;
  const filtered = direction !== 'all' || !!status || !!endpointId || !!event || !!fromDay || !!toDay;
  const clear = () => {
    setDirection('all');
    setStatus('');
    setEvent('');
    setFromDay('');
    setToDay('');
    onEndpointChange(null);
  };
  const shownEndpoints = endpoints.filter((e) => direction === 'all' || e.direction === direction);

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-end gap-3 p-3" role="search" aria-label="Filter deliveries">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-secondary">Direction</span>
          <Segmented
            label="Direction"
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'all', label: 'All' },
              { value: 'inbound', label: 'Inbound' },
              { value: 'outbound', label: 'Outbound' },
            ]}
          />
        </div>
        <FormField label="Status" className="w-36">
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {WEBHOOK_DELIVERY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusOf(DELIVERY_STATUS, s).label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Endpoint" className="w-48">
          <NativeSelect value={endpointId ?? ''} onChange={(e) => onEndpointChange(e.target.value || null)}>
            <option value="">All endpoints</option>
            {shownEndpoints.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.direction === 'inbound' ? 'in' : 'out'})
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Event" className="w-48">
          <NativeSelect value={event} onChange={(e) => setEvent(e.target.value)}>
            <option value="">Any event</option>
            {[...OUTBOUND_WEBHOOK_EVENTS, WEBHOOK_TEST_EVENT].map((e) => (
              <option key={e} value={e}>
                {deliveryEventLabel(e)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="From" className="w-40">
          <Input type="date" value={fromDay} max={toDay || undefined} onChange={(e) => setFromDay(e.target.value)} />
        </FormField>
        <FormField label="To" className="w-40">
          <Input type="date" value={toDay} min={fromDay || undefined} onChange={(e) => setToDay(e.target.value)} />
        </FormField>
        {filtered && (
          <Button variant="ghost" onClick={clear}>
            <X aria-hidden />
            Clear filters
          </Button>
        )}
      </Card>

      <p className="text-xs text-muted-strong" aria-live="polite">
        {q.isSuccess ? (total !== undefined ? `${total.toLocaleString('en-IN')} ${total === 1 ? 'delivery' : 'deliveries'}` : `${rows.length} shown`) : ''}
        {q.isFetching && !q.isPending ? ' · refreshing' : ''}
      </p>

      {q.isPending ? (
        <div role="status" aria-label="Loading deliveries" className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <LoadError title="The delivery log did not load" onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={filtered ? 'No deliveries match these filters' : 'No deliveries yet'}
          description={filtered ? 'Change or clear the filters.' : 'Requests to your inbound sources and deliveries to your subscriptions show up here, with every attempt.'}
          action={filtered ? <Button onClick={clear}>Clear filters</Button> : undefined}
        />
      ) : wide ? (
        <Card className="overflow-hidden">
          <Table aria-label="Deliveries" containerClassName="max-h-[70dvh]">
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>HTTP</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead>Attempts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => {
                const st = statusOf(DELIVERY_STATUS, d.status);
                return (
                  <TableRow key={d.id} data-delivery={d.id} data-status={d.status} className="cursor-pointer" onClick={() => onOpenDelivery(d.id)} data-state={d.id === deliveryId ? 'selected' : undefined}>
                    <TableCell>
                      <button type="button" className="focus-ring rounded-sm text-left hover:underline" onClick={(e) => {
                          e.stopPropagation();
                          onOpenDelivery(d.id);
                        }} aria-label={`Open ${deliveryEventLabel(d.event)} ${d.direction === 'inbound' ? 'from' : 'to'} ${d.endpointName}, ${formatInstant(d.createdAt, tz)}, ${st.label}`}>
                        {formatInstant(d.createdAt, tz)}
                      </button>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 text-fg-secondary">
                        {d.direction === 'inbound' ? <ArrowDownToLine aria-hidden className="size-3.5" /> : <ArrowUpFromLine aria-hidden className="size-3.5" />}
                        {d.direction === 'inbound' ? 'In' : 'Out'}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-48 truncate">{d.endpointName}</TableCell>
                    <TableCell className="max-w-48 truncate">{deliveryEventLabel(d.event)}</TableCell>
                    <TableCell>
                      <Chip tone={st.tone} dot>
                        {st.label}
                      </Chip>
                    </TableCell>
                    <TableCell>{d.responseStatus !== null ? <Chip tone={httpTone(d.responseStatus)}>{d.responseStatus}</Chip> : <span className="text-muted-strong">-</span>}</TableCell>
                    <TableCell className="tabular text-right">{formatLatency(d.latencyMs) || <span className="text-muted-strong">-</span>}</TableCell>
                    <TableCell className="text-fg-secondary">
                      {d.attempt}/{d.maxAttempts}
                      {d.status === 'pending' && d.nextAttemptAt && now > 0 ? <span className="text-muted-strong">, next {inFuture(d.nextAttemptAt, now)}</span> : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Deliveries">
          {rows.map((d) => {
            const st = statusOf(DELIVERY_STATUS, d.status);
            return (
              <li key={d.id} data-delivery={d.id} data-status={d.status}>
                <button type="button" onClick={() => onOpenDelivery(d.id)} className="focus-ring flex w-full flex-col gap-1 rounded-lg border border-border bg-surface p-3 text-left shadow-card">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-fg">{deliveryEventLabel(d.event)}</span>
                    <Chip tone={st.tone} dot>
                      {st.label}
                    </Chip>
                  </span>
                  <span className="text-xs text-muted-strong">
                    {d.direction === 'inbound' ? 'From' : 'To'} {d.endpointName} · {formatInstant(d.createdAt, tz)}
                    {d.responseStatus !== null ? ` · HTTP ${d.responseStatus}` : ''} · attempt {d.attempt}/{d.maxAttempts}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {q.hasNextPage && (
        <Button className="self-center" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
          Load more
        </Button>
      )}

      {deliveryId && <DeliveryDrawer key={deliveryId} id={deliveryId} onClose={() => onOpenDelivery(null)} onOpen={(id) => onOpenDelivery(id)} />}
    </div>
  );
}
