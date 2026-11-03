'use client';

import type { ConfigFieldState, ConfigValue } from '@vistar/shared';
import { KeyRound, RotateCcw, Trash2, X } from 'lucide-react';
import { useId } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Switch } from '@/components/common/switch';
import { Button } from '@/components/ui/button';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/cn';

/**
 * Draft of one field. Non-secret fields edit the panel value (null = not saved in the panel, so the env
 * fallback or the default applies). Secrets never come back from the API: `secret` holds what the admin
 * types to replace it, `clearSecret` removes the stored one.
 */
export interface FieldDraft {
  /** Text as typed (numbers and lists are parsed on save). null = use env fallback / default. */
  text: string | null;
  bool: boolean | null;
  secret: string | null;
  clearSecret: boolean;
}

export function initialDraft(f: ConfigFieldState): FieldDraft {
  if (f.secret) return { text: null, bool: null, secret: null, clearSecret: false };
  if (f.type === 'boolean') return { text: null, bool: typeof f.panelValue === 'boolean' ? f.panelValue : null, secret: null, clearSecret: false };
  return { text: f.panelValue === null ? null : valueToText(f.panelValue), bool: null, secret: null, clearSecret: false };
}

export function valueToText(v: ConfigValue | null): string {
  if (v === null) return '';
  if (Array.isArray(v)) return v.join('\n');
  return String(v);
}

/** Effective display of the value that applies when nothing is saved in the panel. */
function fallbackText(f: ConfigFieldState): string | null {
  if (f.secret) return null;
  if (f.source === 'panel') return f.defaultValue === null ? null : valueToText(f.defaultValue);
  if (f.value === null) return null;
  if (f.type === 'boolean') return f.value ? 'on' : 'off';
  if (f.type === 'select') return f.options?.find((o) => o.value === f.value)?.label ?? String(f.value);
  if (Array.isArray(f.value)) return f.value.length ? f.value.join(', ') : 'empty list';
  return String(f.value);
}

/** One line under the field: where the effective value comes from. */
function SourceNote({ f, draft }: { f: ConfigFieldState; draft: FieldDraft }) {
  const savedInPanel = f.secret ? f.secretSet && !draft.clearSecret : f.type === 'boolean' ? draft.bool !== null : draft.text !== null;
  if (savedInPanel) return null;
  const fb = fallbackText(f);
  if (f.source === 'env' && f.envVar)
    return (
      <p className="text-xs text-warning-text">
        {`Using env fallback: ${f.envVar}${fb ? ` (${fb})` : ''}. Save a value here to move it into the panel.`}
      </p>
    );
  if (f.source === 'dev_default')
    return <p className="text-xs text-warning-text">{`Development default${fb ? `: ${fb}` : ''}. Production never uses it.`}</p>;
  if (f.source === 'default' && fb) return <p className="text-xs text-muted-strong">{`Default: ${fb}`}</p>;
  if (f.source === 'panel' && fb) return <p className="text-xs text-muted-strong">{`Default after saving: ${fb}`}</p>;
  if (f.envVar && f.source === 'none') return <p className="text-xs text-muted-strong">{`Not set. ${f.envVar} in the server environment would also work, but the panel wins.`}</p>;
  return null;
}

function ClearButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Button size="sm" variant="ghost" className="h-7 w-max px-2 text-xs" onClick={onClick} disabled={disabled}>
      <RotateCcw aria-hidden />
      {label}
    </Button>
  );
}

