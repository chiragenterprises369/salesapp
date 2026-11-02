'use client';

import { formatInr, INDIAN_STATES, LEAD_SOURCES, type LeadSource, type RoutingDecision, type RoutingRule } from '@vistar/shared';
import { ArrowDown, ArrowUp, CheckCircle2, CircleSlash, FlaskConical, Pencil, Plus, Route, Trash2, UserCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { NativeSelect } from '@/components/common/native-select';
import { Switch } from '@/components/common/switch';
import { useNow } from '@/components/common/use-now';
import { SOURCE_LABEL } from '@/components/leads/lead-meta';
import { SettingsCard } from '@/components/settings/settings-card';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { FormField, Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { useCaptureForms, useRoutingMutations, useRoutingRules } from '@/lib/crm/automation';
import { ago } from '@/lib/crm/format';
import { useCrmRealtime } from '@/lib/crm/realtime';
import { ConfirmDialog } from '@/lib/crm/ui/confirm-dialog';
import { formErrorMessage } from '@/lib/crm/ui/errors';
import { FormGrid } from '@/lib/crm/ui/fields';
import { RuleEditorSheet } from './rule-editor';

function summary(r: RoutingRule): string[] {
  const c = r.conditions;
  const out: string[] = [];
  if (c.sources.length) out.push(`source ${c.sources.map((s) => SOURCE_LABEL[s]).join(' or ')}`);
  if (c.cities.length) out.push(`city ${c.cities.join(', ')}`);
  if (c.states.length) out.push(`state ${c.states.join(', ')}`);
  if (c.productKeywords.length) out.push(`product mentions ${c.productKeywords.join(', ')}`);
  if (c.minValueInr !== null || c.maxValueInr !== null) out.push(`value ${c.minValueInr !== null ? `from ${formatInr(c.minValueInr)}` : ''}${c.maxValueInr !== null ? ` up to ${formatInr(c.maxValueInr)}` : ''}`.trim());
  if (c.tags.length) out.push(`tag ${c.tags.join(' or ')}`);
  if (c.captureFormIds.length) out.push(`${c.captureFormIds.length} capture ${c.captureFormIds.length === 1 ? 'form' : 'forms'}`);
  return out;
}

/** Settings > Lead routing: rules in order (first match wins), editor, reorder, and the "who would get this lead?" test panel. */
export function RoutingRulesSettings() {
  useCrmRealtime();
  const now = useNow(60_000);
  const q = useRoutingRules();
  const m = useRoutingMutations();
  const [editing, setEditing] = useState<RoutingRule | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RoutingRule | null>(null);
  const rules = [...(q.data?.items ?? [])].sort((a, b) => a.priority - b.priority);
  const fail = (e: unknown) => toast.error(formErrorMessage(e));

  const move = (i: number, dir: -1 | 1) => {
    const ids = rules.map((r) => r.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    m.reorder.mutate(ids, { onSuccess: () => toast.success('Order saved'), onError: fail });
  };

  return (
    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_28rem]">
      <SettingsCard
        title="Rules"
        description="Only leads created without an owner are routed (imports, website and capture forms, webhooks, IndiaMART, admins). Rules are checked from the top; the first that matches picks the owner."
        footer={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus aria-hidden />
            New rule
          </Button>
        }
      >
        {q.isPending ? (
          <div role="status" aria-label="Loading rules" className="flex flex-col gap-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-md" />
            ))}
          </div>
        ) : q.isError ? (
          <EmptyState size="sm" title="Rules did not load" description="Check your connection, then try again." action={<Button onClick={() => void q.refetch()}>Try again</Button>} />
        ) : rules.length === 0 ? (
          <EmptyState size="sm" icon={<Route />} title="No routing rules yet" description="Without rules, new leads without an owner stay unassigned. Add a rule to share them in turn across a team." />
        ) : (
          <ol className="flex flex-col gap-2" aria-label="Routing rules in order">
            {rules.map((r, i) => {
              const conds = summary(r);
              return (
                <li key={r.id} className="rounded-md border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                        <span className="inline-flex size-5 items-center justify-center rounded-full bg-surface-3 text-2xs tabular-nums">{i + 1}</span>
                        {r.name}
                        {!r.active && <Chip tone="grey">Paused</Chip>}
                        <Chip tone="indigo">{r.strategy === 'round_robin' ? 'Round robin' : 'Least busy'}</Chip>
                      </p>
                      <p className="mt-1 text-xs text-fg-secondary">{conds.length ? `When ${conds.join('; ')}` : 'Every lead without an owner'}</p>
                      <p className="mt-0.5 text-xs text-muted-strong">
                        To {[r.team ? `team ${r.team.name}` : null, r.users.length ? r.users.map((u) => u.name).join(', ') : null].filter(Boolean).join(' and ') || 'nobody'}
                        {r.fallbackOwner ? `; else ${r.fallbackOwner.name}` : ''}
                        {[r.respectWorkingHours && 'working hours', r.respectAvailability && 'not on leave or in a meeting', r.requireOnline && 'online'].filter(Boolean).length > 0 &&
                          ` · only ${[r.respectWorkingHours && 'inside working hours', r.respectAvailability && 'not on leave or in a meeting', r.requireOnline && 'online'].filter(Boolean).join(', ')}`}
                      </p>
                      <p className="mt-0.5 text-2xs text-muted-strong">
                        {r.assignedCount} {r.assignedCount === 1 ? 'lead' : 'leads'} assigned{r.lastAssignedAt ? `, last ${ago(r.lastAssignedAt, now)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <Switch
                        aria-label={r.active ? `Pause ${r.name}` : `Turn on ${r.name}`}
                        checked={r.active}
                        onCheckedChange={(active) => m.update.mutate({ id: r.id, patch: { active } }, { onSuccess: () => toast.success(active ? `${r.name} is on` : `${r.name} is paused`), onError: fail })}
                      />
                      <Button size="icon-sm" variant="ghost" aria-label={`Move ${r.name} up`} disabled={i === 0 || m.reorder.isPending} onClick={() => move(i, -1)}>
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Move ${r.name} down`} disabled={i === rules.length - 1 || m.reorder.isPending} onClick={() => move(i, 1)}>
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}>
                        <Pencil aria-hidden />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Delete ${r.name}`} onClick={() => setDeleting(r)}>
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </SettingsCard>
      <TestPanel />
      {editing && <RuleEditorSheet rule={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'rule'}?`}
        description="Leads already assigned keep their owner. New leads go to the next matching rule."
        confirmLabel="Delete rule"
        loading={m.remove.isPending}
        onConfirm={() =>
          deleting &&
          m.remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success('Rule deleted');
              setDeleting(null);
            },
            onError: fail,
          })
        }
      />
    </div>
  );
}

