'use client';

import { LEAD_SOURCES, type NodeType } from '@vistar/shared';
import { mockUsers, TAGS } from '@vistar/shared/fixtures';
import type { ReactNode } from 'react';
import { enumLabel, FIELD_HINTS, fieldLabel, LANGUAGE_OPTIONS, SOURCE_LABELS, STAGE_OPTIONS } from '../../lib/labels';
import { CheckboxField, KeyValueField, MultiCheckField, NumberField, SelectField, TagsField, TemplateTextField, TextField, type Option } from './fields';

/** Minimal view of zod 4 schemas used for form generation (avoids `any`). */
export interface ZodLike {
  def: { type: string; innerType?: ZodLike; element?: ZodLike; defaultValue?: unknown };
  description?: string;
  options?: unknown[];
  shape?: Record<string, ZodLike>;
  minLength?: number | null;
  maxLength?: number | null;
  minValue?: number | null;
  maxValue?: number | null;
  format?: string | null;
}

export interface FieldDesc {
  kind: 'string' | 'number' | 'boolean' | 'enum' | 'stringArray' | 'enumArray' | 'record' | 'object' | 'other';
  optional: boolean;
  nullable: boolean;
  hasDefault: boolean;
  options: string[];
  min?: number;
  max?: number;
  maxLength?: number;
  format?: string | null;
  shape?: Record<string, ZodLike>;
  description?: string;
}

export function describeField(schema: ZodLike): FieldDesc {
  let s = schema;
  let optional = false;
  let nullable = false;
  let hasDefault = false;
  let description = schema.description;
  for (let i = 0; i < 6; i++) {
    const t = s.def.type;
    if (t === 'optional') optional = true;
    else if (t === 'nullable') nullable = true;
    else if (t === 'default' || t === 'prefault') hasDefault = true;
    else break;
    s = s.def.innerType!;
    description ??= s.description;
  }
  const base = { optional, nullable, hasDefault, options: [] as string[], description };
  switch (s.def.type) {
    case 'string':
      return { ...base, kind: 'string', maxLength: s.maxLength ?? undefined, format: s.format };
    case 'number':
      return { ...base, kind: 'number', min: s.minValue ?? undefined, max: s.maxValue ?? undefined };
    case 'boolean':
      return { ...base, kind: 'boolean' };
    case 'enum':
      return { ...base, kind: 'enum', options: (s.options ?? []).map(String) };
    case 'array': {
      const el = describeField(s.def.element!);
      return el.kind === 'enum' ? { ...base, kind: 'enumArray', options: el.options } : { ...base, kind: 'stringArray' };
    }
    case 'record':
      return { ...base, kind: 'record' };
    case 'object':
      return { ...base, kind: 'object', shape: s.shape };
    default:
      return { ...base, kind: 'other' };
  }
}

const USERS = mockUsers();
export const USER_OPTIONS: Option[] = USERS.filter((u) => u.role !== 'viewer').map((u) => ({ value: u.id, label: u.name }));

const TEMPLATED_FIELDS = new Set(['title', 'body', 'subject', 'bodyTemplate', 'notes']);
const MULTILINE_FIELDS = new Set(['body', 'bodyTemplate', 'notes']);

/** Field visibility rules per node type. */
const VISIBLE: Partial<Record<NodeType, Record<string, (c: Record<string, unknown>) => boolean>>> = {
  'action.create_task': { userId: (c) => c.assignTo === 'user' },
  'action.upsert_contact': { dealValueInr: (c) => c.createDeal !== false },
};

export interface SchemaFieldsProps {
  type: NodeType;
  shape: Record<string, ZodLike>;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>, changedKey: string) => void;
  errors: Record<string, string>;
  /** Path prefix for nested objects ("leadFilter."). */
  prefix?: string;
  /** Keys rendered elsewhere (custom editors). */
  skip?: readonly string[];
  /** Custom widgets by key. */
  render?: Partial<Record<string, () => ReactNode>>;
}

export function SchemaFields({ type, shape, value, onChange, errors, prefix = '', skip = [], render = {} }: SchemaFieldsProps) {
  const set = (key: string, v: unknown) => {
    const next = { ...value };
    if (v === undefined) delete next[key];
    else next[key] = v;
    onChange(next, key);
  };
  return (
    <>
      {Object.entries(shape).map(([key, schema]) => {
        if (skip.includes(key)) return null;
        const visible = VISIBLE[type]?.[key];
        if (visible && !visible(value)) return null;
        const custom = render[key];
        if (custom) return <div key={key}>{custom()}</div>;
        const desc = describeField(schema);
        const path = `${prefix}${key}`;
        const error = errors[path];
        const label = fieldLabel(key);
        const hint = FIELD_HINTS[key] ?? (desc.description && desc.description.length < 90 ? desc.description : undefined);
        const required = !desc.optional && !desc.hasDefault && !desc.nullable;
        const v = value[key];
        return <div key={key}>{renderField({ key, type, desc, v, set, error, label, hint, required, errors, prefix: path })}</div>;
      })}
    </>
  );
}

