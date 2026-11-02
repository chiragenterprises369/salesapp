'use client';

import { fieldAccessFor, type LeadListItem, type LeadUpdate } from '@vistar/shared';
import { EMPLOYEE_FIXTURES, mockUsers } from '@vistar/shared/fixtures';
import { isMockData } from '@/lib/api/data-source';
import { useUsers } from '@/lib/api/directory';
import { CheckCircle2, FileSpreadsheet, Info, Upload } from 'lucide-react';
import Papa from 'papaparse';
import { RadioGroup } from 'radix-ui';
import { useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { useCreateLead, useUpdateLead } from '@/lib/leads/data';
import { useLeadsViewState } from '@/lib/leads/state';
import { useVisibleFields } from '@/lib/customization';
import { useMe } from '@/lib/session/session';
import { useScopedUsers } from '../lead-meta';
import { Select } from '../primitives/select';
import { useRecentLeads } from '../stores';
import { usePipelineStages } from '../use-stages';
import { downloadText, fetchAllLeads } from './export';
import {
  detectDuplicates,
  fieldLabel,
  fieldOptions,
  mapRow,
  SAMPLE_CSV,
  suggestMapping,
  type ImportField,
  type MappedRow,
} from './mapping';

type Step = 'upload' | 'map' | 'review' | 'running' | 'done';
type Strategy = 'skip' | 'update' | 'create';
const MAX_ROWS = 5000;
const SKIP = '__skip';

interface Parsed {
  fileName: string;
  headers: string[];
  rows: Array<Record<string, string>>;
}

interface Result {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'upload', label: 'Upload' },
  { id: 'map', label: 'Map columns' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Import' },
];

/**
 * Import leads from CSV (parsed in the browser with papaparse). XLSX is accepted by the server
 * import (POST /leads/import) once integrated. Duplicates are matched by phone, then email.
 */
export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const me = useMe();
  const scoped = useScopedUsers();
  const people = useUsers();
  const create = useCreateLead();
  const update = useUpdateLead();
  const markRecent = useRecentLeads((s) => s.mark);
  const filters = useLeadsViewState((s) => s.filters);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [step, setStep] = useState<Step>('upload');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [xlsxName, setXlsxName] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, ImportField | null>>({});
  const [existing, setExisting] = useState<LeadListItem[] | null>(null);
  const [strategy, setStrategy] = useState<Strategy>('skip');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<Result | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const cancelled = useRef(false);
  const { stages } = usePipelineStages();
  const leadFields = useVisibleFields('lead');
  // Only fields this role may write can be imported (the API rejects the others).
  const roleKey = me?.role.key ?? null;
  const customFields = useMemo(
    () => (leadFields.data ?? []).filter((d) => fieldAccessFor(d, roleKey) === 'write'),
    [leadFields.data, roleKey],
  );
  const options = useMemo(() => fieldOptions(customFields), [customFields]);
  const label = (f: ImportField) => fieldLabel(f, options);

  const owners = useMemo(() => {
    const ids = new Set(scoped.map((u) => u.id));
    // Owner emails: GET /users (team.read) in API mode; the fixture emails in the mock data mode.
    const all = isMockData()
      ? mockUsers().map((u, i) => ({ id: u.id, email: EMPLOYEE_FIXTURES[i]?.email }))
      : (people.data ?? []).map((u) => ({ id: u.id, email: u.email }));
    return all.filter((o) => ids.has(o.id));
  }, [scoped, people.data]);

  const reset = () => {
    setStep('upload');
    setParsed(null);
    setFileError(null);
    setXlsxName(null);
    setMapping({});
    setExisting(null);
    setStrategy('skip');
    setProgress({ done: 0, total: 0 });
    setResult(null);
  };

  const mappedFields = Object.values(mapping).filter(Boolean) as ImportField[];
  const duplicateFields = mappedFields.filter((f, i) => mappedFields.indexOf(f) !== i);
  const nameMapped = mappedFields.includes('name');

  const rows: MappedRow[] = useMemo(() => {
    if (!parsed || !existing) return [];
    return detectDuplicates(
      parsed.rows.map((r) => mapRow(r, mapping, owners, { stages, customFields })),
      existing,
    );
  }, [parsed, existing, mapping, owners, stages, customFields]);

  const counts = useMemo(() => {
    const valid = rows.filter((r) => r.input);
    const dupes = valid.filter((r) => r.duplicateOf || r.duplicateInFile);
    return {
      valid: valid.length,
      dupes: dupes.length,
      fresh: valid.length - dupes.length,
      errors: rows.length - valid.length,
    };
  }, [rows]);

  const handleFile = (file: File | undefined) => {
    setFileError(null);
    setXlsxName(null);
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      setXlsxName(file.name);
      return;
    }
    if (!lower.endsWith('.csv') && file.type !== 'text/csv') {
      setFileError('Choose a .csv file (or .xlsx once server import is connected).');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setFileError('This file is over 10 MB. Split it into smaller files.');
      return;
    }
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        const headers = (res.meta.fields ?? []).filter(Boolean);
        if (headers.length === 0 || res.data.length === 0) {
          setFileError('No rows found. The first row must contain column names.');
          return;
        }
        if (res.data.length > MAX_ROWS) {
          setFileError(
            `This file has ${res.data.length.toLocaleString('en-IN')} rows. Import up to ${MAX_ROWS.toLocaleString('en-IN')} at a time.`,
          );
          return;
        }
        setParsed({ fileName: file.name, headers, rows: res.data });
        setMapping(suggestMapping(headers, customFields));
        setStep('map');
      },
      error: () =>
        setFileError('This file could not be read. Save it as CSV (UTF-8) and try again.'),
    });
  };

  const toReview = async () => {
    setStep('review');
    if (!existing) {
      try {
        // Duplicate check against every lead you can see (mock: the in-memory source).
        setExisting(await fetchAllLeads({}, { sort: 'createdAt', dir: 'desc' }));
      } catch {
        setExisting([]);
        toast.error(
          'Existing leads did not load, so duplicates cannot be checked. Try again before importing.',
        );
      }
    }
  };

  const run = async () => {
    cancelled.current = false;
    setStep('running');
    const todo = rows;
    const res: Result = { created: 0, updated: 0, skipped: 0, errors: [] };
    const createdIds: string[] = [];
    setProgress({ done: 0, total: todo.length });
    for (let i = 0; i < todo.length; i++) {
      if (cancelled.current) break;
      const r = todo[i]!;
      const rowNo = r.index + 2; // header is row 1
      try {
        if (!r.input) {
          res.errors.push({ row: rowNo, message: r.error ?? 'Invalid row' });
        } else if ((r.duplicateOf || r.duplicateInFile) && strategy === 'skip') {
          res.skipped++;
        } else if (r.duplicateOf && strategy === 'update') {
          const {
            name,
            companyName,
            email,
            city,
            state,
            productInterest,
            requirement,
            valueInr,
            tags,
          } = r.input;
          const patch: LeadUpdate = {
            name,
            companyName,
            email,
            city,
            state,
            productInterest,
            requirement,
            ...(valueInr ? { valueInr } : {}),
            ...(tags.length ? { tags: [...new Set([...r.duplicateOf.tags, ...tags])] } : {}),
          };
          await update.mutateAsync({ id: r.duplicateOf.id, patch });
          res.updated++;
        } else if (r.duplicateInFile && strategy === 'update') {
          res.skipped++;
        } else {
          const lead = await create.mutateAsync({
            ...r.input,
            ownerId: r.input.ownerId ?? me?.user.id,
          });
          createdIds.push(lead.id);
          res.created++;
        }
      } catch {
        res.errors.push({ row: rowNo, message: 'Could not save this row' });
      }
      setProgress({ done: i + 1, total: todo.length });
    }
    markRecent(createdIds);
    setResult(res);
    setStep('done');
    toast.success(
      `Import finished: ${res.created} created, ${res.updated} updated, ${res.skipped} skipped`,
    );
  };

  const stepIndex = STEPS.findIndex((s) => s.id === (step === 'running' ? 'done' : step));
  const previewRows = rows.slice(0, 6);
  const previewCols = parsed ? parsed.headers.filter((h) => mapping[h]) : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (step === 'running') return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent size="xl" className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import leads</DialogTitle>
          <DialogDescription>
            Upload a CSV, match its columns to lead fields, review duplicates, then import.
          </DialogDescription>
          <ol
            className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
            aria-label="Import steps"
          >
            {STEPS.map((s, i) => (
              <li
                key={s.id}
                aria-current={i === stepIndex ? 'step' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5',
                  i === stepIndex
                    ? 'font-medium text-fg'
                    : i < stepIndex
                      ? 'text-fg-secondary'
                      : 'text-muted',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'tabular inline-flex size-5 items-center justify-center rounded-full border text-2xs',
                    i === stepIndex
                      ? 'border-accent bg-accent text-accent-fg'
                      : i < stepIndex
                        ? 'border-status-indigo-border bg-accent-soft text-accent-soft-fg'
                        : 'border-border',
                  )}
                >
                  {i + 1}
                </span>
                {s.label}
              </li>
            ))}
          </ol>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {step === 'upload' && (
            <>
              <div
                onDragOver={(e: DragEvent) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e: DragEvent) => {
                  e.preventDefault();
                  setDragOver(false);
                  handleFile(e.dataTransfer.files[0]);
                }}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors',
                  dragOver ? 'border-accent bg-accent-soft' : 'border-border-strong bg-surface-2',
                )}
              >
                <Upload aria-hidden className="size-6 text-muted-strong" />
                <p className="text-sm font-medium">Drop a CSV file here</p>
                <p className="text-xs text-muted-strong">
                  Up to {MAX_ROWS.toLocaleString('en-IN')} rows. The first row must contain column
                  names.
                </p>
                <input
                  ref={inputRef}
                  id={inputId}
                  type="file"
                  accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  onChange={(e) => {
                    handleFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <Button className="mt-1" onClick={() => inputRef.current?.click()}>
                  <FileSpreadsheet aria-hidden />
                  Choose file
                </Button>
              </div>
              {fileError && (
                <p role="alert" className="text-sm text-danger-text">
                  {fileError}
                </p>
              )}
              {xlsxName && (
                <div
                  role="status"
                  className="flex gap-2 rounded-md border border-status-blue-border bg-status-blue-bg p-3 text-sm text-status-blue-fg"
                >
                  <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <p>
                    <strong className="font-semibold">{xlsxName}</strong> is an Excel file. Excel
                    files are read by the server import, which is connected in a later release. For
                    now, open it in Excel or Google Sheets and save it as CSV (UTF-8).
                  </p>
                </div>
              )}
              <Button
                variant="link"
                size="sm"
                className="self-start"
                onClick={() => downloadText('vistar-leads-sample.csv', SAMPLE_CSV)}
              >
                Download a sample CSV
              </Button>
            </>
          )}

          {step === 'map' && parsed && (
            <>
              <p className="text-sm text-fg-secondary">
                <strong className="font-medium text-fg">{parsed.fileName}</strong> ·{' '}
                {parsed.rows.length.toLocaleString('en-IN')} rows. We matched columns by their
                names; check each one.
              </p>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[520px] border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th
                        scope="col"
                        className="h-8 border-b border-border bg-surface px-3 text-left text-xs font-medium text-muted"
                      >
                        Column in file
                      </th>
                      <th
                        scope="col"
                        className="h-8 border-b border-border bg-surface px-3 text-left text-xs font-medium text-muted"
                      >
                        First value
                      </th>
                      <th
                        scope="col"
                        className="h-8 w-56 border-b border-border bg-surface px-3 text-left text-xs font-medium text-muted"
                      >
                        Lead field
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.headers.map((h) => {
                      const dup = mapping[h] && duplicateFields.includes(mapping[h]!);
                      return (
                        <tr key={h}>
                          <td className="h-10 border-b border-border px-3 font-medium">{h}</td>
                          <td className="h-10 max-w-48 truncate border-b border-border px-3 text-fg-secondary">
                            {parsed.rows[0]?.[h] || <span className="text-muted">empty</span>}
                          </td>
                          <td className="h-10 border-b border-border px-3">
                            <Select
                              size="sm"
                              aria-label={`Lead field for column ${h}`}
                              aria-invalid={dup ? true : undefined}
                              value={mapping[h] ?? SKIP}
                              onValueChange={(v) =>
                                setMapping((m) => ({
                                  ...m,
                                  [h]: v === SKIP ? null : (v as ImportField),
                                }))
                              }
                              options={[{ value: SKIP, label: 'Do not import' }, ...options]}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!nameMapped && (
                <p role="alert" className="text-sm text-danger-text">
                  Map a column to Name. Every lead needs a name.
                </p>
              )}
              {duplicateFields.length > 0 && (
                <p role="alert" className="text-sm text-danger-text">
                  {label(duplicateFields[0]!)} is mapped to more than one column. Keep one.
                </p>
              )}
              {nameMapped && !mappedFields.includes('phone') && !mappedFields.includes('email') && (
                <p className="text-sm text-warning-text">
                  No phone or email column is mapped, so duplicates cannot be detected.
                </p>
              )}
            </>
          )}

          {step === 'review' && parsed && (
            <>
              {!existing ? (
                <p className="text-sm text-muted" role="status">
                  Checking for duplicates…
                </p>
              ) : (
                <>
                  <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      ['Rows', rows.length],
                      ['New leads', counts.fresh],
                      ['Duplicates', counts.dupes],
                      ['With errors', counts.errors],
                    ].map(([label, n]) => (
                      <div key={label} className="rounded-md border border-border p-3">
                        <dt className="text-xs text-muted">{label}</dt>
                        <dd className="tabular text-lg font-semibold">
                          {Number(n).toLocaleString('en-IN')}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {counts.dupes > 0 && (
                    <fieldset className="flex flex-col gap-2">
                      <legend className="mb-1 text-xs font-medium text-fg-secondary">
                        When a lead with the same phone (or email) exists
                      </legend>
                      <RadioGroup.Root
                        value={strategy}
                        onValueChange={(v) => setStrategy(v as Strategy)}
                        className="grid gap-2 sm:grid-cols-3"
                        aria-label="Duplicate handling"
                      >
                        {(
                          [
                            ['skip', 'Skip', 'Keep the existing lead as it is'],
                            [
                              'update',
                              'Update',
                              'Fill the existing lead with values from the file',
                            ],
                            ['create', 'Create anyway', 'Add a second lead; merge later'],
                          ] as const
                        ).map(([id, label, hint]) => (
                          <RadioGroup.Item
                            key={id}
                            value={id}
                            className={cn(
                              'focus-ring flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left',
                              strategy === id
                                ? 'border-status-indigo-border bg-accent-soft'
                                : 'border-border hover:bg-surface-2',
                            )}
                          >
                            <span
                              className={cn(
                                'text-sm font-medium',
                                strategy === id ? 'text-accent-soft-fg' : 'text-fg',
                              )}
                            >
                              {label}
                            </span>
                            <span
                              className={cn(
                                'text-xs',
                                strategy === id ? 'text-muted-strong' : 'text-muted',
                              )}
                            >
                              {hint}
                            </span>
                          </RadioGroup.Item>
                        ))}
                      </RadioGroup.Root>
                    </fieldset>
                  )}
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full border-separate border-spacing-0 text-sm">
                      <caption className="sr-only">
                        Preview of the first {previewRows.length} rows
                      </caption>
                      <thead>
                        <tr>
                          <th
                            scope="col"
                            className="h-8 border-b border-border px-3 text-left text-xs font-medium text-muted"
                          >
                            Row
                          </th>
                          <th
                            scope="col"
                            className="h-8 border-b border-border px-3 text-left text-xs font-medium text-muted"
                          >
                            Status
                          </th>
                          {previewCols.map((h) => (
                            <th
                              key={h}
                              scope="col"
                              className="h-8 border-b border-border px-3 text-left text-xs font-medium whitespace-nowrap text-muted"
                            >
                              {label(mapping[h]!)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((r) => (
                          <tr key={r.index}>
                            <td className="tabular h-9 border-b border-border px-3 text-muted">
                              {r.index + 2}
                            </td>
                            <td className="h-9 border-b border-border px-3 whitespace-nowrap">
                              {r.error ? (
                                <Chip tone="red" title={r.error}>
                                  Error
                                </Chip>
                              ) : r.duplicateOf ? (
                                <Chip tone="amber" title={`Matches ${r.duplicateOf.name}`}>
                                  Duplicate ({r.duplicateOf.by})
                                </Chip>
                              ) : r.duplicateInFile ? (
                                <Chip tone="amber">Repeated in file</Chip>
                              ) : (
                                <Chip tone="green">New</Chip>
                              )}
                            </td>
                            {previewCols.map((h) => (
                              <td
                                key={h}
                                className="h-9 max-w-40 truncate border-b border-border px-3 whitespace-nowrap text-fg-secondary"
                              >
                                {parsed.rows[r.index]?.[h]}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {counts.errors > 0 && (
                    <ul className="flex flex-col gap-1 text-xs text-danger-text">
                      {rows
                        .filter((r) => r.error)
                        .slice(0, 4)
                        .map((r) => (
                          <li key={r.index}>
                            Row {r.index + 2}: {r.error}
                          </li>
                        ))}
                      {counts.errors > 4 && (
                        <li>…and {counts.errors - 4} more. Rows with errors are skipped.</li>
                      )}
                    </ul>
                  )}
                </>
              )}
            </>
          )}

          {step === 'running' && (
            <div className="flex flex-col gap-3 py-6" role="status" aria-live="polite">
              <p className="text-sm font-medium">
                Importing {progress.done.toLocaleString('en-IN')} of{' '}
                {progress.total.toLocaleString('en-IN')} rows…
              </p>
              <div
                role="progressbar"
                aria-label="Import progress"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.done}
                className="h-2 overflow-hidden rounded-full bg-surface-3"
              >
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-150"
                  style={{
                    width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          )}

          {step === 'done' && result && (
            <div className="flex flex-col gap-4" role="status">
              <div className="flex items-center gap-2">
                <CheckCircle2 aria-hidden className="size-5 text-success-text" />
                <p className="text-sm font-semibold">Import finished</p>
              </div>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['Created', result.created],
                  ['Updated', result.updated],
                  ['Skipped', result.skipped],
                  ['Errors', result.errors.length],
                ].map(([label, n]) => (
                  <div key={label} className="rounded-md border border-border p-3">
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="tabular text-lg font-semibold">
                      {Number(n).toLocaleString('en-IN')}
                    </dd>
                  </div>
                ))}
              </dl>
              {result.errors.length > 0 && (
                <Button
                  size="sm"
                  className="self-start"
                  onClick={() =>
                    downloadText(
                      'vistar-import-errors.csv',
                      Papa.unparse(
                        result.errors.map((e) => ({ Row: e.row, Problem: e.message })),
                        { escapeFormulae: true },
                      ),
                    )
                  }
                >
                  Download error report
                </Button>
              )}
              {Object.keys(filters).length > 0 && result.created > 0 && (
                <p className="text-xs text-muted">
                  New leads that do not match your current filters are hidden from the list.
                </p>
              )}
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          {step === 'upload' && (
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
          )}
          {step === 'map' && (
            <>
              <Button onClick={() => setStep('upload')}>Back</Button>
              <Button
                variant="primary"
                disabled={!nameMapped || duplicateFields.length > 0}
                onClick={() => void toReview()}
              >
                Review {parsed?.rows.length.toLocaleString('en-IN')} rows
              </Button>
            </>
          )}
          {step === 'review' && (
            <>
              <Button onClick={() => setStep('map')}>Back</Button>
              <Button
                variant="primary"
                disabled={!existing || counts.valid === 0}
                onClick={() => void run()}
              >
                Import {(strategy === 'skip' ? counts.fresh : counts.valid).toLocaleString('en-IN')}{' '}
                leads
              </Button>
            </>
          )}
          {step === 'running' && (
            <Button onClick={() => (cancelled.current = true)}>Stop import</Button>
          )}
          {step === 'done' && (
            <DialogClose asChild>
              <Button variant="primary">Done</Button>
            </DialogClose>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
