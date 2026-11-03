'use client';

import {
  configFieldDef,
  configFieldSchema,
  type ConfigFieldState,
  type ConfigGroup,
  type ConfigValue,
  type RegistryGroupKey,
} from '@vistar/shared';
import { CheckCircle2, CircleAlert, FlaskConical, RotateCcw } from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { formatDateTimeIn } from '@/components/common/time';
import { InlineAlert } from '@/components/settings/common/states';
import { SaveBar } from '@/components/settings/settings-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { focusFirstInvalid, formErrorMessage, serverFieldErrors } from '@/lib/crm/ui/errors';
import { useResetConfigGroup, useSaveConfigGroup, useTestConfigGroup } from '@/lib/config/platform';
import { useSession } from '@/lib/session/session';
import { ConfigField, initialDraft, valueToText, type FieldDraft } from './config-field';
import { GroupAudit } from './group-audit';
import { GROUP_STATUS, GroupStatusChip } from './status';

const TZ = 'Asia/Kolkata';
type Drafts = Record<string, FieldDraft>;

const initialDrafts = (g: ConfigGroup): Drafts => Object.fromEntries(g.fields.map((f) => [f.key, initialDraft(f)]));

/** Value of a field as the form currently means it (draft first, else the effective value). */
function currentValue(f: ConfigFieldState, d: FieldDraft | undefined): unknown {
  if (!d) return f.value;
  if (f.type === 'boolean') return d.bool ?? f.value;
  return d.text ?? f.value;
}

function isActive(f: ConfigFieldState, fields: readonly ConfigFieldState[], drafts: Drafts): boolean {
  if (!f.when) return true;
  const dep = fields.find((x) => x.key === f.when!.field);
  if (!dep) return f.active;
  const v = currentValue(dep, drafts[dep.key]);
  return typeof v === 'string' && f.when.in.includes(v);
}

function parseText(f: ConfigFieldState, text: string): ConfigValue | { error: string } {
  if (f.type === 'number') {
    const n = Number(text.trim().replace(/,/g, ''));
    return Number.isFinite(n) ? n : { error: 'Enter a number.' };
  }
  if (f.type === 'list')
    return text
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
  if (f.type === 'textarea') return text;
  return text.trim();
}

/** Changed values only (omitted = unchanged, null = clear), plus field errors. */
function buildBody(group: ConfigGroup, drafts: Drafts): { values: Record<string, ConfigValue | null>; errors: Record<string, string> } {
  const values: Record<string, ConfigValue | null> = {};
  const errors: Record<string, string> = {};
  for (const f of group.fields) {
    const d = drafts[f.key];
    if (!d) continue;
    const init = initialDraft(f);
    let next: ConfigValue | null | undefined;
    if (f.secret) {
      if (d.clearSecret) next = null;
      else if (d.secret !== null && d.secret.trim() !== '') next = d.secret.trim();
      else if (d.secret !== null && f.secretSet) errors[f.key] = 'Enter the new value, or keep the saved one.';
    } else if (f.type === 'boolean') {
      if (d.bool !== init.bool) next = d.bool;
    } else if (d.text !== init.text) {
      if (d.text === null) next = null;
      else {
        const parsed = parseText(f, d.text);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && 'error' in parsed) errors[f.key] = parsed.error;
        else next = f.type === 'list' && Array.isArray(parsed) && parsed.length === 0 && init.text === null ? undefined : parsed;
      }
    }
    if (next === undefined || errors[f.key]) continue;
    if (next !== null) {
      const def = configFieldDef(group.key, f.key);
      const check = def ? configFieldSchema(def).safeParse(next) : { success: true as const };
      if (!check.success) {
        errors[f.key] = check.error.issues[0]?.message ?? 'Check this value.';
        continue;
      }
    }
    values[f.key] = next;
  }
  return { values, errors };
}

/**
 * One registry group (Super Admin > Config): fields rendered from the contract, secrets write-only,
 * where each value comes from (panel, env fallback, default, development default), a test with the
 * saved values, clear-all, and the audit trail of the group.
 */
export function RegistryGroupPanel({ group }: { group: ConfigGroup }) {
  // Re-key the form when the server state changes (after save, reset), so drafts restart from it.
  return <RegistryGroupForm key={`${group.key}:${group.updatedAt ?? 'never'}`} group={group} />;
}

