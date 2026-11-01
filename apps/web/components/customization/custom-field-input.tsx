'use client';

import {
  parseTarget,
  type CustomFieldValue,
  type FieldTarget,
  type LeadListItem,
} from '@vistar/shared';
import { mockUsers } from '@vistar/shared/fixtures';
import { format } from 'date-fns';
import { Check, Crosshair, Paperclip, X } from 'lucide-react';
import { useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/leads/primitives/select';
import { useRecord, useRecords } from '@/lib/customization';
import { useLead, useLeadsList } from '@/lib/leads/data';
import { cn } from '@/lib/cn';
import { configOf, groupIndian, relationTargetOf, shortId, type FieldDef } from './field-utils';
import { Picker, type PickerOption } from './primitives/picker';
import { Switch } from './primitives/switch';
import { useTargetLabel } from './relation-values';

export interface CustomFieldInputProps {
  def: FieldDef;
  value: CustomFieldValue | undefined;
  /** Typed value (null clears). Text that does not parse is passed through so validation can explain it. */
  onChange: (value: CustomFieldValue) => void;
  onBlur?: () => void;
  /** Id of the focusable control (the label's htmlFor). */
  id: string;
  /** Id of the visible label (composite controls use aria-labelledby). */
  labelId: string;
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
  required?: boolean;
}

/** Types rendered as a group of controls (label is not a <label for>). */
export function isGroupControl(def: Pick<FieldDef, 'type' | 'config'>): boolean {
  if (def.type === 'geo_point' || def.type === 'file') return true;
  if (def.type === 'multi_select')
    return configOf({ type: 'multi_select', config: def.config }).options.length <= INLINE_CHOICES;
  return false;
}

const INLINE_CHOICES = 10;
const NONE = '__none';
const ctrl = 'h-11 sm:h-8';
const join = (...ids: Array<string | undefined | null | false>) =>
  ids.filter(Boolean).join(' ') || undefined;

/** One input for any custom field type (FIELD_TYPES). Controlled; labels, help and errors come from the caller. */
export function CustomFieldInput(props: CustomFieldInputProps) {
  switch (props.def.type) {
    case 'text':
      return <TextInput {...props} />;
    case 'number':
    case 'money':
      return <NumberInput {...props} />;
    case 'date':
      return <DateInput {...props} />;
    case 'select':
      return <SelectInput {...props} />;
    case 'multi_select':
      return <MultiSelectInput {...props} />;
    case 'user':
      return <UserInput {...props} />;
    case 'relation':
      return <RelationInput {...props} />;
    case 'file':
      return <FileInput {...props} />;
    case 'geo_point':
      return <GeoInput {...props} />;
    case 'boolean':
      return <BooleanInput {...props} />;
    case 'url':
      return <UrlInput {...props} />;
  }
}

// ---------------------------------------------------------------- text, url

function TextInput({
  def,
  value,
  onChange,
  onBlur,
  id,
  describedBy,
  invalid,
  disabled,
  required,
}: CustomFieldInputProps) {
  const c = configOf({ type: 'text', config: def.config });
  const text =
    typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
  const showCount = c.maxLength <= 200 || text.length >= c.maxLength * 0.8;
  const countId = `${id}-count`;
  const common = {
    id,
    value: text,
    disabled,
    required,
    maxLength: c.maxLength,
    'aria-invalid': invalid || undefined,
    'aria-describedby': join(describedBy, showCount && countId),
    onBlur,
  };
  return (
    <div className="flex flex-col gap-1">
      {c.multiline ? (
        <Textarea {...common} onChange={(e) => onChange(e.target.value)} className="min-h-24" />
      ) : (
        <Input
          {...common}
          onChange={(e) => onChange(e.target.value)}
          className={ctrl}
          autoComplete="off"
        />
      )}
      {showCount && (
        <p id={countId} className="tabular self-end text-2xs text-muted">
          <span className="sr-only">Characters used: </span>
          {text.length}/{c.maxLength}
        </p>
      )}
    </div>
  );
}

function UrlInput({
  value,
  onChange,
  onBlur,
  id,
  describedBy,
  invalid,
  disabled,
  required,
}: CustomFieldInputProps) {
  const text = typeof value === 'string' ? value : '';
  return (
    <Input
      id={id}
      type="url"
      inputMode="url"
      autoComplete="url"
      placeholder="https://"
      value={text}
      disabled={disabled}
      required={required}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={ctrl}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        // "example.com" -> "https://example.com" (the API only accepts full links).
        const t = text.trim();
        if (t && !/^[a-z][a-z0-9+.-]*:/i.test(t) && /^[^\s/]+\.[^\s]+$/.test(t))
          onChange(`https://${t}`);
        else if (t !== text) onChange(t);
        onBlur?.();
      }}
    />
  );
}

