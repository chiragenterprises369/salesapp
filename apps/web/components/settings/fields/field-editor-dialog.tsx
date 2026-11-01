'use client';

import { FIELD_TYPE_LABELS, FIELD_TYPES, type FieldSpecInput, type FieldType } from '@vistar/shared';
import { Lock } from 'lucide-react';
import { RadioGroup } from 'radix-ui';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/input';
import { fieldErrorMap, useCustomObjects, useLabels } from '@/lib/customization';
import { cn } from '@/lib/cn';
import { CheckboxRow } from '../common/checkbox';
import { toKey } from '../common/keys';
import { PackBadge } from '../common/pack-badge';
import { errorCode, errorMessage, InlineAlert } from '../common/states';
import { TAP_BUTTON } from '../common/touch';
import { useRolesStore } from '../roles-store';
import { AccessMatrix, type AccessRole } from './access-matrix';
import { FieldConfigEditor } from './field-config';
import { emptyDraft, optionUid, UNIQUE_TYPES, validateDraft, draftToSpec, type FieldDraft } from './field-draft';
import { FIELD_TYPE_HINTS, FieldTypeIcon } from './field-type-icon';

export interface FieldEditorDialogProps {
  mode: 'create' | 'edit';
  /** Starting state (edit, or re-editing an unsaved field). */
  initial?: FieldDraft;
  /** Plural name of what the field belongs to ("Leads", "Suppliers"). */
  targetName: string;
  packKey?: string | null;
  /** Keys already used (unsaved fields in the object flow); the API checks saved ones. */
  takenKeys?: readonly string[];
  /** Extra objects a relation may link to (the object being created). */
  extraObjects?: ReadonlyArray<{ key: string; labelPlural: string }>;
  submitLabel: string;
  /** Throw (ApiRequestError) to show errors in the dialog. */
  onSubmit: (spec: FieldSpecInput) => Promise<void>;
  onClose: () => void;
  readOnlyReason?: string | null;
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * Create or edit one custom field. Key and type are fixed after creation (records and integrations
 * depend on them). Validation runs on the shared FieldSpecSchema before sending; the data layer
 * validates again and its errors (e.g. FIELD_KEY_TAKEN) appear next to the right input.
 */
export function FieldEditorDialog({ mode, initial, targetName, packKey, takenKeys, extraObjects = [], submitLabel, onSubmit, onClose, readOnlyReason }: FieldEditorDialogProps) {
  const [draft, setDraft] = useState<FieldDraft>(() => initial ?? emptyDraft());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const labels = useLabels();
  const objectsQ = useCustomObjects();
  const roles = useRolesStore((s) => s.roles);
  const locked = mode === 'edit';
  const disabled = !!readOnlyReason;

  const accessRoles = useMemo<AccessRole[]>(() => {
    const list = roles.map((r) => ({ key: r.key, name: r.name }));
    for (const k of Object.keys(initial?.access ?? {})) if (!list.some((r) => r.key === k)) list.push({ key: k, name: k });
    return list;
  }, [roles, initial]);

  const objects = useMemo(() => {
    const saved = (objectsQ.data ?? []).filter((o) => !o.archivedAt).map((o) => ({ key: o.key, labelPlural: o.labelPlural }));
    return [...saved, ...extraObjects.filter((x) => !saved.some((o) => o.key === x.key))];
  }, [objectsQ.data, extraObjects]);

  // Move focus to the first invalid input after a failed save.
  useEffect(() => {
    if (focusTick) bodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusTick]);

  const set = (patch: Partial<FieldDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setLabel = (label: string) => setDraft((d) => ({ ...d, label, key: d.keyEdited || locked ? d.key : toKey(label) }));
  const setType = (type: FieldType) =>
    setDraft((d) => ({
      ...d,
      type,
      options: (type === 'select' || type === 'multi_select') && d.options.length === 0 ? [{ uid: optionUid(), value: '', label: '', color: '', valueEdited: false, locked: false }] : d.options,
    }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const local = validateDraft(draft, { takenKeys });
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length) {
      setFormError('Check the highlighted fields.');
      setFocusTick((n) => n + 1);
      return;
    }
    setSaving(true);
    try {
      await onSubmit(draftToSpec(draft));
    } catch (err) {
      const map = Object.fromEntries(Object.entries(fieldErrorMap(err)).map(([p, m]) => [p.replace(/^field\./, ''), m]));
      if (errorCode(err) === 'FIELD_KEY_TAKEN') map.key = errorMessage(err);
      setErrors(map);
      const shown = Object.keys(map).some((p) => p === 'key' || p === 'label' || p === 'helpText' || p.startsWith('config.'));
      setFormError(shown ? 'Check the highlighted fields.' : errorMessage(err));
      setFocusTick((n) => n + 1);
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{mode === 'create' ? `New field on ${targetName}` : `Edit field ${initial?.label ?? ''}`}</DialogTitle>
            <DialogDescription>
              {mode === 'create' ? 'Fields appear on forms, detail panels, filters and exports.' : `Changes apply to every ${targetName.toLowerCase()} record right away.`}
            </DialogDescription>
            {packKey && (
              <div className="pt-1">
                <PackBadge packKey={packKey} />
              </div>
            )}
          </DialogHeader>
          <DialogBody>
            <div ref={bodyRef} className="flex flex-col gap-4">
              {readOnlyReason && <InlineAlert tone="info">{readOnlyReason}</InlineAlert>}
              {formError && <InlineAlert>{formError}</InlineAlert>}
              <Section title="Basics">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Label" required error={errors.label} hint="What people see, e.g. GST number">
                    <Input value={draft.label} maxLength={60} onChange={(e) => setLabel(e.target.value)} autoFocus disabled={disabled} />
                  </FormField>
                  {locked ? (
                    <FormField label="Key" hint="Keys never change, so imports, exports and workflows keep working.">
                      <Input value={draft.key} readOnly className="font-mono text-xs" />
                    </FormField>
                  ) : (
                    <FormField label="Key" required error={errors.key} hint="Used by imports, exports, the API and workflows. Cannot change later.">
                      <Input
                        value={draft.key}
                        maxLength={40}
                        className="font-mono text-xs"
                        spellCheck={false}
                        autoCapitalize="off"
                        onChange={(e) => set({ key: e.target.value, keyEdited: true })}
                        disabled={disabled}
                      />
                    </FormField>
                  )}
                </div>
                {locked ? (
                  <p className="flex items-center gap-2 text-sm text-fg-secondary">
                    <FieldTypeIcon type={draft.type} className="text-muted" />
                    Type: <span className="font-medium text-fg">{FIELD_TYPE_LABELS[draft.type]}</span>
                    <Lock aria-hidden className="size-3.5 text-muted" />
                    <span className="sr-only">(cannot change)</span>
                  </p>
                ) : (
                  <fieldset>
                    <legend className="mb-1.5 text-xs font-medium text-fg-secondary">Type</legend>
                    <RadioGroup.Root value={draft.type} onValueChange={(v) => setType(v as FieldType)} className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Field type" disabled={disabled}>
                      {FIELD_TYPES.map((t) => (
                        <RadioGroup.Item
                          key={t}
                          value={t}
                          className={cn(
                            'focus-ring flex min-h-11 items-start gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-left transition-colors duration-150 hover:border-border-strong',
                            'data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft',
                          )}
                        >
                          <FieldTypeIcon type={t} className="mt-0.5 text-fg-secondary" />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-fg">{FIELD_TYPE_LABELS[t]}</span>
                            <span className="block text-2xs leading-tight text-muted-strong">{FIELD_TYPE_HINTS[t]}</span>
                          </span>
                        </RadioGroup.Item>
                      ))}
                    </RadioGroup.Root>
                  </fieldset>
                )}
              </Section>

              <Section title={`${FIELD_TYPE_LABELS[draft.type]} settings`}>
                <FieldConfigEditor draft={draft} set={set} errors={errors} labels={labels} objects={objects} disabled={disabled} />
              </Section>

              <Section title="Rules">
                <FormField label="Help text (optional)" error={errors.helpText} hint="Shown under the input, up to 200 characters">
                  <Input value={draft.helpText} maxLength={200} onChange={(e) => set({ helpText: e.target.value })} disabled={disabled} />
                </FormField>
                <div className="grid sm:grid-cols-2">
                  <CheckboxRow checked={draft.required} onCheckedChange={(required) => set({ required })} label="Required" hint="Needed when a record is created" disabled={disabled} />
                  {UNIQUE_TYPES.has(draft.type) && (
                    <CheckboxRow checked={draft.unique} onCheckedChange={(unique) => set({ unique })} label="Unique" hint={`No two ${targetName.toLowerCase()} can share a value`} disabled={disabled} />
                  )}
                </div>
              </Section>

              <Section title="Who can see it">
                <AccessMatrix roles={accessRoles} value={draft.access} onChange={(access) => set({ access })} disabled={disabled} />
              </Section>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button className={TAP_BUTTON} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" className={TAP_BUTTON} loading={saving} disabled={disabled}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
