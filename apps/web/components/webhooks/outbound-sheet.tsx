'use client';

import { OUTBOUND_EVENT_GROUPS, OUTBOUND_EVENT_INFO, OUTBOUND_WEBHOOK_EVENTS, WEBHOOK_AUTO_DISABLE_AFTER_DEAD, WEBHOOK_RETRY_DELAYS_SEC, type OutboundWebhookEvent, type WebhookEndpoint } from '@vistar/shared';
import { X } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/leads/primitives/sheet';
import { Checkbox, CheckboxRow } from '@/components/settings/common/checkbox';
import { InlineAlert } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useReadOnly } from '@/lib/auth/use-auth';
import { FormSection } from '@/lib/crm/ui/fields';
import { formErrorMessage, serverFieldErrors } from '@/lib/crm/ui/errors';
import { formatDelay } from '@/lib/hub/format';
import { useWebhookMutations } from '@/lib/hub/webhooks';

const GROUP_LABEL: Record<string, string> = { leads: 'Leads', activity: 'Calls, messages, tasks and workflows', crm: 'Contacts, accounts and deals', documents: 'Quotations and invoices', calendar: 'Calendar' };

/** https, or plain http only for localhost (the API also blocks private and link-local addresses). */
export function urlProblem(raw: string): string | null {
  const v = raw.trim();
  if (!v) return 'Enter the URL that should receive the events.';
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return 'Enter a full URL, for example https://example.in/hooks/vistar.';
  }
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return null;
  return 'Use an https URL. Plain http works only for localhost while testing.';
}

export const RETRY_SCHEDULE = WEBHOOK_RETRY_DELAYS_SEC.map(formatDelay).join(', ');

