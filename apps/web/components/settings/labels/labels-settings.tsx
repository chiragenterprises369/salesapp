'use client';

import { DEFAULT_LABELS, LABEL_KEYS, LabelSchema, type LabelKey, type LabelOverrides, type ResolvedLabels } from '@vistar/shared';
import { RotateCcw } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useReadOnly } from '@/lib/auth/use-auth';
import { fieldErrorMap, useLabelSettings, useUpdateLabels } from '@/lib/customization';
import { pluralize } from '../common/keys';
import { errorMessage, InlineAlert, ListSkeleton, LoadError } from '../common/states';
import { TAP_BUTTON } from '../common/touch';
import { SaveBar, SettingsCard } from '../settings-card';

type Draft = Record<LabelKey, { singular: string; plural: string }>;

const HINTS: Record<LabelKey, string> = {
  lead: 'People or businesses who enquired',
  contact: 'People you deal with',
  company: 'Businesses you sell to',
  deal: 'Opportunities with a value',
  task: 'Follow-ups and to-dos',
  call: 'Phone calls with leads',
  pipeline: 'A set of stages',
  stage: 'One step in a pipeline',
};

/** One sentence per label that shows where the word appears. Uses the draft, so it updates while typing. */
function preview(key: LabelKey, d: Draft): string {
  const l = d[key];
  switch (key) {
    case 'lead':
      return `3 new ${l.plural} assigned to you`;
    case 'contact':
      return `2 new ${l.plural} added today`;
    case 'company':
      return `${l.singular} details updated by Priya`;
    case 'deal':
      return `5 ${l.plural} worth ₹4.2 lakh close this month`;
    case 'task':
      return `4 ${l.plural} due today`;
    case 'call':
      return `12 ${l.plural} made today`;
    case 'pipeline':
      return `Default ${l.singular}: Sales`;
    case 'stage':
      return `${d.lead.singular} moved to the next ${l.singular}`;
  }
}

const same = (a: { singular: string; plural: string }, b: { singular: string; plural: string }) => a.singular.trim() === b.singular.trim() && a.plural.trim() === b.plural.trim();

function overridesOf(d: Draft): LabelOverrides {
  const out: LabelOverrides = {};
  for (const key of LABEL_KEYS) {
    if (!same(d[key], DEFAULT_LABELS[key])) out[key] = { singular: d[key].singular.trim(), plural: d[key].plural.trim() };
  }
  return out;
}

function validate(d: Draft): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const key of LABEL_KEYS) {
    const r = LabelSchema.safeParse(d[key]);
    if (!r.success) {
      for (const issue of r.error.issues) {
        const part = String(issue.path[0]);
        errors[`${key}.${part}`] = d[key][part as 'singular' | 'plural'].trim() ? 'Use up to 40 characters' : 'Enter a name';
      }
    }
  }
  return errors;
}

export function LabelsSettings() {
  const q = useLabelSettings();
  if (q.isPending) return <ListSkeleton rows={8} label="Loading labels" />;
  if (q.isError) return <LoadError title="Labels did not load" onRetry={() => void q.refetch()} />;
  // Remount the form when saved data changes, so the draft starts from what is stored.
  return <LabelsForm key={q.dataUpdatedAt} stored={q.data.labels} />;
}

function LabelsForm({ stored }: { stored: ResolvedLabels }) {
  const initial = useMemo<Draft>(() => Object.fromEntries(LABEL_KEYS.map((k) => [k, { ...stored[k] }])) as Draft, [stored]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [pluralTouched, setPluralTouched] = useState<Partial<Record<LabelKey, boolean>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const update = useUpdateLabels();
  const { reason } = useReadOnly();
  const dirty = LABEL_KEYS.some((k) => !same(draft[k], initial[k]));
  const customised = LABEL_KEYS.some((k) => !same(draft[k], DEFAULT_LABELS[k]));

  const setSingular = (key: LabelKey, singular: string) =>
    setDraft((d) => ({ ...d, [key]: { singular, plural: pluralTouched[key] ? d[key].plural : pluralize(singular) || d[key].plural } }));
  const setPlural = (key: LabelKey, plural: string) => {
    setPluralTouched((t) => ({ ...t, [key]: true }));
    setDraft((d) => ({ ...d, [key]: { ...d[key], plural } }));
  };
  const reset = (key: LabelKey) => {
    setDraft((d) => ({ ...d, [key]: { ...DEFAULT_LABELS[key] } }));
    setPluralTouched((t) => ({ ...t, [key]: false }));
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const local = validate(draft);
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length) return;
    try {
      await update.mutateAsync(overridesOf(draft));
      toast.success('Labels saved');
    } catch (err) {
      const map = fieldErrorMap(err);
      setErrors(Object.fromEntries(Object.entries(map).map(([p, m]) => [p.replace(/^overrides\./, ''), m])));
      setFormError(errorMessage(err));
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <InlineAlert tone="info" title="Only the words people see change">
        Links, exports, reports, API names, webhooks and workflow variables keep the original names (lead, contact, deal...), so nothing that
        connects to Tootodo breaks.
      </InlineAlert>
      <SettingsCard
        title="Names used across the app"
        description="Use the words your team already says. Singular and plural are used in menus, buttons, notifications and empty states."
        footer={
          <>
            <Button className={TAP_BUTTON} variant="ghost" onClick={() => LABEL_KEYS.forEach(reset)} disabled={!customised || !!reason}>
              <RotateCcw aria-hidden />
              Reset all to defaults
            </Button>
            <SaveBar dirty={dirty} saving={update.isPending} onDiscard={() => setDraft(initial)} readOnlyReason={reason} />
          </>
        }
      >
        {formError && <InlineAlert className="mb-3">{formError}</InlineAlert>}
        <ul className="divide-y divide-border">
          {LABEL_KEYS.map((key) => {
            const def = DEFAULT_LABELS[key];
            const changed = !same(draft[key], def);
            return (
              <li key={key} className="grid gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0 sm:pt-6">
                  <p className="text-sm font-medium text-fg">{def.singular}</p>
                  <p className="text-xs text-muted">{HINTS[key]}</p>
                </div>
                <FormField label={`Singular (${def.singular.toLowerCase()})`} error={errors[`${key}.singular`]}>
                  <Input value={draft[key].singular} maxLength={40} onChange={(e) => setSingular(key, e.target.value)} disabled={!!reason} />
                </FormField>
                <FormField label={`Plural (${def.plural.toLowerCase()})`} error={errors[`${key}.plural`]}>
                  <Input value={draft[key].plural} maxLength={40} onChange={(e) => setPlural(key, e.target.value)} disabled={!!reason} />
                </FormField>
                <div className="sm:pt-5">
                  <Button variant="ghost" size="sm" className={TAP_BUTTON} onClick={() => reset(key)} disabled={!changed || !!reason} aria-label={`Reset ${def.singular} to the default`}>
                    <RotateCcw aria-hidden />
                    Reset
                  </Button>
                </div>
                <p className="text-xs text-muted sm:col-start-2 sm:col-end-5">
                  <span className="sr-only">Preview: </span>
                  <span className="rounded-xs bg-surface-2 px-1.5 py-0.5 text-fg-secondary">{preview(key, draft)}</span>
                </p>
              </li>
            );
          })}
        </ul>
      </SettingsCard>
    </form>
  );
}
