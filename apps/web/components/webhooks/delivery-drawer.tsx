'use client';

import { OUTBOUND_EVENT_INFO, WEBHOOK_RETRY_DELAYS_SEC, type OutboundWebhookEvent, type WebhookDelivery } from '@vistar/shared';
import { CheckCircle2, Clock, ExternalLink, RotateCcw, X, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useNow } from '@/components/common/use-now';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/leads/primitives/sheet';
import { InlineAlert } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { useReadOnly } from '@/lib/auth/use-auth';
import { ConfirmDialog } from '@/lib/crm/ui/confirm-dialog';
import { formErrorMessage } from '@/lib/crm/ui/errors';
import { DELIVERY_STATUS, eventLabel, formatDelay, formatInstant, formatLatency, httpTone, inFuture, prettyBody, statusOf } from '@/lib/hub/format';
import { useDelivery, useWebhookMutations } from '@/lib/hub/webhooks';
import { upcomingRetryDelays } from '@/lib/hub/rules';
import { CodeBlock } from '@/lib/hub/ui/copy';
import { useCan, useMe } from '@/lib/session/session';

export const deliveryEventLabel = (event: string | null) => (event ? (OUTBOUND_EVENT_INFO[event as OutboundWebhookEvent]?.label ?? eventLabel(event)) : 'Inbound request');

/**
 * One delivery: status, HTTP result and latency, the attempt timeline with the retries still to come,
 * request headers and body, response, what Vistar did with an inbound request, and replay (confirm).
 * The status is live: socket updates replace the cached delivery and pending ones poll every 3 s.
 */