const OUTCOME: Record<RoutingDecision['outcome'], string> = {
  rule: 'Assigned by a rule',
  fallback: 'Nobody in the pool was eligible: the fallback owner gets it',
  no_rule: 'No rule matched: the lead stays unassigned',
  no_eligible_user: 'A rule matched but nobody is eligible and there is no fallback: the lead stays unassigned',
};

/** "Who would get this lead?" Nothing is saved and the round-robin turn does not move. */
function TestPanel() {
  const m = useRoutingMutations();
  const forms = useCaptureForms();
  const [source, setSource] = useState<LeadSource>('website');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [product, setProduct] = useState('');
  const [value, setValue] = useState('');
  const [tags, setTags] = useState('');
  const [formId, setFormId] = useState('');
  const [at, setAt] = useState('');
  const [result, setResult] = useState<RoutingDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await m.test.mutateAsync({
        lead: {
          source,
          city: city.trim() || null,
          state: state || null,
          productInterest: product.trim() || null,
          requirement: null,
          valueInr: Number(value || 0),
          tags: tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
          captureFormId: formId || null,
        },
        ...(at ? { at: new Date(at).toISOString() } : {}),
      });
      setResult(r);
    } catch (err) {
      setResult(null);
      setError(formErrorMessage(err, 'The test did not run. Try again.'));
    }
  };

  return (
    <SettingsCard title="Who would get this lead?" description="Describe a lead and see which rule matches and who would own it right now (or at another time).">
      <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-3">
        <FormGrid>
          <FormField label="Source">
            <NativeSelect value={source} onChange={(e) => setSource(e.target.value as LeadSource)}>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="City">
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Pune" />
          </FormField>
          <FormField label="State">
            <NativeSelect value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">Any</option>
              {INDIAN_STATES.map((s) => (
                <option key={s.code} value={s.name}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Product interest">
            <Input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="e.g. steel racks" />
          </FormField>
          <FormField label="Value (₹)">
            <Input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} />
          </FormField>
          <FormField label="Tags" hint="Comma separated">
            <Input value={tags} onChange={(e) => setTags(e.target.value)} />
          </FormField>
          {(forms.data?.items.length ?? 0) > 0 && (
            <FormField label="Capture form">
              <NativeSelect value={formId} onChange={(e) => setFormId(e.target.value)}>
                <option value="">None</option>
                {forms.data!.items.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          )}
          <FormField label="At" hint="Empty = now">
            <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </FormField>
        </FormGrid>
        <Button type="submit" className="self-start" loading={m.test.isPending}>
          <FlaskConical aria-hidden />
          Test routing
        </Button>
      </form>
      <div aria-live="polite" className="mt-4">
        {error && (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}
        {result && (
          <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-fg" data-testid="routing-result">
              <UserCheck aria-hidden className="size-4" />
              {result.owner ? `${result.owner.name} would get this lead` : 'Nobody would get this lead'}
            </p>
            <p className="text-xs text-fg-secondary">
              {OUTCOME[result.outcome]}
              {result.rule ? ` (rule "${result.rule.name}", ${result.rule.strategy === 'round_robin' ? 'round robin' : 'least busy'})` : ''}.
            </p>
            {result.rules.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-semibold text-fg-secondary">Rules checked</h3>
                <ul className="flex flex-col gap-1">
                  {result.rules.map((r) => (
                    <li key={r.id} className="flex items-start gap-2 text-xs">
                      {r.matched ? <CheckCircle2 aria-hidden className="mt-0.5 size-3.5 text-success-text" /> : <CircleSlash aria-hidden className="mt-0.5 size-3.5 text-muted-strong" />}
                      <span>
                        <span className="font-medium">{r.name}</span>: {r.matched ? 'matched' : 'no match'}
                        {r.reasons.length ? ` (${r.reasons.join(', ')})` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.candidates.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-semibold text-fg-secondary">People in the pool</h3>
                <ul className="flex flex-col gap-1">
                  {result.candidates.map((c) => (
                    <li key={c.user.id} className="flex items-start justify-between gap-2 text-xs">
                      <span>
                        <span className="font-medium">{c.user.name}</span>
                        {c.reasons.length ? ` · ${c.reasons.join(', ')}` : ''}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="text-muted-strong">{c.openLeads} open</span>
                        {c.eligible ? <Chip tone="green">Eligible</Chip> : <Chip tone="grey">Skipped</Chip>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </SettingsCard>
  );
}
