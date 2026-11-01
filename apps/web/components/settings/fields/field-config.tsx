'use client';

import { CORE_ENTITIES, labelOf, objectTarget, ROLE_KIND_LABELS, ROLE_KINDS, type CustomObject, type ResolvedLabels } from '@vistar/shared';
import type { ReactNode } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { FormField, Input } from '@/components/ui/input';
import { CheckboxRow } from '../common/checkbox';
import type { FieldDraft } from './field-draft';
import { OptionsEditor } from './options-editor';

type Set = (patch: Partial<FieldDraft>) => void;

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

/** Settings that depend on the field type (FIELD_CONFIG_SCHEMAS). */
export function FieldConfigEditor({
  draft,
  set,
  errors,
  labels,
  objects,
  disabled,
}: {
  draft: FieldDraft;
  set: Set;
  errors: Record<string, string>;
  labels: ResolvedLabels;
  /** Custom objects a relation can link to. */
  objects: ReadonlyArray<Pick<CustomObject, 'key' | 'labelPlural'>>;
  disabled?: boolean;
}) {
  const e = (k: string) => errors[`config.${k}`];
  switch (draft.type) {
    case 'text':
      return (
        <div className="flex flex-col gap-4">
          <Grid>
            <FormField label="Maximum length" error={e('maxLength')} hint="Characters, 1 to 10,000">
              <Input type="number" inputMode="numeric" min={1} max={10000} value={draft.text.maxLength} onChange={(ev) => set({ text: { ...draft.text, maxLength: ev.target.value } })} disabled={disabled} />
            </FormField>
            <div className="sm:pt-5">
              <CheckboxRow checked={draft.text.multiline} onCheckedChange={(multiline) => set({ text: { ...draft.text, multiline } })} label="Allow several lines" hint="For notes and addresses" disabled={disabled} />
            </div>
          </Grid>
          <Grid>
            <FormField label="Pattern (optional)" error={e('pattern')} hint="A regular expression the value must match">
              <Input className="font-mono text-xs" value={draft.text.pattern} maxLength={300} placeholder="^[0-9]{6}$" onChange={(ev) => set({ text: { ...draft.text, pattern: ev.target.value } })} disabled={disabled} />
            </FormField>
            <FormField label="Message when it does not match" error={e('patternMessage')} hint="e.g. Enter a 6-digit PIN code">
              <Input value={draft.text.patternMessage} maxLength={120} onChange={(ev) => set({ text: { ...draft.text, patternMessage: ev.target.value } })} disabled={disabled || !draft.text.pattern.trim()} />
            </FormField>
          </Grid>
        </div>
      );
    case 'number':
      return (
        <div className="flex flex-col gap-4">
          <Grid>
            <FormField label="Minimum (optional)" error={e('min')}>
              <Input type="number" inputMode="decimal" value={draft.number.min} onChange={(ev) => set({ number: { ...draft.number, min: ev.target.value } })} disabled={disabled} />
            </FormField>
            <FormField label="Maximum (optional)" error={e('max')}>
              <Input type="number" inputMode="decimal" value={draft.number.max} onChange={(ev) => set({ number: { ...draft.number, max: ev.target.value } })} disabled={disabled} />
            </FormField>
          </Grid>
          <Grid>
            <FormField label="Unit (optional)" error={e('unit')} hint="Shown after the number, e.g. kg or sq ft">
              <Input value={draft.number.unit} maxLength={12} onChange={(ev) => set({ number: { ...draft.number, unit: ev.target.value } })} disabled={disabled} />
            </FormField>
            <div className="sm:pt-5">
              <CheckboxRow checked={draft.number.integer} onCheckedChange={(integer) => set({ number: { ...draft.number, integer } })} label="Whole numbers only" disabled={disabled} />
            </div>
          </Grid>
        </div>
      );
    case 'money':
      return (
        <Grid>
          <FormField label="Minimum in ₹ (optional)" error={e('min')} hint="Whole rupees">
            <Input type="number" inputMode="numeric" step={1} value={draft.money.min} onChange={(ev) => set({ money: { ...draft.money, min: ev.target.value } })} disabled={disabled} />
          </FormField>
          <FormField label="Maximum in ₹ (optional)" error={e('max')} hint="Whole rupees">
            <Input type="number" inputMode="numeric" step={1} value={draft.money.max} onChange={(ev) => set({ money: { ...draft.money, max: ev.target.value } })} disabled={disabled} />
          </FormField>
        </Grid>
      );
    case 'date':
      return <CheckboxRow checked={draft.date.withTime} onCheckedChange={(withTime) => set({ date: { withTime } })} label="Include a time" hint="Times use the workspace timezone" disabled={disabled} />;
    case 'select':
    case 'multi_select':
      return (
        <div className="flex flex-col gap-4">
          <OptionsEditor options={draft.options} onChange={(options) => set({ options })} errors={errors} disabled={disabled} />
          {draft.type === 'multi_select' && (
            <div className="max-w-xs">
              <FormField label="Most choices allowed (optional)" error={e('maxSelected')} hint="Leave empty for no limit">
                <Input type="number" inputMode="numeric" min={1} max={100} value={draft.maxSelected} onChange={(ev) => set({ maxSelected: ev.target.value })} disabled={disabled} />
              </FormField>
            </div>
          )}
        </div>
      );
    case 'user':
      return (
        <div className="flex flex-col gap-3">
          <CheckboxRow checked={draft.user.multiple} onCheckedChange={(multiple) => set({ user: { ...draft.user, multiple } })} label="Allow several people" disabled={disabled} />
          <fieldset>
            <legend className="text-xs font-medium text-fg-secondary">Who can be picked</legend>
            <p className="mb-1 text-xs text-muted">Leave all unticked to allow anyone on the team.</p>
            <div className="grid sm:grid-cols-2">
              {ROLE_KINDS.map((k) => (
                <CheckboxRow
                  key={k}
                  checked={draft.user.roleKinds.includes(k)}
                  onCheckedChange={(on) => set({ user: { ...draft.user, roleKinds: on ? [...draft.user.roleKinds, k] : draft.user.roleKinds.filter((x) => x !== k) } })}
                  label={ROLE_KIND_LABELS[k]}
                  disabled={disabled}
                />
              ))}
            </div>
          </fieldset>
        </div>
      );
    case 'relation':
      return (
        <div className="flex flex-col gap-4">
          <Grid>
            <FormField label="Links to" required error={e('target')}>
              <NativeSelect value={draft.relation.target} onChange={(ev) => set({ relation: { ...draft.relation, target: ev.target.value } })} disabled={disabled}>
                <optgroup label="Core records">
                  {CORE_ENTITIES.map((c) => (
                    <option key={c} value={c}>
                      {labelOf(labels, c, { plural: true })}
                    </option>
                  ))}
                </optgroup>
                {objects.length > 0 && (
                  <optgroup label="Custom objects">
                    {objects.map((o) => (
                      <option key={o.key} value={objectTarget(o.key)}>
                        {o.labelPlural}
                      </option>
                    ))}
                  </optgroup>
                )}
              </NativeSelect>
            </FormField>
            <FormField label="Label on the linked record (optional)" error={e('inverseLabel')} hint="e.g. Units on a Project">
              <Input value={draft.relation.inverseLabel} maxLength={60} onChange={(ev) => set({ relation: { ...draft.relation, inverseLabel: ev.target.value } })} disabled={disabled} />
            </FormField>
          </Grid>
          <CheckboxRow checked={draft.relation.multiple} onCheckedChange={(multiple) => set({ relation: { ...draft.relation, multiple } })} label="Allow several links" disabled={disabled} />
        </div>
      );
    case 'file':
      return (
        <div className="flex flex-col gap-4">
          <Grid>
            <FormField label="Allowed file types (optional)" error={e('accept')} hint="Comma separated, e.g. .pdf, image/*">
              <Input value={draft.file.accept} onChange={(ev) => set({ file: { ...draft.file, accept: ev.target.value } })} disabled={disabled} />
            </FormField>
            <FormField label="Largest file (MB)" error={e('maxSizeMb')} hint="1 to 100 MB">
              <Input type="number" inputMode="numeric" min={1} max={100} value={draft.file.maxSizeMb} onChange={(ev) => set({ file: { ...draft.file, maxSizeMb: ev.target.value } })} disabled={disabled} />
            </FormField>
          </Grid>
          <CheckboxRow checked={draft.file.multiple} onCheckedChange={(multiple) => set({ file: { ...draft.file, multiple } })} label="Allow several files" disabled={disabled} />
        </div>
      );
    default:
      return <p className="text-sm text-muted">This type has no extra settings.</p>;
  }
}