export function ConfigField({
  field: f,
  draft,
  onChange,
  error,
  disabled,
}: {
  field: ConfigFieldState;
  draft: FieldDraft;
  onChange: (next: FieldDraft) => void;
  error?: string;
  disabled?: boolean;
}) {
  const set = (patch: Partial<FieldDraft>) => onChange({ ...draft, ...patch });
  const clearLabel = f.envVar ? 'Use env fallback' : 'Use default';
  const label = f.label;
  const hint = f.help ?? undefined;

  if (f.secret) return <SecretField field={f} draft={draft} onChange={onChange} error={error} disabled={disabled} />;

  if (f.type === 'boolean') {
    return <BooleanField field={f} draft={draft} onChange={onChange} disabled={disabled} clearLabel={clearLabel} />;
  }

  let control;
  if (f.type === 'select') {
    control = (
      <NativeSelect value={draft.text ?? ''} disabled={disabled} onChange={(e) => set({ text: e.target.value === '' ? null : e.target.value })}>
        <option value="">{fallbackText(f) ? `Not saved (${fallbackText(f)})` : 'Choose…'}</option>
        {(f.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    );
  } else if (f.type === 'textarea' || f.type === 'list') {
    control = (
      <Textarea
        rows={f.type === 'list' ? 4 : 3}
        value={draft.text ?? ''}
        disabled={disabled}
        spellCheck={f.type === 'textarea'}
        placeholder={f.type === 'list' ? 'One per line' : (f.placeholder ?? undefined)}
        onChange={(e) => set({ text: e.target.value === '' && f.type !== 'list' ? null : e.target.value })}
        className={f.type === 'list' ? 'font-mono text-xs' : undefined}
      />
    );
  } else {
    const type = f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text';
    control = (
      <Input
        type={type}
        inputMode={f.type === 'number' ? 'decimal' : undefined}
        value={draft.text ?? ''}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        placeholder={f.placeholder ?? (fallbackText(f) || undefined)}
        onChange={(e) => set({ text: e.target.value === '' ? null : e.target.value })}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <FormField label={label} hint={hint} error={error} required={f.required}>
        {control}
      </FormField>
      <SourceNote f={f} draft={draft} />
      {draft.text !== null && f.panelValue !== null && <ClearButton label={clearLabel} onClick={() => set({ text: null })} disabled={disabled} />}
    </div>
  );
}

function BooleanField({ field: f, draft, onChange, disabled, clearLabel }: { field: ConfigFieldState; draft: FieldDraft; onChange: (d: FieldDraft) => void; disabled?: boolean; clearLabel: string }) {
  const id = useId();
  const effective = draft.bool ?? (typeof f.value === 'boolean' ? f.value : false);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-start gap-3">
        <Switch id={id} checked={effective} disabled={disabled} onCheckedChange={(v) => onChange({ ...draft, bool: v })} />
        <label htmlFor={id} className="text-sm text-fg">
          {f.label}
          {f.help && <span className="block text-xs text-muted">{f.help}</span>}
        </label>
      </div>
      <SourceNote f={f} draft={draft} />
      {draft.bool !== null && f.panelValue !== null && <ClearButton label={clearLabel} onClick={() => onChange({ ...draft, bool: null })} disabled={disabled} />}
    </div>
  );
}

/** Write-only secret: masked hint when saved, Replace reveals an empty password field, Remove clears it. */
function SecretField({ field: f, draft, onChange, error, disabled }: { field: ConfigFieldState; draft: FieldDraft; onChange: (d: FieldDraft) => void; error?: string; disabled?: boolean }) {
  const id = useId();
  const replacing = draft.secret !== null;
  const saved = f.secretSet && !draft.clearSecret;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={replacing || !saved ? id : undefined} className="text-xs font-medium text-fg-secondary">
        {f.label}
        {f.required && (
          <span aria-hidden className="ml-0.5 text-danger-text">
            *
          </span>
        )}
      </label>
      {saved && !replacing ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 font-mono text-sm text-fg-secondary">
            <KeyRound aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{f.secretHint ?? '••••'}</span>
            <span className="sr-only">saved; the value is never shown again</span>
          </span>
          <Button size="sm" disabled={disabled} onClick={() => onChange({ ...draft, secret: '', clearSecret: false })}>
            Replace
          </Button>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange({ ...draft, secret: null, clearSecret: true })} aria-label={`Remove ${f.label}`}>
            <Trash2 aria-hidden />
            Remove
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={draft.secret ?? ''}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-required={f.required || undefined}
            aria-describedby={[f.help ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined}
            placeholder={f.secretSet && !draft.clearSecret ? 'New value' : (f.placeholder ?? undefined)}
            onChange={(e) => onChange({ ...draft, secret: e.target.value, clearSecret: false })}
          />
          {(replacing && f.secretSet) || draft.clearSecret ? (
            <Button size="icon-sm" variant="ghost" aria-label="Keep the saved value" disabled={disabled} onClick={() => onChange({ ...draft, secret: null, clearSecret: false })}>
              <X aria-hidden />
            </Button>
          ) : null}
        </div>
      )}
      {draft.clearSecret && <p className="text-xs text-warning-text">The saved value is removed when you save.</p>}
      {f.help && !error && (
        <p id={hintId} className="text-xs text-muted">
          {f.help}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      )}
      <p className={cn('text-xs text-muted-strong', !saved && f.source === 'env' && 'hidden')}>Stored encrypted. It is never shown again after saving.</p>
      {!saved && f.source === 'env' && f.envVar && <p className="text-xs text-warning-text">{`Using env fallback: ${f.envVar}. Save a value here to move it into the panel.`}</p>}
    </div>
  );
}
