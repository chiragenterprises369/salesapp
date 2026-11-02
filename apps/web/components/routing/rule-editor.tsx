'use client';

import { INDIAN_STATES, LEAD_SOURCES, type LeadSource, type RoutingRule, type RoutingStrategy } from '@vistar/shared';
import { useId, useState, type FormEvent } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Switch } from '@/components/common/switch';
import { SOURCE_LABEL } from '@/components/leads/lead-meta';
import { Checkbox } from '@/components/leads/primitives/checkbox';
import { FormField, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useScopedUserList, useTeams } from '@/lib/api/directory';
import { useCaptureForms, useRoutingMutations } from '@/lib/crm/automation';
import { formErrorMessage, focusFirstInvalid, serverFieldErrors } from '@/lib/crm/ui/errors';
import { FormGrid, FormSection, OwnerSelect, TagsInput } from '@/lib/crm/ui/fields';
import { CrmFormSheet } from '@/lib/crm/ui/record-form';

interface Draft {
  name: string;
  active: boolean;
  sources: LeadSource[];
  cities: string[];
  states: string[];
  productKeywords: string[];
  minValue: string;
  maxValue: string;
  tags: string[];
  captureFormIds: string[];
  strategy: RoutingStrategy;
  teamId: string | null;
  userIds: string[];
  respectWorkingHours: boolean;
  respectAvailability: boolean;
  requireOnline: boolean;
  fallbackOwnerId: string | null;
}

function toDraft(r?: RoutingRule): Draft {
  return {
    name: r?.name ?? '',
    active: r?.active ?? true,
    sources: r?.conditions.sources ?? [],
    cities: r?.conditions.cities ?? [],
    states: r?.conditions.states ?? [],
    productKeywords: r?.conditions.productKeywords ?? [],
    minValue: r?.conditions.minValueInr !== null && r?.conditions.minValueInr !== undefined ? String(r.conditions.minValueInr) : '',
    maxValue: r?.conditions.maxValueInr !== null && r?.conditions.maxValueInr !== undefined ? String(r.conditions.maxValueInr) : '',
    tags: r?.conditions.tags ?? [],
    captureFormIds: r?.conditions.captureFormIds ?? [],
    strategy: r?.strategy ?? 'round_robin',
    teamId: r?.team?.id ?? null,
    userIds: r?.users.map((u) => u.id) ?? [],
    respectWorkingHours: r?.respectWorkingHours ?? true,
    respectAvailability: r?.respectAvailability ?? true,
    requireOnline: r?.requireOnline ?? false,
    fallbackOwnerId: r?.fallbackOwner?.id ?? null,
  };
}

