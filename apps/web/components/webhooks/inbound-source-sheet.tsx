'use client';

import { RESERVED_SOURCE_KEYS, inboundWebhookPath, type InboundWebhookAction, type MappingTransform, type WebhookEndpoint, type WebhookMatchKey, type WebhookVerification } from '@vistar/shared';
import { useQuery } from '@tanstack/react-query';
import { Radio, Wand2, X } from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { useNow } from '@/components/common/use-now';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/leads/primitives/sheet';
import { CheckboxRow } from '@/components/settings/common/checkbox';
import { InlineAlert } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api/client';
import { API_ORIGIN } from '@/lib/api/config';
import { isRouteLive } from '@/lib/api/availability';
import { useReadOnly } from '@/lib/auth/use-auth';
import { useVisibleFields } from '@/lib/customization/hooks';
import { formatDateTimeIn } from '@/lib/crm/format';
import { FormGrid, FormSection } from '@/lib/crm/ui/fields';
import { formErrorMessage, serverFieldErrors } from '@/lib/crm/ui/errors';
import { parseSample } from '@/lib/hub/json-paths';
import { mappingTargets } from '@/lib/hub/mapping-labels';
import { sourceKeyFrom } from '@/lib/hub/rules';
import { useWebhookMutations } from '@/lib/hub/webhooks';
import { useMe } from '@/lib/session/session';
import { MappingEditor, MappingPreview, newConstant, newRow, toPayloadMapping, type ConstantRow, type MappingRow } from './mapping-editor';

const pretty = (v: unknown) => {
  try {
    return v === undefined || v === null ? '' : JSON.stringify(v, null, 2);
  } catch {
    return '';
  }
};

const ACTIONS: ReadonlyArray<{ value: InboundWebhookAction; label: string; hint: string }> = [
  { value: 'create_lead', label: 'Create a lead', hint: 'Every request becomes a new lead with source Webhook. Lead routing picks the owner.' },
  { value: 'update_lead', label: 'Update a lead', hint: 'Finds the lead with the same phone or email and fills in the mapped fields.' },
  { value: 'start_workflow', label: 'Start a workflow', hint: 'Runs a workflow with the payload as its input.' },
];

/**
 * Create or edit an inbound source: name and URL key, how senders prove themselves (signature or
 * token), what Vistar does with a request, and the payload mapping with a sample, a tree to pick
 * paths from and a live preview of the resulting lead. The signing secret is shown once after create.
 */
