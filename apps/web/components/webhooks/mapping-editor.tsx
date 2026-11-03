'use client';

import { MAPPING_TRANSFORMS, type MappingTransform } from '@vistar/shared';
import { AlertCircle, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { uuid4 } from '@/lib/crm/ids';
import { formErrorMessage } from '@/lib/crm/ui/errors';
import { flattenLeaves, getAtPath, previewValue, suggestMapping } from '@/lib/hub/json-paths';
import { targetLabel, TRANSFORM_LABEL, type TargetOption } from '@/lib/hub/mapping-labels';
import { useMappingPreview } from '@/lib/hub/webhooks';
import { JsonTree } from './json-tree';

export interface MappingRow {
  id: string;
  from: string;
  to: string;
  transform: MappingTransform;
}

export interface ConstantRow {
  id: string;
  to: string;
  value: string;
}

export const newRow = (r: Partial<MappingRow> = {}): MappingRow => ({ id: uuid4(), from: '', to: '', transform: 'none', ...r });
export const newConstant = (c: Partial<ConstantRow> = {}): ConstantRow => ({ id: uuid4(), to: '', value: '', ...c });

/** Transform that suits a target field when a value is picked from the tree. */
function transformFor(to: string): MappingTransform {
  if (to === 'phone') return 'phone_in';
  if (to === 'email') return 'lower';
  if (to === 'valueInr') return 'number';
  return to ? 'trim' : 'none';
}

/** The payload mapping as the API stores it (rows without a path or target are left out). */
export function toPayloadMapping(rows: readonly MappingRow[], constants: readonly ConstantRow[]) {
  return {
    fields: rows.filter((r) => r.from.trim() && r.to).map((r) => ({ from: r.from.trim(), to: r.to, transform: r.transform })),
    defaults: Object.fromEntries(constants.filter((c) => c.to && c.value.trim()).map((c) => [c.to, c.value.trim()])),
  };
}

/**
 * Mapping editor: the sample payload as a tree (pick a value to add a row), one row per lead field
 * with the path expression (editable: `a || b` fallbacks, `first + last` joins), the target field and
 * a transform; constants fill fields the payload does not have.
 */
export function MappingEditor({
  sample,
  sampleVersion,
  rows,
  onRows,
  constants,
  onConstants,
  targets,
  disabled,
}: {
  sample: unknown;
  /** Changes when a new sample is loaded (resets the tree's open nodes). */
  sampleVersion: number;
  rows: MappingRow[];
  onRows: (rows: MappingRow[]) => void;
  constants: ConstantRow[];
  onConstants: (rows: ConstantRow[]) => void;
  targets: TargetOption[];
  disabled?: boolean;
}) {
  const hasSample = sample !== undefined && sample !== null && typeof sample === 'object';
  const leaves = useMemo(() => (hasSample ? flattenLeaves(sample) : []), [sample, hasSample]);
  const mapped = useMemo(() => new Map(rows.filter((r) => r.from && r.to).map((r) => [r.from, targetLabel(targets, r.to)])), [rows, targets]);
  const rowRefs = useRef(new Map<string, HTMLInputElement>());
  const used = new Set(rows.map((r) => r.to).filter(Boolean));
  const transforms = MAPPING_TRANSFORMS as readonly MappingTransform[];

  const update = (id: string, patch: Partial<MappingRow>) => onRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const pick = (path: string) => {
    if (disabled) return;
    const existing = rows.find((r) => r.from === path);
    if (existing) {
      rowRefs.current.get(existing.id)?.focus();
      return;
    }
    // Fill the first empty row, else add one; guess the target from the key name.
    const guess = suggestMapping(
      leaves.filter((l) => l.path === path),
      transforms,
    )[0];
    const to = guess && !used.has(guess.to) ? guess.to : '';
    const blank = rows.find((r) => !r.from);
    const row = blank ? { ...blank, from: path, to: blank.to || to, transform: blank.to ? transformFor(blank.to) : ((guess?.transform as MappingTransform | undefined) ?? transformFor(to)) } : newRow({ from: path, to, transform: (guess?.transform as MappingTransform | undefined) ?? transformFor(to) });
    onRows(blank ? rows.map((r) => (r.id === blank.id ? row : r)) : [...rows, row]);
    requestAnimationFrame(() => rowRefs.current.get(row.id)?.focus());
  };
  const suggest = () => {
    const rowsNow = rows.filter((r) => r.from || r.to);
    const taken = new Set(rowsNow.map((r) => r.to));
    const add = suggestMapping(leaves, transforms)
      .filter((g) => !taken.has(g.to) && !rowsNow.some((r) => r.from === g.from))
      .map((g) => newRow({ from: g.from, to: g.to, transform: g.transform as MappingTransform }));
    onRows([...rowsNow, ...add]);
  };

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section aria-labelledby="mapping-sample-title" className="flex min-w-0 flex-col overflow-hidden rounded-md border border-border">
        <header className="flex items-center justify-between gap-2 border-b border-border bg-surface-2 px-3 py-2">
          <h4 id="mapping-sample-title" className="text-xs font-semibold text-fg-secondary">
            Sample fields
          </h4>
          {hasSample && (
            <Button size="sm" variant="ghost" onClick={suggest} disabled={disabled || leaves.length === 0}>
              <Sparkles aria-hidden />
              Suggest mapping
            </Button>
          )}
        </header>
        {hasSample ? (
          <>
            <JsonTree key={sampleVersion} value={sample} label="Sample payload fields. Press Enter on a value to map it." mapped={mapped} onPick={pick} />
            <p className="border-t border-border px-3 py-1.5 text-2xs text-muted-strong">Pick a value to map it. Highlighted values are mapped.</p>
          </>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-muted-strong">Paste or capture a sample above to pick fields from it. You can also type paths by hand.</p>
        )}
      </section>

      <section aria-labelledby="mapping-rows-title" className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h4 id="mapping-rows-title" className="text-xs font-semibold text-fg-secondary">
            Lead fields
          </h4>
          <Button size="sm" variant="ghost" onClick={() => onRows([...rows, newRow()])} disabled={disabled}>
            <Plus aria-hidden />
            Add field
          </Button>
        </div>
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border-strong px-3 py-4 text-sm text-muted-strong">No fields mapped yet. Pick values from the sample or add a field.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Mapped fields">
            {rows.map((r, i) => {
              const value = hasSample && r.from ? getAtPath(sample, r.from.replace(/^\$\.?/, '')) : undefined;
              const n = i + 1;
              return (
                <li key={r.id} className="grid grid-cols-1 gap-2 rounded-md border border-border bg-surface p-2.5 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0">
                    <label htmlFor={`from-${r.id}`} className="sr-only">
                      Path for field {n}
                    </label>
                    <Input
                      id={`from-${r.id}`}
                      ref={(el) => {
                        if (el) rowRefs.current.set(r.id, el);
                        else rowRefs.current.delete(r.id);
                      }}
                      size="sm"
                      value={r.from}
                      onChange={(e) => update(r.id, { from: e.target.value })}
                      placeholder="data.customer.mobile"
                      spellCheck={false}
                      className="font-mono"
                      disabled={disabled}
                      aria-describedby={`val-${r.id}`}
                    />
                    <p id={`val-${r.id}`} className="mt-0.5 truncate font-mono text-2xs text-muted-strong">
                      {hasSample && r.from && !/\|\||\+|"/.test(r.from) ? previewValue(value) : r.from ? 'expression' : ''}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <label htmlFor={`to-${r.id}`} className="sr-only">
                      Lead field for row {n}
                    </label>
                    <NativeSelect id={`to-${r.id}`} size="sm" value={r.to} disabled={disabled} onChange={(e) => update(r.id, { to: e.target.value, transform: r.transform === 'none' || !r.to ? transformFor(e.target.value) : r.transform })}>
                      <option value="">Choose a field</option>
                      <optgroup label="Lead">
                        {targets
                          .filter((t) => t.group === 'Lead')
                          .map((t) => (
                            <option key={t.value} value={t.value} disabled={used.has(t.value) && t.value !== r.to}>
                              {t.label}
                            </option>
                          ))}
                      </optgroup>
                      {targets.some((t) => t.group === 'Custom fields') && (
                        <optgroup label="Custom fields">
                          {targets
                            .filter((t) => t.group === 'Custom fields')
                            .map((t) => (
                              <option key={t.value} value={t.value} disabled={used.has(t.value) && t.value !== r.to}>
                                {t.label}
                              </option>
                            ))}
                        </optgroup>
                      )}
                    </NativeSelect>
                  </div>
                  <div className="min-w-0">
                    <label htmlFor={`tr-${r.id}`} className="sr-only">
                      Transform for row {n}
                    </label>
                    <NativeSelect id={`tr-${r.id}`} size="sm" value={r.transform} disabled={disabled} onChange={(e) => update(r.id, { transform: e.target.value as MappingTransform })}>
                      {transforms.map((t) => (
                        <option key={t} value={t}>
                          {TRANSFORM_LABEL[t] ?? t}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove field ${n}`} onClick={() => onRows(rows.filter((x) => x.id !== r.id))} disabled={disabled}>
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-2xs text-muted-strong">
          Paths: <code className="font-mono">data.customer.mobile</code>, <code className="font-mono">items.0.name</code>, fallbacks <code className="font-mono">mobile || phone</code>, joins <code className="font-mono">first_name + last_name</code>.
        </p>

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-fg-secondary">Fixed values</h4>
            <Button size="sm" variant="ghost" onClick={() => onConstants([...constants, newConstant()])} disabled={disabled}>
              <Plus aria-hidden />
              Add fixed value
            </Button>
          </div>
          <p className="text-2xs text-muted-strong">Used when the payload leaves the field empty, e.g. source = website or tags = facebook-ads.</p>
          {constants.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label="Fixed values">
              {constants.map((c, i) => (
                <li key={c.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-center">
                  <label htmlFor={`cto-${c.id}`} className="sr-only">
                    Field for fixed value {i + 1}
                  </label>
                  <NativeSelect id={`cto-${c.id}`} size="sm" value={c.to} disabled={disabled} onChange={(e) => onConstants(constants.map((x) => (x.id === c.id ? { ...x, to: e.target.value } : x)))}>
                    <option value="">Choose a field</option>
                    {targets.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </NativeSelect>
                  <label htmlFor={`cval-${c.id}`} className="sr-only">
                    Value {i + 1}
                  </label>
                  <Input id={`cval-${c.id}`} size="sm" value={c.value} disabled={disabled} onChange={(e) => onConstants(constants.map((x) => (x.id === c.id ? { ...x, value: e.target.value } : x)))} placeholder="website" />
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove fixed value ${i + 1}`} onClick={() => onConstants(constants.filter((x) => x.id !== c.id))} disabled={disabled}>
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * The lead the mapping would produce from the sample (server preview, so the API's own path and
 * transform rules apply). Re-runs 500 ms after the last change.
 */
export function MappingPreview({ sample, mapping, targets }: { sample: unknown; mapping: ReturnType<typeof toPayloadMapping>; targets: TargetOption[] }) {
  const preview = useMappingPreview();
  const { mutate } = preview;
  const key = JSON.stringify({ sample, mapping });
  const [ran, setRan] = useState(false);
  useEffect(() => {
    if (sample === undefined || sample === null) return;
    const t = setTimeout(() => {
      setRan(true);
      mutate({ samplePayload: sample, mapping });
    }, 500);
    return () => clearTimeout(t);
    // `key` captures sample and mapping by value; the objects change identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mutate]);

  if (sample === undefined || sample === null) return <p className="text-sm text-muted-strong">Add a sample payload to see the lead this mapping creates.</p>;
  if (!ran || (preview.isPending && !preview.data))
    return (
      <div role="status" aria-label="Building the preview" className="flex flex-col gap-1.5">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    );
  if (preview.isError) return <p className="text-sm text-danger-text">{formErrorMessage(preview.error, 'The preview did not run. Check the sample and try again.')}</p>;
  const data = preview.data;
  if (!data) return null;
  const entries = Object.entries(data.lead).filter(([, v]) => v !== null && v !== undefined && v !== '');
  const missingContact = !entries.some(([k]) => k === 'phone' || k === 'email');
  return (
    <div className="flex flex-col gap-3" aria-live="polite" data-testid="mapping-preview">
      {entries.length === 0 ? (
        <p className="text-sm text-muted-strong">This mapping produces an empty lead. Map at least a name and a phone or email.</p>
      ) : (
        <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1 text-sm">
          {entries.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-strong">{targetLabel(targets, k.startsWith('customFields.') ? `custom.${k.slice(13)}` : k)}</dt>
              <dd className="min-w-0 break-words text-fg" data-field={k}>
                {Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {missingContact && entries.length > 0 && <p className="text-xs text-warning-text">No phone or email: the API rejects a lead without one of them.</p>}
      {data.errors.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Mapping problems">
          {data.errors.map((e) => (
            <li key={`${e.path}-${e.message}`} className="flex items-start gap-1.5 text-xs text-danger-text">
              <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <code className="font-mono">{e.path}</code>: {e.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
