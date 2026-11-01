'use client';

import {
  COMPARE_OPS,
  LEAD_SOURCES,
  LEAD_TEMPERATURES,
  nodeConfigSchemas,
  type CompareOp,
} from '@vistar/shared';
import { WHATSAPP_TEMPLATE_FIXTURES } from '@vistar/shared/fixtures';
import { ArrowDown, ArrowUp, Plus, Trash } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { FormField, Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { CRON_PRESETS, describeCron, validateCron } from '../../lib/cron';
import { enumLabel, OP_LABELS, RULE_FIELD_OPTIONS, UPDATE_FIELD_OPTIONS } from '../../lib/labels';
import {
  defaultTemplateVariables,
  previewContext,
  renderWhatsAppTemplate,
} from '../../lib/preview';
import {
  CheckboxField,
  MessagePreview,
  NumberField,
  SelectField,
  TagsField,
  TemplateTextField,
  TextField,
  type Option,
} from './fields';
import { SchemaFields, USER_OPTIONS, type ZodLike } from './schema-form';

export type Config = Record<string, unknown>;
export interface EditorProps {
  config: Config;
  onChange: (
    next: Config,
    opts?: { renameHandles?: Record<string, string>; coalesceKey?: string },
  ) => void;
  errors: Record<string, string>;
}

const OP_OPTIONS: Option[] = COMPARE_OPS.map((o) => ({ value: o, label: OP_LABELS[o] }));

/** Native radios styled as a segmented control (arrow keys work out of the box). */
export function Segmented<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: ReactNode;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-xs font-medium text-fg-secondary">{legend}</legend>
      <div className="flex rounded-md border border-input bg-surface-2 p-0.5">
        {options.map((o) => (
          <label key={o.value} className="relative flex-1">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="peer sr-only"
            />
            <span className="flex h-7 cursor-pointer items-center justify-center rounded-sm px-2 text-center text-xs text-fg-secondary transition-colors duration-150 ease-standard peer-checked:bg-surface peer-checked:font-medium peer-checked:text-fg peer-checked:shadow-card peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-ring hover:text-fg">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

function uniqueKey(base: string, taken: string[]): string {
  let k = base && base !== 'default' ? base : 'case';
  let i = 2;
  while (taken.includes(k) || k === 'default') k = `${base || 'case'}_${i++}`;
  return k;
}

// ---------------------------------------------------------------------------- logic.switch

interface SwitchCase {
  key: string;
  label: string;
  op: CompareOp;
  value: string | number | string[];
}

export function SwitchEditor({ config, onChange, errors }: EditorProps) {
  const on = String(config.on ?? 'reply_keyword');
  const cases = (config.cases as SwitchCase[] | undefined) ?? [];
  const setCases = (
    next: SwitchCase[],
    renameHandles?: Record<string, string>,
    coalesceKey?: string,
  ) => onChange({ ...config, cases: next }, { renameHandles, coalesceKey });
  const listOps =
    on === 'valueInr'
      ? (['gt', 'gte', 'lt', 'lte', 'eq'] as CompareOp[])
      : (['contains', 'eq', 'in', 'neq'] as CompareOp[]);

  const update = (i: number, patch: Partial<SwitchCase>, key?: string) =>
    setCases(
      cases.map((c, j) => (j === i ? { ...c, ...patch } : c)),
      undefined,
      key,
    );
  const rename = (i: number, label: string) => {
    const c = cases[i]!;
    const auto = c.key === slug(c.label) || c.key.startsWith('case');
    if (!auto) return update(i, { label }, `case-label:${i}`);
    const others = cases.filter((_, j) => j !== i).map((x) => x.key);
    const nextKey = uniqueKey(slug(label), others);
    setCases(
      cases.map((x, j) => (j === i ? { ...x, label, key: nextKey } : x)),
      nextKey !== c.key ? { [c.key]: nextKey } : undefined,
      `case-label:${i}`,
    );
  };
  const setKey = (i: number, raw: string) => {
    const c = cases[i]!;
    const nextKey = raw
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 40);
    setCases(
      cases.map((x, j) => (j === i ? { ...x, key: nextKey } : x)),
      nextKey && nextKey !== c.key ? { [c.key]: nextKey } : undefined,
      `case-key:${i}`,
    );
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...cases];
    const [item] = next.splice(i, 1);
    next.splice(i + d, 0, item!);
    setCases(next);
  };
  const addCase = () => {
    const n = cases.length + 1;
    const key = uniqueKey(
      `case_${n}`,
      cases.map((c) => c.key),
    );
    const value: SwitchCase['value'] = on === 'valueInr' ? 50000 : [];
    setCases([
      ...cases,
      {
        key,
        label: `Case ${n}`,
        op: on === 'valueInr' ? 'gte' : on === 'reply_keyword' ? 'contains' : 'in',
        value,
      },
    ]);
  };

  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Route by"
        value={on}
        options={['reply_keyword', 'source', 'city', 'valueInr', 'field'].map((o) => ({
          value: o,
          label: enumLabel(o),
        }))}
        onChange={(v) => onChange({ ...config, on: v ?? 'reply_keyword' })}
        error={errors.on}
        required
      />
      {on === 'field' && (
        <SelectField
          label="Field"
          value={String(config.field ?? '') || undefined}
          options={RULE_FIELD_OPTIONS}
          onChange={(v) => onChange({ ...config, field: v })}
          error={errors.field}
          hint="The value each case is compared with."
          required
        />
      )}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-fg-secondary">Cases</p>
        <ol className="flex flex-col gap-2">
          {cases.map((c, i) => (
            <li
              key={i}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-2xs font-semibold text-muted-strong">Case {i + 1}</span>
                <div className="flex items-center gap-0.5">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move case ${i + 1} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move case ${i + 1} down`}
                    disabled={i === cases.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove case ${i + 1}`}
                    disabled={cases.length <= 1}
                    onClick={() => setCases(cases.filter((_, j) => j !== i))}
                  >
                    <Trash aria-hidden />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label="Label"
                  value={c.label}
                  onChange={(v) => rename(i, v)}
                  error={errors[`cases.${i}.label`]}
                  required
                />
                <FormField label="Output key" error={errors[`cases.${i}.key`]} required>
                  <Input
                    value={c.key}
                    onChange={(e) => setKey(i, e.target.value)}
                    className="font-mono text-xs"
                  />
                </FormField>
              </div>
              <SelectField
                label="Match when the value"
                value={c.op}
                options={OP_OPTIONS.filter((o) => listOps.includes(o.value as CompareOp))}
                onChange={(v) =>
                  update(i, {
                    op: (v ?? 'contains') as CompareOp,
                    value:
                      v === 'contains' || v === 'in'
                        ? Array.isArray(c.value)
                          ? c.value
                          : []
                        : Array.isArray(c.value)
                          ? (c.value[0] ?? '')
                          : c.value,
                  })
                }
              />
              {on === 'valueInr' ? (
                <NumberField
                  label="Amount (INR)"
                  value={typeof c.value === 'number' ? c.value : Number(c.value) || undefined}
                  onChange={(v) => update(i, { value: v ?? 0 })}
                  error={errors[`cases.${i}.value`]}
                  min={0}
                />
              ) : c.op === 'contains' || c.op === 'in' || Array.isArray(c.value) ? (
                <TagsField
                  label={on === 'reply_keyword' ? 'Keywords' : 'Values'}
                  value={Array.isArray(c.value) ? c.value : c.value ? [String(c.value)] : []}
                  onChange={(v) => update(i, { value: v })}
                  error={errors[`cases.${i}.value`]}
                  hint={
                    on === 'reply_keyword'
                      ? 'Any keyword matches. Hinglish works too: kitna, rate.'
                      : undefined
                  }
                  suggestions={on === 'source' ? LEAD_SOURCES : []}
                />
              ) : (
                <TextField
                  label="Value"
                  value={String(c.value ?? '')}
                  onChange={(v) => update(i, { value: v })}
                  error={errors[`cases.${i}.value`]}
                />
              )}
            </li>
          ))}
        </ol>
        {errors.cases && <p className="text-xs text-danger-text">{errors.cases}</p>}
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={addCase}
          disabled={cases.length >= 12}
        >
          <Plus aria-hidden />
          Add case
        </Button>
        <p className="text-2xs text-muted">
          Cases are checked in order; the first match wins. Leads that match none continue on
          Default.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- logic.condition

export function ConditionEditor({ config, onChange, errors }: EditorProps) {
  const kind = String(config.kind ?? 'replied') as 'replied' | 'keyword' | 'field';
  const rule =
    (config.rule as { field?: string; op?: CompareOp; value?: unknown } | undefined) ?? {};
  const setKind = (k: typeof kind) => {
    if (k === kind) return;
    if (k === 'replied') onChange({ kind: k, since: 'last_outbound' });
    else if (k === 'keyword') onChange({ kind: k, keywords: [], matchAll: false });
    else onChange({ kind: k, rule: { field: 'lead.city', op: 'eq', value: '' } });
  };
  const setRule = (patch: Partial<typeof rule>) =>
    onChange(
      { ...config, rule: { ...rule, ...patch } },
      { coalesceKey: `rule:${Object.keys(patch).join(',')}` },
    );
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        legend="Check"
        value={kind}
        options={[
          { value: 'replied', label: 'Replied' },
          { value: 'keyword', label: 'Keyword' },
          { value: 'field', label: 'Field' },
        ]}
        onChange={setKind}
      />
      {kind === 'replied' && (
        <SelectField
          label="Lead replied"
          value={String(config.since ?? 'last_outbound')}
          options={[
            { value: 'last_outbound', label: 'Since our last message' },
            { value: 'run_start', label: 'Since the run started' },
          ]}
          onChange={(v) => onChange({ ...config, since: v ?? 'last_outbound' })}
          hint="Yes when an inbound message arrived in that time."
        />
      )}
      {kind === 'keyword' && (
        <>
          <TagsField
            label="Reply contains"
            value={(config.keywords as string[]) ?? []}
            onChange={(v) => onChange({ ...config, keywords: v })}
            error={errors.keywords}
            hint="Case-insensitive. Hinglish keywords work too, for example kitna or rate."
            required
          />
          <CheckboxField
            label="Match all keywords"
            hint="Off: any keyword is enough."
            checked={config.matchAll === true}
            onChange={(v) => onChange({ ...config, matchAll: v })}
          />
        </>
      )}
      {kind === 'field' && (
        <RuleFields rule={rule} onChange={setRule} errors={errors} prefix="rule." />
      )}
    </div>
  );
}

function RuleFields({
  rule,
  onChange,
  errors,
  prefix,
}: {
  rule: { field?: string; op?: CompareOp; value?: unknown };
  onChange: (p: { field?: string; op?: CompareOp; value?: unknown }) => void;
  errors: Record<string, string>;
  prefix: string;
}) {
  const op = rule.op ?? 'eq';
  const known = RULE_FIELD_OPTIONS.some((o) => o.value === rule.field);
  return (
    <div className="flex flex-col gap-2">
      <SelectField
        label="Field"
        value={known ? rule.field : rule.field ? '__custom' : undefined}
        options={[...RULE_FIELD_OPTIONS, { value: '__custom', label: 'Custom field…' }]}
        onChange={(v) => onChange({ field: v === '__custom' ? 'lead.custom.' : v })}
        error={errors[`${prefix}field`]}
        required
      />
      {!known && rule.field !== undefined && (
        <TextField
          label="Field path"
          value={rule.field}
          onChange={(v) => onChange({ field: v })}
          hint="For example lead.custom.gst"
        />
      )}
      <SelectField
        label="Operator"
        value={op}
        options={OP_OPTIONS}
        onChange={(v) => onChange({ op: (v ?? 'eq') as CompareOp })}
      />
      {op !== 'exists' &&
        (op === 'in' ? (
          <TagsField
            label="Values"
            value={Array.isArray(rule.value) ? (rule.value as string[]) : []}
            onChange={(v) => onChange({ value: v })}
            error={errors[`${prefix}value`]}
          />
        ) : ['gt', 'gte', 'lt', 'lte'].includes(op) ? (
          <NumberField
            label="Value"
            value={typeof rule.value === 'number' ? rule.value : undefined}
            onChange={(v) => onChange({ value: v })}
            error={errors[`${prefix}value`]}
          />
        ) : (
          <TextField
            label="Value"
            value={
              typeof rule.value === 'string'
                ? rule.value
                : rule.value === undefined
                  ? ''
                  : String(rule.value)
            }
            onChange={(v) => onChange({ value: v })}
            error={errors[`${prefix}value`]}
          />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------- action.assign_owner

const STRATEGIES = [
  { value: 'round_robin', label: 'Round robin', hint: 'Rotate through the pool in turn.' },
  {
    value: 'least_busy',
    label: 'Least busy',
    hint: 'Fewest open leads; people on call count as busier.',
  },
  {
    value: 'rule',
    label: 'By rule',
    hint: 'First matching rule picks the owner; otherwise round robin.',
  },
  { value: 'specific', label: 'Specific person', hint: 'Always the same owner.' },
] as const;

interface AssignRule {
  field: string;
  op: CompareOp;
  value?: unknown;
  userId: string;
}

export function AssignOwnerEditor({ config, onChange, errors }: EditorProps) {
  const strategy = String(config.strategy ?? 'round_robin');
  const userIds = (config.userIds as string[]) ?? [];
  const rules = (config.rules as AssignRule[]) ?? [];
  const name = useId();
  const setRules = (next: AssignRule[]) =>
    onChange({ ...config, rules: next }, { coalesceKey: 'rules' });
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-xs font-medium text-fg-secondary">Strategy</legend>
        {STRATEGIES.map((s) => (
          <label
            key={s.value}
            className={cn(
              'flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 transition-colors duration-150',
              strategy === s.value
                ? 'border-accent bg-accent-soft'
                : 'border-border hover:bg-surface-2',
            )}
          >
            <input
              type="radio"
              name={name}
              value={s.value}
              checked={strategy === s.value}
              onChange={() => onChange({ ...config, strategy: s.value })}
              className="focus-ring mt-0.5 accent-[var(--accent)]"
            />
            <span>
              <span className="block text-xs font-medium text-fg">{s.label}</span>
              <span
                className={cn(
                  'block text-2xs',
                  strategy === s.value ? 'text-muted-strong' : 'text-muted',
                )}
              >
                {s.hint}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {strategy === 'specific' ? (
        <SelectField
          label="Owner"
          value={userIds[0]}
          options={USER_OPTIONS}
          onChange={(v) => onChange({ ...config, userIds: v ? [v] : [] })}
          error={errors.userIds}
          required
          placeholder="Choose a person"
        />
      ) : (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-xs font-medium text-fg-secondary">Pool</legend>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {USER_OPTIONS.map((u) => (
              <CheckboxField
                key={u.value}
                label={u.label}
                checked={userIds.includes(u.value)}
                onChange={(on) =>
                  onChange({
                    ...config,
                    userIds: on ? [...userIds, u.value] : userIds.filter((x) => x !== u.value),
                  })
                }
              />
            ))}
          </div>
          <p className="text-xs text-muted">Leave empty to use every active sales rep.</p>
        </fieldset>
      )}

      {strategy === 'rule' && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-fg-secondary">Rules</p>
          {rules.length === 0 && (
            <p className="text-xs text-muted">
              Add a rule, for example “City is Ludhiana → Rohit Verma”.
            </p>
          )}
          <ol className="flex flex-col gap-2">
            {rules.map((r, i) => (
              <li
                key={i}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-2xs font-semibold text-muted-strong">Rule {i + 1}</span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove rule ${i + 1}`}
                    onClick={() => setRules(rules.filter((_, j) => j !== i))}
                  >
                    <Trash aria-hidden />
                  </Button>
                </div>
                <RuleFields
                  rule={r}
                  onChange={(p) => setRules(rules.map((x, j) => (j === i ? { ...x, ...p } : x)))}
                  errors={errors}
                  prefix={`rules.${i}.`}
                />
                <SelectField
                  label="Assign to"
                  value={r.userId || undefined}
                  options={USER_OPTIONS}
                  onChange={(v) =>
                    setRules(rules.map((x, j) => (j === i ? { ...x, userId: v ?? '' } : x)))
                  }
                  error={errors[`rules.${i}.userId`]}
                  required
                  placeholder="Choose a person"
                />
              </li>
            ))}
          </ol>
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            onClick={() =>
              setRules([...rules, { field: 'lead.city', op: 'eq', value: '', userId: '' }])
            }
          >
            <Plus aria-hidden />
            Add rule
          </Button>
        </div>
      )}

      <CheckboxField
        label="Only if the lead has no owner"
        hint="Leads that already have an owner keep them."
        checked={config.onlyIfUnassigned !== false}
        onChange={(v) => onChange({ ...config, onlyIfUnassigned: v })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------- trigger.schedule

export function ScheduleEditor({
  config,
  onChange,
  errors,
  timeZone,
}: EditorProps & { timeZone: string }) {
  const cron = String(config.cron ?? '');
  const human = describeCron(cron);
  const cronError = errors.cron ?? (cron ? validateCron(cron) : null) ?? undefined;
  const preset = CRON_PRESETS.find((p) => p.value === cron.trim());
  const shape =
    (nodeConfigSchemas['trigger.schedule'].shape.leadFilter as unknown as ZodLike).shape ?? {};
  const filter = (config.leadFilter as Config) ?? { stageKeys: [], tags: [] };
  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Repeat"
        value={preset ? preset.value : '__custom'}
        options={[...CRON_PRESETS, { value: '__custom', label: 'Custom (cron)…' }]}
        onChange={(v) => v && v !== '__custom' && onChange({ ...config, cron: v })}
      />
      <FormField
        label="Cron expression"
        error={cronError}
        hint="minute hour day month weekday"
        required
      >
        <Input
          value={cron}
          onChange={(e) => onChange({ ...config, cron: e.target.value }, { coalesceKey: 'cron' })}
          className="font-mono"
          spellCheck={false}
        />
      </FormField>
      <p
        className="rounded-md bg-surface-2 px-2.5 py-2 text-xs text-fg-secondary"
        aria-live="polite"
      >
        {human ? (
          <>
            <span className="font-medium text-fg">{human}</span>
            <span className="block text-2xs text-muted">Workspace time ({timeZone})</span>
          </>
        ) : (
          'Enter a valid schedule to see when it runs.'
        )}
      </p>
      <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-xs font-medium text-fg-secondary">
          Leads to enrol on each run
        </legend>
        <SchemaFields
          type="trigger.schedule"
          shape={shape}
          value={filter}
          onChange={(next) =>
            onChange({ ...config, leadFilter: next }, { coalesceKey: 'leadFilter' })
          }
          errors={errors}
          prefix="leadFilter."
        />
      </fieldset>
    </div>
  );
}

// ---------------------------------------------------------------------------- logic.wait

export function WaitEditor({
  config,
  onChange,
  errors,
  hoursText,
}: EditorProps & { hoursText: string }) {
  const amount = typeof config.amount === 'number' ? config.amount : undefined;
  const unit = String(config.unit ?? 'hours');
  const bh = config.businessHoursOnly !== false;
  const resume = config.resumeOnReply === true;
  const unitLabel = amount === 1 ? unit.replace(/s$/, '') : unit;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[1fr_1.2fr] gap-2">
        <NumberField
          label="Wait for"
          value={amount}
          onChange={(v) =>
            onChange({ ...config, amount: v ?? undefined }, { coalesceKey: 'amount' })
          }
          min={1}
          max={10000}
          error={errors.amount}
          required
        />
        <SelectField
          label="Unit"
          value={unit}
          options={['minutes', 'hours', 'days'].map((u) => ({ value: u, label: enumLabel(u) }))}
          onChange={(v) => onChange({ ...config, unit: v ?? 'hours' })}
          error={errors.unit}
          required
        />
      </div>
      <CheckboxField
        label="Count business hours only"
        hint={hoursText}
        checked={bh}
        onChange={(v) => onChange({ ...config, businessHoursOnly: v })}
      />
      <CheckboxField
        label="Continue early when the lead replies"
        checked={resume}
        onChange={(v) => onChange({ ...config, resumeOnReply: v })}
      />
      <p className="rounded-md bg-surface-2 px-2.5 py-2 text-xs text-fg-secondary">
        {amount
          ? `Waits ${amount} ${bh ? 'business ' : ''}${unitLabel}${bh ? ', skipping holidays' : ''}${resume ? ', or continues as soon as the lead replies' : ''}.`
          : 'Set how long to wait.'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------- WhatsApp template

export function WhatsAppTemplateEditor({ config, onChange, errors }: EditorProps) {
  const name = String(config.templateName ?? '');
  const variables = (config.variables as Record<string, string>) ?? {};
  const tpl = WHATSAPP_TEMPLATE_FIXTURES.find((t) => t.name === name);
  const radio = useId();
  const preview = tpl ? renderWhatsAppTemplate(name, variables, previewContext()) : null;
  return (
    <div className="flex flex-col gap-3">
      <fieldset
        className="flex flex-col gap-1.5"
        aria-describedby={errors.templateName ? `${radio}-err` : undefined}
      >
        <legend className="mb-1.5 text-xs font-medium text-fg-secondary">
          Template
          <span aria-hidden className="ml-0.5 text-danger-text">
            *
          </span>
        </legend>
        <p className="mb-1 text-2xs text-muted">
          Approved templates only. They can start a conversation outside the 24-hour window.
        </p>
        <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-0.5">
          {WHATSAPP_TEMPLATE_FIXTURES.map((t) => (
            <label
              key={t.name}
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 transition-colors duration-150',
                name === t.name
                  ? 'border-accent bg-accent-soft'
                  : 'border-border hover:bg-surface-2',
              )}
            >
              <input
                type="radio"
                name={radio}
                value={t.name}
                checked={name === t.name}
                onChange={() =>
                  onChange({
                    ...config,
                    templateName: t.name,
                    variables: defaultTemplateVariables(t.name),
                  })
                }
                className="focus-ring mt-0.5 accent-[var(--accent)]"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-mono text-xs font-medium text-fg">{t.name}</span>
                  <Chip tone={t.category === 'marketing' ? 'amber' : 'green'}>
                    {enumLabel(t.category)}
                  </Chip>
                </span>
                <span
                  className={cn(
                    'mt-0.5 line-clamp-2 block text-2xs',
                    name === t.name ? 'text-muted-strong' : 'text-muted',
                  )}
                >
                  {t.body}
                </span>
              </span>
            </label>
          ))}
        </div>
        {errors.templateName && (
          <p id={`${radio}-err`} role="alert" className="text-xs text-danger-text">
            {name ? 'This template is not approved. Pick one from the list.' : 'Pick a template'}
          </p>
        )}
        {name && !tpl && !errors.templateName && (
          <p className="text-xs text-danger-text">
            “{name}” is not an approved template. Pick one from the list.
          </p>
        )}
      </fieldset>
      <SelectField
        label="Language"
        value={String(config.language ?? 'en')}
        options={[
          { value: 'en', label: 'English' },
          { value: 'hi', label: 'Hindi' },
        ]}
        onChange={(v) => onChange({ ...config, language: v ?? 'en' })}
      />
      {tpl && tpl.variables.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-fg-secondary">Fill the template</p>
          {tpl.variables.map((_, i) => {
            const slot = String(i + 1);
            return (
              <TemplateTextField
                key={slot}
                label={`{{${slot}}}`}
                value={variables[slot] ?? ''}
                onChange={(v) =>
                  onChange(
                    { ...config, variables: { ...variables, [slot]: v } },
                    { coalesceKey: `var:${slot}` },
                  )
                }
              />
            );
          })}
        </div>
      )}
      <MessagePreview text={preview} />
    </div>
  );
}

// ---------------------------------------------------------------------------- action.update_field

export function UpdateFieldEditor({ config, onChange, errors }: EditorProps) {
  const field = String(config.field ?? '');
  const isCustom =
    field.startsWith('custom.') ||
    (field !== '' && !UPDATE_FIELD_OPTIONS.some((o) => o.value === field));
  const value = config.value;
  const cleared = value === null;
  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Field"
        value={isCustom ? '__custom' : field || undefined}
        options={[...UPDATE_FIELD_OPTIONS, { value: '__custom', label: 'Custom field…' }]}
        onChange={(v) =>
          onChange({
            field: v === '__custom' ? 'custom.' : (v ?? ''),
            value: v === 'temperature' ? 'warm' : v === 'valueInr' ? 0 : '',
          })
        }
        error={errors.field}
        required
      />
      {isCustom && (
        <TextField
          label="Custom field key"
          value={field.replace(/^custom\./, '')}
          onChange={(v) =>
            onChange(
              { ...config, field: `custom.${v.replace(/\s+/g, '_')}` },
              { coalesceKey: 'custom-key' },
            )
          }
          hint="Stored as custom.<key> on the lead."
        />
      )}
      <CheckboxField
        label="Clear the value"
        checked={cleared}
        onChange={(on) => onChange({ ...config, value: on ? null : field === 'valueInr' ? 0 : '' })}
      />
      {!cleared &&
        (field === 'temperature' ? (
          <SelectField
            label="Value"
            value={String(value ?? 'warm')}
            options={LEAD_TEMPERATURES.map((t) => ({ value: t, label: enumLabel(t) }))}
            onChange={(v) => onChange({ ...config, value: v ?? 'warm' })}
            error={errors.value}
          />
        ) : field === 'valueInr' ? (
          <NumberField
            label="Value (INR)"
            value={typeof value === 'number' ? value : undefined}
            onChange={(v) => onChange({ ...config, value: v ?? 0 })}
            min={0}
            error={errors.value}
          />
        ) : field === 'nextFollowUpAt' ? (
          <TextField
            label="Follow up on"
            type="datetime-local"
            value={typeof value === 'string' ? value.slice(0, 16) : ''}
            onChange={(v) => onChange({ ...config, value: v })}
            error={errors.value}
          />
        ) : (
          <TemplateTextField
            label="Value"
            value={typeof value === 'string' ? value : String(value ?? '')}
            onChange={(v) => onChange({ ...config, value: v }, { coalesceKey: 'value' })}
            error={errors.value}
          />
        ))}
    </div>
  );
}