/** Create or edit a routing rule: conditions (all must match; empty = any), the pool, the strategy, the availability gates and a fallback owner. */
export function RuleEditorSheet({ rule, onClose }: { rule?: RoutingRule; onClose: () => void }) {
  const formId = useId().replace(/:/g, '');
  const m = useRoutingMutations();
  const teams = useTeams();
  const users = useScopedUserList();
  const forms = useCaptureForms();
  const [draft, setDraft] = useState<Draft>(() => toDraft(rule));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setFormError(null);
  };
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!draft.name.trim()) errs.name = 'Enter a name, for example "Mumbai website leads".';
    const min = draft.minValue.trim() ? Number(draft.minValue) : null;
    const max = draft.maxValue.trim() ? Number(draft.maxValue) : null;
    if (min !== null && !Number.isInteger(min)) errs.minValueInr = 'Whole rupees only.';
    if (max !== null && !Number.isInteger(max)) errs.maxValueInr = 'Whole rupees only.';
    if (min !== null && max !== null && max < min) errs.maxValueInr = 'The maximum is below the minimum.';
    if (!draft.teamId && !draft.userIds.length && !draft.fallbackOwnerId) errs.teamId = 'Pick a team, some people or a fallback owner.';
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError('Fix the highlighted fields to save.');
      focusFirstInvalid(formId);
      return;
    }
    const body = {
      name: draft.name.trim(),
      active: draft.active,
      conditions: { sources: draft.sources, cities: draft.cities, states: draft.states, productKeywords: draft.productKeywords, minValueInr: min, maxValueInr: max, tags: draft.tags, captureFormIds: draft.captureFormIds },
      strategy: draft.strategy,
      teamId: draft.teamId,
      userIds: draft.userIds,
      respectWorkingHours: draft.respectWorkingHours,
      respectAvailability: draft.respectAvailability,
      requireOnline: draft.requireOnline,
      fallbackOwnerId: draft.fallbackOwnerId,
    };
    try {
      if (rule) await m.update.mutateAsync({ id: rule.id, patch: body });
      else await m.create.mutateAsync(body);
      toast.success(rule ? 'Rule saved' : `Rule "${body.name}" added at the end of the order`);
      onClose();
    } catch (err) {
      setErrors(serverFieldErrors(err));
      setFormError(formErrorMessage(err));
    }
  };

  return (
    <CrmFormSheet open onOpenChange={(o) => !o && onClose()} title={rule ? `Edit ${rule.name}` : 'New routing rule'} description="All conditions must match. An empty condition matches any lead." formId={formId} submitLabel={rule ? 'Save rule' : 'Add rule'} submitting={m.create.isPending || m.update.isPending}>
      <form id={formId} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-6">
        {formError && (
          <p role="alert" className="rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-sm text-status-red-fg">
            {formError}
          </p>
        )}
        <FormGrid>
          <FormField label="Rule name" required error={errors.name}>
            <Input autoFocus value={draft.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
          </FormField>
          <label className="flex items-center gap-3 self-end pb-1.5 text-sm text-fg">
            <Switch checked={draft.active} onCheckedChange={(active) => set({ active })} />
            Active
          </label>
        </FormGrid>
        <FormSection title="When a new lead has">
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-fg-secondary">Source</legend>
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
              {LEAD_SOURCES.map((s) => (
                <li key={s} className="flex items-center gap-1.5">
                  <Checkbox id={`${formId}-src-${s}`} checked={draft.sources.includes(s)} onCheckedChange={(v) => set({ sources: toggle(draft.sources, s, v === true) })} />
                  <label htmlFor={`${formId}-src-${s}`} className="text-sm text-fg">
                    {SOURCE_LABEL[s]}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <FormGrid>
            <TagsInput label="Cities (any of)" value={draft.cities} onChange={(cities) => set({ cities })} max={100} />
            <TagsInput label="Product keywords (any of)" value={draft.productKeywords} onChange={(productKeywords) => set({ productKeywords })} max={50} />
          </FormGrid>
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-fg-secondary">States (any of)</legend>
            <ul className="grid max-h-40 gap-x-4 gap-y-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2 xl:grid-cols-3">
              {INDIAN_STATES.map((s) => (
                <li key={s.code} className="flex items-center gap-1.5">
                  <Checkbox id={`${formId}-st-${s.code}`} checked={draft.states.includes(s.name)} onCheckedChange={(v) => set({ states: toggle(draft.states, s.name, v === true) })} />
                  <label htmlFor={`${formId}-st-${s.code}`} className="truncate text-sm text-fg">
                    {s.name}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <FormGrid>
            <FormField label="Value at least (₹)" error={errors.minValueInr}>
              <Input inputMode="numeric" value={draft.minValue} onChange={(e) => set({ minValue: e.target.value.replace(/\D/g, '') })} />
            </FormField>
            <FormField label="Value at most (₹)" error={errors.maxValueInr}>
              <Input inputMode="numeric" value={draft.maxValue} onChange={(e) => set({ maxValue: e.target.value.replace(/\D/g, '') })} />
            </FormField>
          </FormGrid>
          <TagsInput label="Lead tags (any of)" value={draft.tags} onChange={(tags) => set({ tags })} />
          {(forms.data?.items.length ?? 0) > 0 && (
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-fg-secondary">From these capture forms</legend>
              <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
                {forms.data!.items.map((f) => (
                  <li key={f.id} className="flex items-center gap-1.5">
                    <Checkbox id={`${formId}-f-${f.id}`} checked={draft.captureFormIds.includes(f.id)} onCheckedChange={(v) => set({ captureFormIds: toggle(draft.captureFormIds, f.id, v === true) })} />
                    <label htmlFor={`${formId}-f-${f.id}`} className="text-sm text-fg">
                      {f.name}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
        </FormSection>
        <FormSection title="Give it to">
          <FormGrid>
            <FormField label="Team" error={errors.teamId} hint="Active members of the team join the pool">
              <NativeSelect value={draft.teamId ?? ''} onChange={(e) => set({ teamId: e.target.value || null })}>
                <option value="">No team</option>
                {(teams.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="How">
              <NativeSelect value={draft.strategy} onChange={(e) => set({ strategy: e.target.value as RoutingStrategy })}>
                <option value="round_robin">Round robin (each person in turn)</option>
                <option value="least_busy">Least busy (fewest open leads)</option>
              </NativeSelect>
            </FormField>
          </FormGrid>
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-fg-secondary">People (besides the team)</legend>
            <ul className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
              {users.map((u) => (
                <li key={u.id} className="flex items-center gap-1.5">
                  <Checkbox id={`${formId}-u-${u.id}`} checked={draft.userIds.includes(u.id)} onCheckedChange={(v) => set({ userIds: toggle(draft.userIds, u.id, v === true) })} />
                  <label htmlFor={`${formId}-u-${u.id}`} className="truncate text-sm text-fg">
                    {u.name}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-3 text-sm text-fg">
              <Switch checked={draft.respectWorkingHours} onCheckedChange={(respectWorkingHours) => set({ respectWorkingHours })} />
              Only people inside their working hours
            </label>
            <label className="flex items-center gap-3 text-sm text-fg">
              <Switch checked={draft.respectAvailability} onCheckedChange={(respectAvailability) => set({ respectAvailability })} />
              Skip people on leave or in a meeting now
            </label>
            <label className="flex items-center gap-3 text-sm text-fg">
              <Switch checked={draft.requireOnline} onCheckedChange={(requireOnline) => set({ requireOnline })} />
              Only people online in Vistar right now
            </label>
          </div>
          <FormField label="Fallback owner" hint="Gets the lead when nobody in the pool is eligible; empty = unassigned">
            <OwnerSelect value={draft.fallbackOwnerId} onChange={(fallbackOwnerId) => set({ fallbackOwnerId })} />
          </FormField>
        </FormSection>
      </form>
    </CrmFormSheet>
  );
}