export function DeliveryDrawer({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen: (id: string) => void }) {
  const q = useDelivery(id);
  const me = useMe();
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';
  const d = q.data;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="xl" aria-describedby="delivery-desc">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <SheetTitle className="text-base font-semibold text-fg">{d ? deliveryEventLabel(d.event) : 'Delivery'}</SheetTitle>
            <SheetDescription id="delivery-desc" className="mt-0.5 text-sm text-muted-strong">
              {d ? `${d.direction === 'inbound' ? 'Received by' : 'Sent to'} ${d.endpointName} · ${formatInstant(d.createdAt, tz)}` : 'Loading the delivery'}
            </SheetDescription>
          </div>
          <SheetClose asChild>
            <Button size="icon" variant="ghost" aria-label="Close">
              <X aria-hidden />
            </Button>
          </SheetClose>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {q.isPending ? (
            <div role="status" aria-label="Loading the delivery" className="flex flex-col gap-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : q.isError ? (
            <InlineAlert title="The delivery did not load">
              {formErrorMessage(q.error)}{' '}
              <Button size="sm" className="ml-1" onClick={() => void q.refetch()}>
                Try again
              </Button>
            </InlineAlert>
          ) : (
            <DeliveryBody delivery={q.data} tz={tz} onOpen={onOpen} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DeliveryBody({ delivery: d, tz, onOpen }: { delivery: WebhookDelivery; tz: string; onOpen: (id: string) => void }) {
  const now = useNow(5_000);
  const canManage = useCan('webhooks.manage');
  const { reason } = useReadOnly();
  const m = useWebhookMutations();
  const [confirm, setConfirm] = useState(false);
  const st = statusOf(DELIVERY_STATUS, d.status);
  const headers = Object.entries(d.requestHeaders ?? {});
  const request = prettyBody(d.requestBody);
  const response = prettyBody(d.responseBody);
  // Attempts still to come: attempt n+1 runs WEBHOOK_RETRY_DELAYS_SEC[n - 1] after attempt n.
  const upcoming = d.direction === 'outbound' ? upcomingRetryDelays(WEBHOOK_RETRY_DELAYS_SEC, d.attempt, d.maxAttempts, d.status === 'pending') : [];

  const replay = () =>
    m.replay.mutate(d.id, {
      onSuccess: (nd) => {
        setConfirm(false);
        toast.success('Replay sent. Its status updates here.');
        onOpen(nd.id);
      },
      onError: (e) => toast.error(formErrorMessage(e, 'The delivery was not replayed. Try again.')),
    });

  return (
    <div className="flex flex-col gap-6" data-testid="delivery-detail" data-status={d.status}>
      <section aria-label="Summary" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2" aria-live="polite">
          <Chip tone={st.tone} dot size="md" data-testid="delivery-status">
            {st.label}
          </Chip>
          {d.responseStatus !== null && <Chip tone={httpTone(d.responseStatus)}>HTTP {d.responseStatus}</Chip>}
          {d.latencyMs !== null && <Chip tone="neutral">{formatLatency(d.latencyMs)}</Chip>}
          <Chip tone="neutral">
            Attempt {d.attempt} of {d.maxAttempts}
          </Chip>
          {d.signatureValid === false && <Chip tone="red">Signature rejected</Chip>}
          {d.signatureValid === true && <Chip tone="green">Signature valid</Chip>}
        </div>
        {d.error && <InlineAlert className="text-xs">{d.error}</InlineAlert>}
        <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-strong">Direction</dt>
          <dd className="text-fg">{d.direction === 'inbound' ? 'Inbound (to Vistar)' : 'Outbound (from Vistar)'}</dd>
          {d.event && (
            <>
              <dt className="text-muted-strong">Event</dt>
              <dd className="font-mono text-xs text-fg">{d.event}</dd>
            </>
          )}
          {d.nextAttemptAt && d.status === 'pending' && (
            <>
              <dt className="text-muted-strong">Next attempt</dt>
              <dd className="text-fg">
                {formatInstant(d.nextAttemptAt, tz)} ({inFuture(d.nextAttemptAt, now)})
              </dd>
            </>
          )}
          {d.idempotencyKey && (
            <>
              <dt className="text-muted-strong">Idempotency key</dt>
              <dd className="font-mono text-xs break-all text-fg">{d.idempotencyKey}</dd>
            </>
          )}
          {d.replayOfId && (
            <>
              <dt className="text-muted-strong">Replay of</dt>
              <dd>
                <Button variant="link" size="sm" onClick={() => onOpen(d.replayOfId!)}>
                  Open the original delivery
                </Button>
              </dd>
            </>
          )}
          {d.result && (
            <>
              <dt className="text-muted-strong">Result</dt>
              <dd className="flex flex-wrap items-center gap-2 text-fg">
                {d.result.captured ? 'Stored as the sample (capture mode), not processed' : d.result.duplicate ? 'Duplicate of an earlier request; nothing new was created' : d.result.action ? d.result.action.replace(/_/g, ' ') : 'Not processed'}
                {d.result.leadId && (
                  <Link href={`/app/leads/${d.result.leadId}`} className="focus-ring inline-flex items-center gap-1 rounded-sm text-accent-text hover:underline" data-testid="delivery-lead-link">
                    Open the lead
                    <ExternalLink aria-hidden className="size-3.5" />
                  </Link>
                )}
              </dd>
            </>
          )}
        </dl>
        {canManage && d.canReplay && (
          <div>
            <Button onClick={() => setConfirm(true)} disabled={!!reason}>
              <RotateCcw aria-hidden />
              Replay
            </Button>
          </div>
        )}
      </section>

      <section aria-labelledby="attempts-title">
        <h3 id="attempts-title" className="mb-2 text-sm font-semibold text-fg">
          Attempts
        </h3>
        {d.attempts.length === 0 ? (
          <p className="text-sm text-muted-strong">No attempt yet.</p>
        ) : (
          <ol className="relative flex flex-col gap-3 border-l border-border pl-5" aria-label="Attempt timeline">
            {d.attempts.map((a) => (
              <li key={`${a.attempt}-${a.at}`} className="relative text-sm">
                <span aria-hidden className="absolute top-0.5 -left-[1.6rem] flex size-5 items-center justify-center rounded-full bg-surface">
                  {a.ok ? <CheckCircle2 className="size-4 text-success-text" /> : <XCircle className="size-4 text-danger-text" />}
                </span>
                <p className="font-medium text-fg">
                  Attempt {a.attempt} <span className="font-normal text-muted-strong">· {formatInstant(a.at, tz)}</span>
                  <span className="sr-only">{a.ok ? ', delivered' : ', failed'}</span>
                </p>
                <p className="text-xs text-fg-secondary">
                  {a.responseStatus !== null ? `HTTP ${a.responseStatus}` : 'No response'}
                  {a.latencyMs !== null ? ` · ${formatLatency(a.latencyMs)}` : ''}
                  {a.error ? ` · ${a.error}` : ''}
                </p>
              </li>
            ))}
            {upcoming.map((sec, i) => (
              <li key={`next-${i}`} className="relative text-sm text-muted-strong">
                <span aria-hidden className="absolute top-0.5 -left-[1.6rem] flex size-5 items-center justify-center rounded-full bg-surface">
                  <Clock className="size-4" />
                </span>
                Attempt {d.attempt + 1 + i}
                {i === 0 && d.nextAttemptAt ? ` ${inFuture(d.nextAttemptAt, now)}` : ` ${formatDelay(sec)} after the one before`}
              </li>
            ))}
            {d.status === 'dead' && <li className="text-sm text-danger-text">Every attempt failed. The delivery is in the dead letter list; replay it once the receiver works.</li>}
          </ol>
        )}
      </section>

      <section aria-labelledby="request-title" className="flex flex-col gap-2">
        <h3 id="request-title" className="text-sm font-semibold text-fg">
          Request
        </h3>
        {headers.length > 0 && (
          <dl className="grid grid-cols-[minmax(10rem,auto)_1fr] gap-x-4 gap-y-0.5 rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-2xs">
            {headers.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-strong">{k}</dt>
                <dd className="break-all text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {request ? <CodeBlock title="Body" language="JSON" code={request} what="Request body" /> : <p className="text-sm text-muted-strong">Empty body.</p>}
      </section>

      <section aria-labelledby="response-title" className="flex flex-col gap-2">
        <h3 id="response-title" className="text-sm font-semibold text-fg">
          Response
        </h3>
        {d.responseStatus === null && !response ? (
          <p className="text-sm text-muted-strong">{d.direction === 'inbound' ? 'Vistar answers inbound requests itself; see the result above.' : 'No response yet.'}</p>
        ) : response ? (
          <CodeBlock title={`Body${d.responseStatus !== null ? ` (HTTP ${d.responseStatus})` : ''}`} language="first 4 KB" code={response} what="Response body" />
        ) : (
          <p className="text-sm text-muted-strong">HTTP {d.responseStatus} with an empty body.</p>
        )}
      </section>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        tone="primary"
        title="Replay this delivery?"
        description={
          d.direction === 'outbound'
            ? 'Vistar sends the same body again as a new delivery with a fresh signature. Receivers that store X-Vistar-Delivery see it as new.'
            : 'Vistar processes the stored request again as a new delivery. Duplicate checks still apply.'
        }
        confirmLabel="Replay"
        loading={m.replay.isPending}
        onConfirm={replay}
      />
    </div>
  );
}