// ---------------------------------------------------------------- number, money

function parseNumberText(t: string, money: boolean): CustomFieldValue {
  const raw = t.replace(money ? /[₹,\s]/g : /[,\s]/g, '');
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : t;
}

function NumberInput({
  def,
  value,
  onChange,
  onBlur,
  id,
  describedBy,
  invalid,
  disabled,
  required,
}: CustomFieldInputProps) {
  const money = def.type === 'money';
  const c = money ? null : configOf({ type: 'number', config: def.config });
  const toText = (v: CustomFieldValue | undefined, grouped: boolean) =>
    typeof v === 'number' ? (grouped ? groupIndian(v) : String(v)) : typeof v === 'string' ? v : '';
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(() => toText(value, money));
  const [synced, setSynced] = useState<CustomFieldValue | undefined>(value);
  // Follow outside changes (reset, server value) while the field is not being edited.
  if (!focused && !Object.is(value, synced)) {
    setSynced(value);
    setText(toText(value, money));
  }
  const unit = money ? null : (c?.unit ?? null);
  const unitId = `${id}-unit`;
  const decimals = money || c?.integer ? false : true;
  return (
    <div className="relative">
      {money && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted"
        >
          ₹
        </span>
      )}
      <Input
        id={id}
        type="text"
        inputMode={decimals ? 'decimal' : 'numeric'}
        autoComplete="off"
        value={text}
        disabled={disabled}
        required={required}
        aria-invalid={invalid || undefined}
        aria-describedby={join(describedBy, (money || unit) && unitId)}
        className={cn(ctrl, 'tabular', money && 'pl-6', unit && 'pr-12')}
        onFocus={() => {
          setFocused(true);
          if (money && typeof value === 'number') setText(String(value));
        }}
        onChange={(e) => {
          const next = parseNumberText(e.target.value, money);
          setText(e.target.value);
          setSynced(next);
          onChange(next);
        }}
        onBlur={() => {
          setFocused(false);
          if (typeof value === 'number') setText(toText(value, money));
          onBlur?.();
        }}
      />
      {unit && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-2.5 max-w-10 -translate-y-1/2 truncate text-sm text-muted"
        >
          {unit}
        </span>
      )}
      {(money || unit) && (
        <span id={unitId} className="sr-only">
          {money ? 'Amount in whole rupees' : `Unit: ${unit}`}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- date

function DateInput({
  def,
  value,
  onChange,
  onBlur,
  id,
  describedBy,
  invalid,
  disabled,
  required,
}: CustomFieldInputProps) {
  const withTime = configOf({ type: 'date', config: def.config }).withTime;
  const str = typeof value === 'string' ? value : '';
  let shown = '';
  if (str) {
    if (!withTime) shown = str.slice(0, 10);
    else {
      const d = new Date(str);
      shown = Number.isNaN(d.getTime()) ? '' : format(d, "yyyy-MM-dd'T'HH:mm");
    }
  }
  return (
    <Input
      id={id}
      type={withTime ? 'datetime-local' : 'date'}
      value={shown}
      disabled={disabled}
      required={required}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn(ctrl, 'tabular')}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return onChange(null);
        if (!withTime) return onChange(v);
        const d = new Date(v);
        onChange(Number.isNaN(d.getTime()) ? v : d.toISOString());
      }}
      onBlur={onBlur}
    />
  );
}

