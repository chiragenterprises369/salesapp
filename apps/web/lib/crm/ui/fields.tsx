'use client';

import { CONTACT_POINT_LABELS, INDIAN_STATES, normalizeIndianPhone, type Address, type ContactPointLabel, type LabeledEmail, type LabeledPhone } from '@vistar/shared';
import { Plus, X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { FormField, Input } from '@/components/ui/input';
import { useScopedUserList, useTagNames } from '@/lib/api/directory';
import { cn } from '@/lib/cn';

/** Two columns on wide screens (D-066); `wide` children span both. */
export function FormGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid gap-4 sm:grid-cols-2', className)}>{children}</div>;
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-1 text-sm font-semibold text-fg">{title}</legend>
      {description && <p className="-mt-2 text-xs text-muted-strong">{description}</p>}
      {children}
    </fieldset>
  );
}

const LABEL_NAMES: Record<ContactPointLabel, string> = { mobile: 'Mobile', work: 'Work', home: 'Home', whatsapp: 'WhatsApp', billing: 'Billing', other: 'Other' };

export function StateSelect({ value, onChange, id, ...aria }: { value: string | null; onChange: (code: string | null) => void; id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) {
  return (
    <NativeSelect id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} {...aria}>
      <option value="">Select a state</option>
      {INDIAN_STATES.map((s) => (
        <option key={s.code} value={s.code}>
          {s.name} ({s.code})
        </option>
      ))}
    </NativeSelect>
  );
}

/** Owner picker over the people the caller may assign (GET /users/options, scope-aware). */
export function OwnerSelect({ value, onChange, id, allowEmpty = true, disabled }: { value: string | null; onChange: (id: string | null) => void; id?: string; allowEmpty?: boolean; disabled?: boolean }) {
  const users = useScopedUserList();
  return (
    <NativeSelect id={id} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
      {allowEmpty && <option value="">Unassigned</option>}
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </NativeSelect>
  );
}