function RegistryGroupForm({ group }: { group: ConfigGroup }) {
  const key = group.key as RegistryGroupKey;
  const formId = useId();
  const save = useSaveConfigGroup(key);
  const reset = useResetConfigGroup(key);
  const test = useTestConfigGroup(key);
  const session = useSession();
  const adminEmail = session?.audience === 'platform' ? session.admin.email : '';
  const [drafts, setDrafts] = useState<Drafts>(() => initialDrafts(group));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [to, setTo] = useState(adminEmail ?? '');
  const pending = useMemo(() => buildBody(group, drafts), [group, drafts]);
  const dirty = Object.keys(pending.values).length > 0 || Object.keys(pending.errors).length > 0;
  const anyPanelValue = group.fields.some((f) => f.panelValue !== null || f.secretSet);
  const status = GROUP_STATUS[group.status];

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { values, errors: errs } = buildBody(group, drafts);
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError(Object.keys(errs).length === 1 ? 'Fix the highlighted field to save.' : `Fix the ${Object.keys(errs).length} highlighted fields to save.`);
      focusFirstInvalid(formId);
      return;
    }
    try {
      const next = await save.mutateAsync(values);
      setFormError(null);
      toast.success(`${group.label} saved${next.status === 'missing' ? '. Some required values are still missing.' : ''}`);
    } catch (err) {
      setErrors(serverFieldErrors(err));
      setFormError(formErrorMessage(err));
      focusFirstInvalid(formId);
    }
  }

  async function runTest() {
    try {
      const r = await test.mutateAsync(group.testNeedsRecipient && to.trim() ? { to: to.trim() } : {});
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    } catch (err) {
      toast.error(formErrorMessage(err, 'The test did not run. Try again.'));
    }
  }

  async function clearAll() {
    try {
      await reset.mutateAsync();
      setConfirmReset(false);
      toast.success(`${group.label}: panel values cleared`);
    } catch (err) {
      toast.error(formErrorMessage(err, 'The values were not cleared. Try again.'));
    }
  }

  const visible = group.fields.filter((f) => isActive(f, group.fields, drafts));
  const last = group.lastTest;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <form id={formId} noValidate onSubmit={(e) => void submit(e)}>
        <Card>
          <CardHeader>
            <div className="min-w-0">
              <CardTitle>{group.label}</CardTitle>
              <CardDescription>{group.description}</CardDescription>
            </div>
            <GroupStatusChip status={group.status} size="md" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {group.status !== 'configured' && (
              <InlineAlert tone={group.status === 'missing' ? 'danger' : 'warning'} title={status.label}>
                {group.statusNote ?? status.hint}
                {group.missing.length > 0 && <span className="block">{`Missing: ${group.missing.map((k) => group.fields.find((f) => f.key === k)?.label ?? k).join(', ')}.`}</span>}
              </InlineAlert>
            )}
            {formError && <InlineAlert>{formError}</InlineAlert>}
            <div className="grid gap-4 md:grid-cols-2">
              {visible.map((f) => (
                <div key={f.key} className={f.type === 'textarea' || f.type === 'list' ? 'md:col-span-2' : undefined}>
                  <ConfigField
                    field={f}
                    draft={drafts[f.key] ?? initialDraft(f)}
                    error={errors[f.key]}
                    disabled={save.isPending}
                    onChange={(next) => {
                      setDrafts((d) => ({ ...d, [f.key]: next }));
                      setErrors(({ [f.key]: _removed, ...rest }) => rest);
                    }}
                  />
                </div>
              ))}
            </div>
            {group.fields.length > visible.length && <p className="text-xs text-muted-strong">Fields for the other options are hidden; their saved values stay.</p>}
          </CardContent>
          <CardFooter className="flex-wrap justify-end gap-2">
            {anyPanelValue && (
              <Button variant="ghost" onClick={() => setConfirmReset(true)} disabled={save.isPending}>
                <RotateCcw aria-hidden />
                Clear panel values
              </Button>
            )}
            <SaveBar dirty={dirty} saving={save.isPending} onDiscard={() => setDrafts(initialDrafts(group))} />
          </CardFooter>
        </Card>
      </form>

      {group.testable && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{group.testLabel ?? 'Test'}</CardTitle>
              <CardDescription>{dirty ? 'Save first: the test uses the saved values.' : 'Runs with the saved values; the result is kept and audited.'}</CardDescription>
            </div>
            <FlaskConical aria-hidden className="size-4 text-fg-secondary" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-2">
              {group.testNeedsRecipient && (
                <FormField label="Send to" hint="Empty = your own e-mail" className="w-full max-w-xs">
                  <Input type="email" autoComplete="email" value={to} onChange={(e) => setTo(e.target.value)} />
                </FormField>
              )}
              <Button onClick={() => void runTest()} loading={test.isPending} disabled={dirty}>
                <FlaskConical aria-hidden />
                {group.testLabel ?? 'Run test'}
              </Button>
            </div>
            {last && (
              <div role="status" className="flex items-start gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
                {last.ok ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success-text" /> : <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger-text" />}
                <div className="min-w-0">
                  <p className={last.ok ? 'font-medium text-success-text' : 'font-medium text-danger-text'}>{last.ok ? 'Passed' : 'Failed'}</p>
                  <p className="break-words text-fg-secondary">{last.message}</p>
                  <p className="text-xs text-muted-strong">
                    {formatDateTimeIn(last.at, TZ)}
                    {last.latencyMs !== null ? ` · ${last.latencyMs} ms` : ''}
                  </p>
                  {last.details && (
                    <dl className="mt-1 grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[auto_1fr]">
                      {Object.entries(last.details).map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="text-muted-strong">{k}</dt>
                          <dd className="break-all text-fg-secondary">{valueToText(v === null ? null : typeof v === 'boolean' ? String(v) : v)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <GroupAudit group={group.key} fields={group.fields} />

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{`Clear ${group.label}?`}</DialogTitle>
            <DialogDescription>Every value saved in the panel for this group is removed, secrets included. Env fallbacks and defaults apply again; in production a missing value switches the feature off.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmReset(false)}>Keep the values</Button>
            <Button variant="danger" loading={reset.isPending} onClick={() => void clearAll()}>
              Clear panel values
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