// ---------------------------------------------------------------- select, multi-select

function SelectInput({
  def,
  value,
  onChange,
  id,
  describedBy,
  invalid,
  disabled,
  required,
}: CustomFieldInputProps) {
  const { options } = configOf({ type: 'select', config: def.config });
  const current = typeof value === 'string' && value ? value : undefined;
  return (
    <Select
      id={id}
      value={current ?? (required ? undefined : NONE)}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
      placeholder="Choose an option"
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      aria-required={required || undefined}
      className={ctrl}
      options={[
        ...(required ? [] : [{ value: NONE, label: <span className="text-muted">Not set</span> }]),
        ...options.map((o) => ({ value: o.value, label: o.label })),
      ]}
    />
  );
}

function MultiSelectInput({
  def,
  value,
  onChange,
  onBlur,
  id,
  labelId,
  describedBy,
  invalid,
  disabled,
}: CustomFieldInputProps) {
  const c = configOf({ type: 'multi_select', config: def.config });
  const selected = Array.isArray(value) ? value : [];
  const atMax = c.maxSelected !== undefined && selected.length >= c.maxSelected;
  const maxId = `${id}-max`;
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const labelFor = (v: string) => c.options.find((o) => o.value === v)?.label ?? v;
  const maxNote = c.maxSelected ? (
    <p id={maxId} className={cn('text-2xs', atMax ? 'text-fg-secondary' : 'text-muted')}>
      {atMax ? `${c.maxSelected} chosen, the most allowed` : `Choose up to ${c.maxSelected}`}
    </p>
  ) : null;

  if (c.options.length <= INLINE_CHOICES) {
    return (
      <div className="flex flex-col gap-1">
        <div
          id={id}
          role="group"
          aria-labelledby={labelId}
          aria-describedby={join(describedBy, maxNote && maxId)}
          className="flex flex-wrap gap-1.5"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onBlur?.();
          }}
        >
          {c.options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                disabled={disabled || (!on && atMax)}
                onClick={() => toggle(o.value)}
                className={cn(
                  'focus-ring inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors duration-150 sm:min-h-8',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  on
                    ? 'border-status-indigo-border bg-accent-soft text-accent-soft-fg'
                    : 'border-input bg-surface text-fg-secondary enabled:hover:bg-surface-2',
                )}
              >
                {on && <Check aria-hidden className="size-3.5" />}
                {o.label}
              </button>
            );
          })}
        </div>
        {maxNote}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {selected.length > 0 && (
        <ul aria-label={`Chosen: ${def.label}`} className="flex flex-wrap gap-1.5">
          {selected.map((v) => (
            <li key={v}>
              <RemovableChip label={labelFor(v)} onRemove={() => toggle(v)} disabled={disabled} />
            </li>
          ))}
        </ul>
      )}
      <Picker
        id={id}
        multiple
        options={c.options.map((o) => ({
          value: o.value,
          label: o.label,
          disabled: !selected.includes(o.value) && atMax,
        }))}
        selected={selected}
        onSelect={toggle}
        listLabel={def.label}
        triggerLabel={
          <span className="text-muted">
            {selected.length ? 'Change choices' : 'Choose options'}
          </span>
        }
        placeholder="Search options"
        disabled={disabled}
        invalid={invalid}
        describedBy={join(describedBy, maxNote && maxId)}
      />
      {maxNote}
    </div>
  );
}