/** Create or edit an outbound subscription: name, URL, events (grouped checklist) and on/off. */
export function OutboundSheet({ endpoint, onClose, onCreated }: { endpoint?: WebhookEndpoint; onClose: () => void; onCreated: (e: WebhookEndpoint, secret: string) => void }) {
  const formId = useId().replace(/:/g, '');
  const m = useWebhookMutations();
  const { reason } = useReadOnly();
  const [name, setName] = useState(endpoint?.name ?? '');
  const [url, setUrl] = useState(endpoint?.url ?? '');
  const [events, setEvents] = useState<Set<OutboundWebhookEvent>>(() => new Set((endpoint?.events ?? ['lead.created']) as OutboundWebhookEvent[]));
  const [isActive, setIsActive] = useState(endpoint?.isActive ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const disabled = !!reason;

  const toggle = (e: OutboundWebhookEvent, on: boolean) =>
    setEvents((prev) => {
      const next = new Set(prev);
      if (on) next.add(e);
      else next.delete(e);
      return next;
    });

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Give the subscription a name, for example Tally sync.';
    const bad = urlProblem(url);
    if (bad) next.url = bad;
    if (events.size === 0) next.events = 'Pick at least one event.';
    setErrors(next);
    if (Object.keys(next).length) return;
    const list = OUTBOUND_WEBHOOK_EVENTS.filter((e) => events.has(e));
    try {
      if (endpoint) {
        await m.update.mutateAsync({ id: endpoint.id, patch: { name: name.trim(), url: url.trim(), events: list, isActive } });
        toast.success(`${name.trim()} saved`);
        onClose();
      } else {
        const created = await m.createOutbound.mutateAsync({ name: name.trim(), url: url.trim(), events: list, isActive });
        const { secret, ...rest } = created;
        onCreated(rest, secret);
      }
    } catch (err) {
      setErrors(serverFieldErrors(err));
      setFormError(formErrorMessage(err));
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="xl" aria-describedby={`${formId}-desc`}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <SheetTitle className="text-base font-semibold text-fg">{endpoint ? `Edit ${endpoint.name}` : 'New subscription'}</SheetTitle>
            <SheetDescription id={`${formId}-desc`} className="mt-0.5 text-sm text-muted-strong">
              Vistar sends a signed JSON POST to your URL each time one of the chosen events happens.
            </SheetDescription>
          </div>
          <SheetClose asChild>
            <Button size="icon" variant="ghost" aria-label="Close">
              <X aria-hidden />
            </Button>
          </SheetClose>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <form id={formId} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-6">
            {formError && <InlineAlert>{formError}</InlineAlert>}
            {endpoint?.disabledAt && (
              <InlineAlert tone="warning" title="Vistar turned this subscription off">
                {endpoint.disabledReason ?? `${WEBHOOK_AUTO_DISABLE_AFTER_DEAD} deliveries in a row failed every retry.`} Fix the receiver, then switch it on below.
              </InlineAlert>
            )}
            <FormSection title="Endpoint">
              <FormField label="Name" required error={errors.name}>
                <Input value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} placeholder="ERP sync" />
              </FormField>
              <FormField label="URL" required error={errors.url} hint="https only. Private network addresses are blocked.">
                <Input type="url" inputMode="url" value={url} disabled={disabled} onChange={(e) => setUrl(e.target.value)} placeholder="https://erp.example.in/hooks/vistar" spellCheck={false} className="font-mono" />
              </FormField>
              <CheckboxRow checked={isActive} disabled={disabled} onCheckedChange={setIsActive} label="Send events" hint="Off: events are not queued while it is off." />
            </FormSection>
            <FormSection title="Events" description="Each delivery body is the event envelope: id, type, workspaceId, occurredAt, actor and payload.">
              {errors.events && (
                <p role="alert" className="text-xs text-danger-text">
                  {errors.events}
                </p>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                {OUTBOUND_EVENT_GROUPS.map((g) => {
                  const list = OUTBOUND_WEBHOOK_EVENTS.filter((e) => OUTBOUND_EVENT_INFO[e].group === g);
                  if (!list.length) return null;
                  const on = list.filter((e) => events.has(e)).length;
                  const groupId = `${formId}-g-${g}`;
                  return (
                    <fieldset key={g} className="flex min-w-0 flex-col gap-1 rounded-md border border-border p-3">
                      <legend className="sr-only">{GROUP_LABEL[g] ?? g}</legend>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={groupId}
                          checked={on === 0 ? false : on === list.length ? true : 'indeterminate'}
                          disabled={disabled}
                          onCheckedChange={(v) => list.forEach((e) => toggle(e, v === true))}
                          aria-label={`All ${GROUP_LABEL[g] ?? g} events`}
                        />
                        <label htmlFor={groupId} className="text-sm font-semibold text-fg">
                          {GROUP_LABEL[g] ?? g}
                        </label>
                      </div>
                      {list.map((e) => (
                        <CheckboxRow
                          key={e}
                          className="pl-6"
                          checked={events.has(e)}
                          disabled={disabled}
                          onCheckedChange={(v) => toggle(e, v)}
                          label={
                            <span>
                              {OUTBOUND_EVENT_INFO[e].label} <code className="font-mono text-2xs text-muted-strong">{e}</code>
                            </span>
                          }
                          hint={OUTBOUND_EVENT_INFO[e].description}
                        />
                      ))}
                    </fieldset>
                  );
                })}
              </div>
            </FormSection>
            <p className="text-xs text-muted-strong">
              Failed deliveries are retried after {RETRY_SCHEDULE}; after that they go to the dead letter list, where you can replay them. After {WEBHOOK_AUTO_DISABLE_AFTER_DEAD} dead deliveries in a row Vistar turns the subscription off and tells the company admins.
            </p>
          </form>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
          {reason && <p className="mr-auto text-xs text-muted-strong">{reason}</p>}
          <SheetClose asChild>
            <Button disabled={m.createOutbound.isPending || m.update.isPending} className="h-11 sm:h-8">
              Cancel
            </Button>
          </SheetClose>
          <Button type="submit" form={formId} variant="primary" loading={m.createOutbound.isPending || m.update.isPending} disabled={disabled} className="h-11 sm:h-8">
            {endpoint ? 'Save changes' : 'Create subscription'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