/** Tag chips with an add field that suggests workspace tags. Lower-case, unique, max 40 characters. */
export function TagsInput({ value, onChange, label = 'Tags', max = 30 }: { value: readonly string[]; onChange: (tags: string[]) => void; label?: string; max?: number }) {
  const known = useTagNames();
  const listId = useId();
  const inputId = useId();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const t = draft.trim().toLowerCase();
    if (!t) return;
    if (t.length > 40) return setError('Tags can be up to 40 characters.');
    if (value.includes(t)) return setError('This tag is already added.');
    if (value.length >= max) return setError(`At most ${max} tags.`);
    onChange([...value, t]);
    setDraft('');
    setError(null);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-xs font-medium text-fg-secondary">
        {label}
      </label>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={label}>
          {value.map((t) => (
            <li key={t}>
              <Chip size="md" className="pr-1">
                {t}
                <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(value.filter((x) => x !== t))} className="focus-ring inline-flex size-4 items-center justify-center rounded-full hover:bg-surface-3">
                  <X aria-hidden className="size-3" />
                </button>
              </Chip>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1.5">
        <Input
          id={inputId}
          list={listId}
          value={draft}
          placeholder="Type a tag and press Enter"
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
        <datalist id={listId}>
          {known.filter((t) => !value.includes(t)).map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- phones and emails

export interface PointDraft {
  label: ContactPointLabel;
  value: string;
}

/** Extra phone numbers or emails with a label each. Validation happens in `pointsProblems`. */
export function ContactPointsField({ kind, value, onChange, errors }: { kind: 'phone' | 'email'; value: readonly PointDraft[]; onChange: (next: PointDraft[]) => void; errors?: Record<number, string> }) {
  const base = useId();
  const noun = kind === 'phone' ? 'phone number' : 'email';
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-fg-secondary">{kind === 'phone' ? 'Other phone numbers' : 'Other emails'}</p>
      {value.map((p, i) => (
        <div key={i} className="flex flex-col gap-1">
          <div className="flex gap-1.5">
            <NativeSelect aria-label={`Label of ${noun} ${i + 1}`} value={p.label} wrapperClassName="w-32 shrink-0" onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, label: e.target.value as ContactPointLabel } : x)))}>
              {CONTACT_POINT_LABELS.map((l) => (
                <option key={l} value={l}>
                  {LABEL_NAMES[l]}
                </option>
              ))}
            </NativeSelect>
            <Input
              id={`${base}-${i}`}
              aria-label={`${kind === 'phone' ? 'Phone number' : 'Email'} ${i + 1}`}
              type={kind === 'phone' ? 'tel' : 'email'}
              inputMode={kind === 'phone' ? 'tel' : 'email'}
              value={p.value}
              aria-invalid={errors?.[i] ? true : undefined}
              aria-describedby={errors?.[i] ? `${base}-${i}-err` : undefined}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
            />
            <Button size="icon" variant="ghost" aria-label={`Remove ${noun} ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <X aria-hidden />
            </Button>
          </div>
          {errors?.[i] && (
            <p id={`${base}-${i}-err`} role="alert" className="text-xs text-danger-text">
              {errors[i]}
            </p>
          )}
        </div>
      ))}
      {value.length < 10 && (
        <Button size="sm" variant="ghost" className="w-max" onClick={() => onChange([...value, { label: kind === 'phone' ? 'work' : 'work', value: '' }])}>
          <Plus aria-hidden />
          Add {noun}
        </Button>
      )}
    </div>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validate and normalise extra phones (to E.164) or emails. Empty rows are dropped. */
export function pointsProblems(kind: 'phone' | 'email', drafts: readonly PointDraft[]): { values: Array<LabeledPhone | LabeledEmail>; errors: Record<number, string> } {
  const values: Array<LabeledPhone | LabeledEmail> = [];
  const errors: Record<number, string> = {};
  drafts.forEach((d, i) => {
    const v = d.value.trim();
    if (!v) return;
    if (kind === 'phone') {
      const n = normalizeIndianPhone(v) ?? (/^\+[1-9]\d{6,14}$/.test(v) ? v : null);
      if (!n) errors[i] = 'Enter a 10-digit mobile number or an international number with +.';
      else values.push({ label: d.label, value: n });
    } else if (!EMAIL_RE.test(v)) errors[i] = 'Enter an email like name@company.com.';
    else values.push({ label: d.label, value: v.toLowerCase() });
  });
  return { values, errors };
}

/** Primary phone: Indian 10-digit or E.164; null when empty. Returns an error message when invalid. */
export function parsePhone(input: string): { value: string | null; error: string | null } {
  const v = input.trim();
  if (!v) return { value: null, error: null };
  const n = normalizeIndianPhone(v) ?? (/^\+[1-9]\d{6,14}$/.test(v) ? v : null);
  return n ? { value: n, error: null } : { value: null, error: 'Enter a 10-digit mobile number or an international number with +.' };
}

export function parseEmail(input: string): { value: string | null; error: string | null } {
  const v = input.trim();
  if (!v) return { value: null, error: null };
  return EMAIL_RE.test(v) ? { value: v.toLowerCase(), error: null } : { value: null, error: 'Enter an email like name@company.com.' };
}

// ---------------------------------------------------------------- addresses

export interface AddressDraft {
  line1: string;
  line2: string;
  city: string;
  stateCode: string | null;
  pincode: string;
}

export const emptyAddress = (): AddressDraft => ({ line1: '', line2: '', city: '', stateCode: null, pincode: '' });

export function addressToDraft(a: Address | null | undefined): AddressDraft {
  if (!a) return emptyAddress();
  return { line1: a.line1, line2: a.line2 ?? '', city: a.city, stateCode: a.stateCode ?? null, pincode: a.pincode ?? '' };
}

const isBlank = (a: AddressDraft) => !a.line1.trim() && !a.line2.trim() && !a.city.trim() && !a.stateCode && !a.pincode.trim();

/** Draft -> Address (null when every field is empty) plus field errors keyed by field name. */
export function draftToAddress(a: AddressDraft): { value: Address | null; errors: Partial<Record<keyof AddressDraft, string>> } {
  if (isBlank(a)) return { value: null, errors: {} };
  const errors: Partial<Record<keyof AddressDraft, string>> = {};
  if (!a.line1.trim()) errors.line1 = 'Enter the street address.';
  if (!a.city.trim()) errors.city = 'Enter the city.';
  if (!a.stateCode) errors.stateCode = 'Pick the state (needed for GST).';
  if (a.pincode.trim() && !/^[1-9]\d{5}$/.test(a.pincode.trim())) errors.pincode = 'A PIN code has 6 digits.';
  if (Object.keys(errors).length) return { value: null, errors };
  const state = INDIAN_STATES.find((s) => s.code === a.stateCode)?.name ?? null;
  return {
    value: { line1: a.line1.trim(), line2: a.line2.trim() || null, city: a.city.trim(), state, stateCode: a.stateCode, pincode: a.pincode.trim() || null, country: 'IN' } as Address,
    errors: {},
  };
}

export function AddressFields({ legend, value, onChange, errors = {} }: { legend: string; value: AddressDraft; onChange: (next: AddressDraft) => void; errors?: Partial<Record<keyof AddressDraft, string>> }) {
  const set = (patch: Partial<AddressDraft>) => onChange({ ...value, ...patch });
  return (
    <FormSection title={legend}>
      <FormGrid>
        <FormField label="Address line 1" error={errors.line1} className="sm:col-span-2">
          <Input value={value.line1} autoComplete="address-line1" onChange={(e) => set({ line1: e.target.value })} />
        </FormField>
        <FormField label="Address line 2" className="sm:col-span-2">
          <Input value={value.line2} autoComplete="address-line2" onChange={(e) => set({ line2: e.target.value })} />
        </FormField>
        <FormField label="City" error={errors.city}>
          <Input value={value.city} autoComplete="address-level2" onChange={(e) => set({ city: e.target.value })} />
        </FormField>
        <FormField label="State" error={errors.stateCode} hint="Decides CGST + SGST or IGST on documents.">
          <StateSelect value={value.stateCode} onChange={(stateCode) => set({ stateCode })} />
        </FormField>
        <FormField label="PIN code" error={errors.pincode}>
          <Input value={value.pincode} inputMode="numeric" maxLength={6} autoComplete="postal-code" onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, '') })} />
        </FormField>
      </FormGrid>
    </FormSection>
  );
}

/** One line "Line 1, City, State 400001". */
export function formatAddress(a: Address | null | undefined): string | null {
  if (!a) return null;
  return [a.line1, a.line2, a.city, [a.state ?? INDIAN_STATES.find((s) => s.code === a.stateCode)?.name, a.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

// ---------------------------------------------------------------- money

/** Rupees text ("1,23,456.50") -> paise; null when not a valid non-negative amount. */
export function parseRupees(text: string): number | null {
  const t = text.replace(/[,₹\s]/g, '');
  if (!t) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export const paiseToInput = (paise: number | null | undefined) => (paise === null || paise === undefined ? '' : (paise / 100).toFixed(2).replace(/\.00$/, ''));