export function InboundSourceSheet({ source, onClose, onCreated }: { source?: WebhookEndpoint; onClose: () => void; onCreated: (e: WebhookEndpoint, secret: string) => void }) {
  const formId = useId().replace(/:/g, '');
  const me = useMe()!;
  const tz = me.workspace.timezone ?? 'Asia/Kolkata';
  const m = useWebhookMutations();
  const { reason } = useReadOnly();
  const custom = useVisibleFields('lead');
  const targets = useMemo(() => mappingTargets((custom.data ?? []).map((f) => ({ key: f.key, label: f.label }))), [custom.data]);
  const workflowsLive = isRouteLive('workflowList');
  const workflows = useQuery({ queryKey: ['workflows', 'options'], queryFn: ({ signal }) => api.call('workflowList', { signal }), enabled: workflowsLive });

  const [name, setName] = useState(source?.name ?? '');
  const [key, setKey] = useState(source?.sourceKey ?? '');
  const [keyTouched, setKeyTouched] = useState(!!source);
  const [verification, setVerification] = useState<WebhookVerification>(source?.verification ?? 'hmac');
  const [action, setAction] = useState<InboundWebhookAction>(source?.action ?? 'create_lead');
  const [matchBy, setMatchBy] = useState<WebhookMatchKey[]>(source?.matchBy?.length ? source.matchBy : ['phone', 'email']);
  const [createIfMissing, setCreateIfMissing] = useState(source?.createIfMissing ?? true);
  const [workflowId, setWorkflowId] = useState(source?.workflowId ?? '');
  const [rows, setRows] = useState<MappingRow[]>(() => source?.mapping?.fields.map((f) => newRow({ from: f.from, to: f.to, transform: f.transform as MappingTransform })) ?? []);
  const [constants, setConstants] = useState<ConstantRow[]>(() => Object.entries(source?.mapping?.defaults ?? {}).map(([to, value]) => newConstant({ to, value })));
  const [sampleText, setSampleText] = useState(() => pretty(source?.samplePayload));
  const [sampleVersion, setSampleVersion] = useState(0);
  const [seenCapture, setSeenCapture] = useState(source?.sampleCapturedAt ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const parsed = useMemo(() => (sampleText.trim() ? parseSample(sampleText) : null), [sampleText]);
  const sample = parsed?.ok ? parsed.value : undefined;
  const mapping = useMemo(() => toPayloadMapping(rows, constants), [rows, constants]);
  const url = source?.inboundUrl ?? (key ? `${API_ORIGIN}${inboundWebhookPath(me.workspace.id, key)}` : '');
  const newCapture = source?.sampleCapturedAt && source.sampleCapturedAt !== seenCapture ? source : null;
  const now = useNow(5_000);
  const capturing = !!source?.captureUntil && now > 0 && new Date(source.captureUntil).getTime() > now;
  const disabled = !!reason;

  const loadSample = (v: unknown) => {
    setSampleText(pretty(v));
    setSampleVersion((n) => n + 1);
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Give the source a name, for example Website form.';
    if (!source) {
      if (!/^[a-z0-9-]{3,40}$/.test(key)) next.sourceKey = 'Use 3 to 40 lowercase letters, digits or dashes.';
      else if ((RESERVED_SOURCE_KEYS as readonly string[]).includes(key)) next.sourceKey = 'This name is taken by a built-in receiver. Pick another.';
    }
    if (action === 'start_workflow' && !workflowId) next.workflowId = 'Pick the workflow to start.';
    if ((action === 'update_lead' || action === 'start_workflow') && matchBy.length === 0) next.matchBy = 'Match by phone, email or both.';
    if (parsed && !parsed.ok) next.sample = parsed.error;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;
    const common = {
      name: name.trim(),
      action,
      verification,
      matchBy,
      createIfMissing,
      mapping,
      ...(sample !== undefined ? { samplePayload: sample } : {}),
    };
    try {
      if (source) {
        await m.update.mutateAsync({ id: source.id, patch: { ...common, workflowId: action === 'start_workflow' ? workflowId : null } });
        toast.success(`${common.name} saved`);
        onClose();
      } else {
        const created = await m.createInbound.mutateAsync({ ...common, sourceKey: key, ...(action === 'start_workflow' ? { workflowId } : {}) });
        const { secret, ...endpoint } = created;
        onCreated(endpoint, secret);
      }
    } catch (err) {
      setErrors(serverFieldErrors(err));
      setFormError(formErrorMessage(err));
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent size="xl" className="sm:max-w-5xl" aria-describedby={`${formId}-desc`}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <SheetTitle className="text-base font-semibold text-fg">{source ? `Edit ${source.name}` : 'New inbound source'}</SheetTitle>
            <SheetDescription id={`${formId}-desc`} className="mt-0.5 text-sm text-muted-strong">
              A private URL that turns JSON requests into leads. Map the payload once; every request after that follows the mapping.
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

            <FormSection title="Source">
              <FormGrid>
                <FormField label="Name" required error={errors.name}>
                  <Input
                    value={name}
                    disabled={disabled}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (!keyTouched) setKey(sourceKeyFrom(e.target.value));
                    }}
                    placeholder="Website enquiry form"
                  />
                </FormField>
                {source ? (
                  <FormField label="URL key" hint="Fixed after creation, so senders' URLs keep working.">
                    <Input value={key} readOnly className="font-mono" />
                  </FormField>
                ) : (
                  <FormField label="URL key" required error={errors.sourceKey} hint="Lowercase letters, digits and dashes. Part of the URL.">
                    <Input
                      value={key}
                      disabled={disabled}
                      className="font-mono"
                      spellCheck={false}
                      onChange={(e) => {
                        setKeyTouched(true);
                        setKey(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40));
                      }}
                      placeholder="website-form"
                    />
                  </FormField>
                )}
              </FormGrid>
              {url && (
                <p className="text-xs text-muted-strong">
                  URL: <code className="font-mono break-all text-fg-secondary">{url}</code>
                </p>
              )}
              <FormField label="How senders prove it is them" hint={verification === 'hmac' ? 'Recommended. Each request is signed with the secret and must be less than 5 minutes old.' : 'For tools that cannot sign: the secret goes in the X-Vistar-Token header or ?token=. Anyone who sees the URL with the token can send leads.'}>
                <NativeSelect value={verification} disabled={disabled} onChange={(e) => setVerification(e.target.value as WebhookVerification)}>
                  <option value="hmac">Signature (HMAC-SHA256)</option>
                  <option value="token">Secret token</option>
                </NativeSelect>
              </FormField>
            </FormSection>

            <FormSection title="What Vistar does with a request">
              <div role="radiogroup" aria-label="Action" className="grid gap-2 md:grid-cols-3">
                {ACTIONS.map((a) => {
                  const off = a.value === 'start_workflow' && !workflowsLive;
                  return (
                    <label key={a.value} className="flex cursor-pointer flex-col gap-1 rounded-md border border-border p-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                      <span className="flex items-center gap-2 font-medium text-fg">
                        <input type="radio" name={`${formId}-action`} value={a.value} checked={action === a.value} disabled={disabled || off} onChange={() => setAction(a.value)} className="focus-ring accent-accent" />
                        {a.label}
                      </span>
                      <span className="text-xs text-muted-strong">{off ? 'Arrives with the workflow engine.' : a.hint}</span>
                    </label>
                  );
                })}
              </div>
              {action === 'start_workflow' && (
                <FormField label="Workflow" required error={errors.workflowId}>
                  <NativeSelect value={workflowId} disabled={disabled} onChange={(e) => setWorkflowId(e.target.value)}>
                    <option value="">Pick a workflow</option>
                    {(workflows.data?.items ?? []).map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              )}
              {action !== 'create_lead' && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-fg-secondary">Find the lead by</p>
                  <div className="flex flex-wrap gap-x-6">
                    {(['phone', 'email'] as const).map((k) => (
                      <CheckboxRow key={k} checked={matchBy.includes(k)} disabled={disabled} label={k === 'phone' ? 'Phone' : 'Email'} onCheckedChange={(on) => setMatchBy((prev) => (on ? [...new Set([...prev, k])] : prev.filter((x) => x !== k)))} />
                    ))}
                  </div>
                  {errors.matchBy && (
                    <p role="alert" className="text-xs text-danger-text">
                      {errors.matchBy}
                    </p>
                  )}
                  {action === 'update_lead' && <CheckboxRow checked={createIfMissing} disabled={disabled} onCheckedChange={setCreateIfMissing} label="Create a lead when none matches" hint="Off: requests without a matching lead are logged and skipped." />}
                </div>
              )}
            </FormSection>

            {action !== 'start_workflow' && (
              <FormSection title="Sample payload" description="Paste a request body your sender sends, or capture the next real request. It is used for the mapping and the preview.">
                {newCapture && (
                  <InlineAlert tone="info" title={`A request arrived at ${formatDateTimeIn(newCapture.sampleCapturedAt, tz)}`}>
                    <Button
                      size="sm"
                      className="mt-1"
                      onClick={() => {
                        loadSample(newCapture.samplePayload);
                        setSeenCapture(newCapture.sampleCapturedAt);
                        // Got the sample: stop capturing so the next requests are processed again.
                        if (capturing) m.capture.mutate({ id: newCapture.id, enabled: false }, { onError: (err) => toast.error(formErrorMessage(err)) });
                      }}
                    >
                      Use it as the sample
                    </Button>
                  </InlineAlert>
                )}
                <FormField label="Sample (JSON)" error={errors.sample ?? (parsed && !parsed.ok ? parsed.error : undefined)}>
                  <Textarea
                    value={sampleText}
                    disabled={disabled}
                    onChange={(e) => setSampleText(e.target.value)}
                    onBlur={() => {
                      if (parsed?.ok) loadSample(parsed.value);
                    }}
                    rows={8}
                    spellCheck={false}
                    className="font-mono text-xs"
                    placeholder={'{\n  "name": "Asha Patil",\n  "mobile": "9876543210",\n  "city": "Pune"\n}'}
                  />
                </FormField>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" disabled={!parsed?.ok} onClick={() => parsed?.ok && loadSample(parsed.value)}>
                    <Wand2 aria-hidden />
                    Format
                  </Button>
                  {source && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={disabled || capturing}
                      loading={m.capture.isPending}
                      onClick={() =>
                        m.capture.mutate(
                          { id: source.id, enabled: true },
                          { onSuccess: () => toast.success('Capture on. Send one request to the URL; it shows up here.'), onError: (err) => toast.error(formErrorMessage(err)) },
                        )
                      }
                    >
                      <Radio aria-hidden />
                      {capturing ? 'Waiting for a request…' : 'Capture the next request'}
                    </Button>
                  )}
                  {!source && <p className="text-xs text-muted-strong">After saving you can also capture a real request.</p>}
                </div>
              </FormSection>
            )}

            {action !== 'start_workflow' && (
              <FormSection title="Mapping" description="Which part of the payload goes into which lead field.">
                <MappingEditor sample={sample} sampleVersion={sampleVersion} rows={rows} onRows={setRows} constants={constants} onConstants={setConstants} targets={targets} disabled={disabled} />
              </FormSection>
            )}

            {action !== 'start_workflow' && (
              <FormSection title="Preview" description="The lead this sample would create or update.">
                <div className="rounded-md border border-border bg-surface-2 p-3">
                  <MappingPreview sample={sample} mapping={mapping} targets={targets} />
                </div>
              </FormSection>
            )}
          </form>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
          {reason && <p className="mr-auto text-xs text-muted-strong">{reason}</p>}
          <SheetClose asChild>
            <Button disabled={m.createInbound.isPending || m.update.isPending} className="h-11 sm:h-8">
              Cancel
            </Button>
          </SheetClose>
          <Button type="submit" form={formId} variant="primary" loading={m.createInbound.isPending || m.update.isPending} disabled={disabled} className="h-11 sm:h-8">
            {source ? 'Save changes' : 'Create source'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