function renderField(a: {
  key: string;
  type: NodeType;
  desc: FieldDesc;
  v: unknown;
  set: (key: string, v: unknown) => void;
  error?: string;
  label: string;
  hint?: string;
  required: boolean;
  errors: Record<string, string>;
  prefix: string;
}): ReactNode {
  const { key, desc, v, set, error, label, hint, required } = a;
  const str = typeof v === 'string' ? v : '';
  const arr = Array.isArray(v) ? (v as string[]) : [];

  // Key-based widgets first.
  if (key === 'stageKey' || key === 'fromStageKey' || key === 'toStageKey') {
    return <SelectField label={label} value={str || undefined} options={STAGE_OPTIONS} onChange={(x) => set(key, x)} error={error} hint={hint} required={required} placeholder={desc.optional ? 'Any stage' : 'Choose a stage'} />;
  }
  if (key === 'userId') {
    return <SelectField label={label} value={str || undefined} options={USER_OPTIONS} onChange={(x) => set(key, x)} error={error} required placeholder="Choose a person" />;
  }
  if (key === 'userIds') {
    return <MultiCheckField legend={label} options={USER_OPTIONS} value={arr} onChange={(x) => set(key, x)} error={error} hint={hint} />;
  }
  if (key === 'stageKeys') {
    return <MultiCheckField legend={label} options={STAGE_OPTIONS} value={arr} onChange={(x) => set(key, x)} error={error} hint="Leave empty for every stage." />;
  }
  if (key === 'sources') {
    return <MultiCheckField legend={label} options={LEAD_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))} value={arr} onChange={(x) => set(key, x)} error={error} hint={hint} />;
  }
  if (key === 'language') {
    return <SelectField label={label} value={str || 'en'} options={LANGUAGE_OPTIONS} onChange={(x) => set(key, x ?? 'en')} error={error} />;
  }
  if (key === 'tags') {
    return <TagsField label={label} value={arr} onChange={(x) => set(key, x)} error={error} hint={hint} required={required} suggestions={TAGS} normalise={(s) => s.toLowerCase().replace(/\s+/g, '-')} />;
  }
  if (key === 'labels') {
    return (
      <TagsField
        label={label}
        value={arr}
        onChange={(x) => set(key, x)}
        error={error}
        hint="Lowercase words with underscores. Each label becomes an output."
        normalise={(s) => s.toLowerCase().replace(/[^a-z0-9_]+/g, '_')}
      />
    );
  }

  switch (desc.kind) {
    case 'string':
      if (TEMPLATED_FIELDS.has(key)) {
        const sms = a.type === 'action.send_sms' && key === 'body';
        return (
          <TemplateTextField
            label={label}
            value={str}
            onChange={(x) => set(key, x === '' && desc.optional ? undefined : x)}
            error={error}
            hint={hint}
            required={required}
            multiline={MULTILINE_FIELDS.has(key)}
            maxLength={desc.maxLength}
            preview={key === 'title' || key === 'subject'}
            counter={sms ? smsCounter : undefined}
            placeholder={key === 'bodyTemplate' ? '{"name": "{{lead.name}}"}' : undefined}
          />
        );
      }
      return (
        <TextField
          label={label}
          value={str}
          onChange={(x) => set(key, x === '' && desc.optional ? undefined : x)}
          error={error}
          hint={hint}
          required={required}
          type={desc.format === 'url' ? 'url' : 'text'}
          maxLength={desc.maxLength}
          placeholder={desc.format === 'url' ? 'https://' : undefined}
        />
      );
    case 'number':
      return (
        <NumberField
          label={label}
          value={typeof v === 'number' ? v : v === null ? null : undefined}
          onChange={(x) => set(key, x)}
          emptyValue={desc.nullable ? null : undefined}
          min={desc.min}
          max={desc.max}
          error={error}
          hint={hint}
          required={required}
        />
      );
    case 'boolean':
      return <CheckboxField label={label} hint={hint} checked={v === true} onChange={(x) => set(key, x)} />;
    case 'enum':
      return (
        <SelectField
          label={label}
          value={str || undefined}
          options={desc.options.map((o) => ({ value: o, label: enumLabel(o) }))}
          onChange={(x) => set(key, x)}
          error={error}
          hint={hint}
          required={required}
        />
      );
    case 'enumArray':
      return <MultiCheckField legend={label} options={desc.options.map((o) => ({ value: o, label: enumLabel(o) }))} value={arr} onChange={(x) => set(key, x)} error={error} hint={hint} />;
    case 'stringArray':
      return <TagsField label={label} value={arr} onChange={(x) => set(key, x)} error={error} hint={hint} required={required} />;
    case 'record':
      return <KeyValueField label={label} value={(v as Record<string, string>) ?? {}} onChange={(x) => set(key, x)} />;
    case 'object':
      return (
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-xs font-medium text-fg-secondary">{label}</legend>
          <SchemaFields
            type={a.type}
            shape={desc.shape ?? {}}
            value={(v as Record<string, unknown>) ?? {}}
            onChange={(next) => set(key, next)}
            errors={a.errors}
            prefix={`${a.prefix}.`}
          />
        </fieldset>
      );
    default:
      return null;
  }
}

/** SMS length: 160 characters per part (153 when split). */
export function smsCounter(v: string): string {
  const n = v.length;
  const parts = n <= 160 ? 1 : Math.ceil(n / 153);
  return `${n} characters · ${parts} SMS ${parts === 1 ? 'part' : 'parts'}`;
}