function RemovableChip({
  label,
  onRemove,
  disabled,
  leading,
}: {
  label: string;
  onRemove: () => void;
  disabled?: boolean;
  leading?: ReactNode;
}) {
  return (
    <span className="inline-flex h-11 max-w-full items-center gap-1 rounded-full border border-border bg-surface-2 pr-0.5 pl-3 text-sm text-fg sm:h-7 sm:pl-2.5 sm:text-xs">
      {leading}
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${label}`}
        className="focus-ring inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-3 hover:text-fg disabled:opacity-50 sm:size-6"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </span>
  );
}

// ---------------------------------------------------------------- user

const ALL_USERS = mockUsers();

function UserInput({
  def,
  value,
  onChange,
  id,
  describedBy,
  invalid,
  disabled,
  required,
}: CustomFieldInputProps) {
  const c = configOf({ type: 'user', config: def.config });
  const users = useMemo(
    () => ALL_USERS.filter((u) => c.roleKinds.length === 0 || c.roleKinds.includes(u.role)),
    [c.roleKinds],
  );
  const ids = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
  const nameOf = (uid: string) =>
    ALL_USERS.find((u) => u.id === uid)?.name ?? `Former teammate ${shortId(uid)}`;
  const options: PickerOption[] = users.map((u) => ({
    value: u.id,
    label: u.name,
    hint: ROLE_HINT[u.role],
    leading: <Avatar name={u.name} size="xs" aria-hidden />,
  }));
  const pick = (uid: string) => {
    if (c.multiple) onChange(ids.includes(uid) ? ids.filter((x) => x !== uid) : [...ids, uid]);
    else onChange(ids[0] === uid && !required ? null : uid);
  };
  return (
    <div className="flex flex-col gap-1.5">
      {c.multiple && ids.length > 0 && (
        <ul aria-label={`Chosen: ${def.label}`} className="flex flex-wrap gap-1.5">
          {ids.map((uid) => (
            <li key={uid}>
              <RemovableChip
                label={nameOf(uid)}
                leading={<Avatar name={nameOf(uid)} size="xs" aria-hidden />}
                onRemove={() => pick(uid)}
                disabled={disabled}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1">
        <Picker
          id={id}
          multiple={c.multiple}
          options={options}
          selected={ids}
          onSelect={pick}
          listLabel={def.label}
          placeholder="Search people"
          emptyText="No one matches"
          triggerLabel={
            !c.multiple && ids[0] ? (
              <>
                <Avatar name={nameOf(ids[0])} size="xs" aria-hidden />
                <span className="truncate">{nameOf(ids[0])}</span>
              </>
            ) : (
              <span className="text-muted">
                {c.multiple && ids.length ? 'Add someone' : 'Choose a person'}
              </span>
            )
          }
          disabled={disabled}
          invalid={invalid}
          describedBy={describedBy}
          required={required}
        />
        {!c.multiple && ids[0] && !required && (
          <ClearButton label={def.label} onClear={() => onChange(null)} disabled={disabled} />
        )}
      </div>
    </div>
  );
}

const ROLE_HINT: Record<string, string> = {
  company_admin: 'Company admin',
  manager: 'Manager',
  employee: 'Sales rep',
  viewer: 'Viewer',
};

function ClearButton({
  label,
  onClear,
  disabled,
}: {
  label: string;
  onClear: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-11 shrink-0 sm:size-8"
      aria-label={`Clear ${label}`}
      onClick={onClear}
      disabled={disabled}
    >
      <X aria-hidden />
    </Button>
  );
}

// ---------------------------------------------------------------- relation

const idsOf = (v: CustomFieldValue | undefined): string[] =>
  Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : [];

function RelationInput(props: CustomFieldInputProps) {
  const target = relationTargetOf(props.def);
  const t = target ? parseTarget(target) : null;
  if (target && t?.kind === 'object')
    return <ObjectRelationInput {...props} target={target} objectKey={t.key} />;
  if (target && t?.kind === 'core' && t.entity === 'lead')
    return <LeadRelationInput {...props} target={target} />;
  const ids = idsOf(props.value);
  return (
    <div className="flex flex-col gap-1">
      <Input
        id={props.id}
        disabled
        value={ids.map(shortId).join(', ')}
        placeholder="Not linked"
        aria-describedby={join(props.describedBy, `${props.id}-note`)}
        className={ctrl}
        readOnly
      />
      <p id={`${props.id}-note`} className="text-2xs text-muted">
        Linking to this kind of record arrives in a later update.
      </p>
    </div>
  );
}

type RelationProps = CustomFieldInputProps & { target: FieldTarget };

function ObjectRelationInput(props: RelationProps & { objectKey: string }) {
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const records = useRecords(props.objectKey, {
    q: q || undefined,
    limit: 20,
    sort: 'title',
    dir: 'asc',
  });
  const options: PickerOption[] = (records.data?.items ?? []).map((r) => ({
    value: r.id,
    label: r.title || 'Untitled',
  }));
  return (
    <RelationPickerView
      {...props}
      search={search}
      onSearch={setSearch}
      q={q}
      options={options}
      loading={records.isFetching}
      chip={(rid, onRemove) => (
        <ObjectChip
          objectKey={props.objectKey}
          id={rid}
          onRemove={onRemove}
          disabled={props.disabled}
        />
      )}
    />
  );
}

function LeadRelationInput(props: RelationProps) {
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const list = useLeadsList({ q: q || undefined }, { sort: 'createdAt', dir: 'desc' }, 20);
  const items: LeadListItem[] = list.data?.pages[0]?.items ?? [];
  const options: PickerOption[] = items.map((l) => ({
    value: l.id,
    label: l.name,
    hint: [l.companyName, l.city].filter(Boolean).join(' · ') || undefined,
  }));
  return (
    <RelationPickerView
      {...props}
      search={search}
      onSearch={setSearch}
      q={q}
      options={options}
      loading={list.isFetching}
      chip={(rid, onRemove) => <LeadChip id={rid} onRemove={onRemove} disabled={props.disabled} />}
    />
  );
}

function RelationPickerView({
  def,
  value,
  onChange,
  id,
  describedBy,
  invalid,
  disabled,
  required,
  target,
  search,
  onSearch,
  q,
  options,
  loading,
  chip,
}: RelationProps & {
  search: string;
  onSearch: (s: string) => void;
  q: string;
  options: PickerOption[];
  loading: boolean;
  chip: (id: string, onRemove: () => void) => ReactNode;
}) {
  const multiple = configOf({ type: 'relation', config: def.config }).multiple;
  const ids = idsOf(value);
  const singular = useTargetLabel(target).toLowerCase();
  const plural = useTargetLabel(target, { plural: true });
  const lowerPlural = plural.toLowerCase();
  const pick = (rid: string) => {
    if (multiple) onChange(ids.includes(rid) ? ids.filter((x) => x !== rid) : [...ids, rid]);
    else onChange(ids[0] === rid && !required ? null : rid);
  };
  return (
    <div className="flex flex-col gap-1.5">
      {ids.length > 0 && (
        <ul aria-label={`Linked ${lowerPlural}`} className="flex flex-wrap gap-1.5">
          {ids.map((rid) => (
            <li key={rid} className="max-w-full">
              {chip(rid, () => (multiple ? pick(rid) : onChange(null)))}
            </li>
          ))}
        </ul>
      )}
      <Picker
        id={id}
        multiple={multiple}
        options={options}
        selected={ids}
        onSelect={pick}
        listLabel={plural}
        search={search}
        onSearchChange={onSearch}
        loading={loading}
        placeholder={`Search ${lowerPlural}`}
        emptyText={q ? `No ${lowerPlural} match "${q}"` : `No ${lowerPlural} yet`}
        triggerLabel={
          <span className="text-muted">
            {ids.length
              ? multiple
                ? `Link another ${singular}`
                : `Change ${singular}`
              : `Choose ${articleFor(singular)} ${singular}`}
          </span>
        }
        disabled={disabled}
        invalid={invalid}
        describedBy={describedBy}
        required={required}
      />
    </div>
  );
}

const articleFor = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

function ObjectChip({
  objectKey,
  id,
  onRemove,
  disabled,
}: {
  objectKey: string;
  id: string;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const q = useRecord(objectKey, id);
  const title = q.isPending
    ? 'Loading…'
    : q.data
      ? q.data.title || 'Untitled'
      : 'Record not available';
  return <RemovableChip label={title} onRemove={onRemove} disabled={disabled} />;
}

function LeadChip({
  id,
  onRemove,
  disabled,
}: {
  id: string;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const q = useLead(id);
  const title = q.isPending ? 'Loading…' : (q.data?.name ?? 'Record not available');
  return <RemovableChip label={title} onRemove={onRemove} disabled={disabled} />;
}

// ---------------------------------------------------------------- file

function FileInput({ value, id, labelId, describedBy }: CustomFieldInputProps) {
  const ids = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
  const noteId = `${id}-note`;
  return (
    <div
      id={id}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={join(describedBy, noteId)}
      className="flex flex-col gap-1.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled className="h-11 sm:h-8">
          <Paperclip aria-hidden />
          Upload file
        </Button>
        <p id={noteId} className="text-xs text-muted">
          File uploads arrive with storage.
        </p>
      </div>
      {ids.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-fg-secondary">
          {ids.map((f) => (
            <li key={f} className="inline-flex items-center gap-1.5">
              <Paperclip aria-hidden className="size-3.5 text-muted" />
              File {shortId(f)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- geo point

type GeoText = { lat: string; lng: string };
const geoToText = (v: CustomFieldValue | undefined): GeoText =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? {
        lat: Number.isNaN(v.lat) ? '' : String(v.lat),
        lng: Number.isNaN(v.lng) ? '' : String(v.lng),
      }
    : { lat: '', lng: '' };
const geoFromText = (t: GeoText): CustomFieldValue => {
  if (!t.lat.trim() && !t.lng.trim()) return null;
  const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s.trim()));
  return { lat: num(t.lat), lng: num(t.lng) };
};

function GeoInput({
  value,
  onChange,
  onBlur,
  id,
  labelId,
  describedBy,
  invalid,
  disabled,
}: CustomFieldInputProps) {
  const [text, setText] = useState<GeoText>(() => geoToText(value));
  const [synced, setSynced] = useState<CustomFieldValue | undefined>(value);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  if (
    JSON.stringify(value) !== JSON.stringify(synced) &&
    JSON.stringify(value) !== JSON.stringify(geoFromText(text))
  ) {
    setSynced(value);
    setText(geoToText(value));
  }
  const update = (next: GeoText) => {
    const v = geoFromText(next);
    setText(next);
    setSynced(v);
    onChange(v);
  };
  const canLocate = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  const locate = () => {
    if (!canLocate)
      return setLocError('This browser cannot share your location. Type the coordinates instead.');
    setLocating(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        update({ lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) });
      },
      (err) => {
        setLocating(false);
        setLocError(
          err.code === err.PERMISSION_DENIED
            ? 'Location access is blocked. Allow it in your browser settings, or type the coordinates.'
            : 'Your location could not be found. Try again or type the coordinates.',
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };
  const statusId = `${id}-locate`;
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={join(describedBy, locError && statusId)}
      className="flex flex-col gap-1.5"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onBlur?.();
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="flex min-w-0 flex-col gap-1 text-2xs text-fg-secondary">
          Latitude
          <Input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            placeholder="23.0225"
            value={text.lat}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            className={cn(ctrl, 'tabular')}
            onChange={(e) => update({ ...text, lat: e.target.value })}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-2xs text-fg-secondary">
          Longitude
          <Input
            inputMode="decimal"
            autoComplete="off"
            placeholder="72.5714"
            value={text.lng}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            className={cn(ctrl, 'tabular')}
            onChange={(e) => update({ ...text, lng: e.target.value })}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-11 sm:h-7"
          onClick={locate}
          loading={locating}
          disabled={disabled}
        >
          <Crosshair aria-hidden />
          Use my location
        </Button>
        <p id={statusId} role="status" className="min-w-0 flex-1 text-2xs text-fg-secondary">
          {locError}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- boolean

function BooleanInput({
  value,
  onChange,
  onBlur,
  id,
  describedBy,
  invalid,
  disabled,
  required,
}: CustomFieldInputProps) {
  const on = value === true;
  return (
    <div className="-my-1.5 -ml-2 flex items-center gap-1">
      <Switch
        id={id}
        checked={on}
        onCheckedChange={(c) => onChange(c)}
        onBlur={onBlur}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
      />
      <span aria-hidden className="text-sm text-fg-secondary">
        {value === null || value === undefined ? 'Not set' : on ? 'Yes' : 'No'}
      </span>
    </div>
  );
}
