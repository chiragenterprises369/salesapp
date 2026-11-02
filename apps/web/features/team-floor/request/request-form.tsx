'use client';

import { FLOOR_IMAGE_CATEGORIES, FLOOR_REQUEST_MIN_IMAGES, floorRequestImageProblems, type FloorImageCategory } from '@vistar/shared';
import { CheckCircle2, Circle, ImagePlus, Loader2, RotateCcw, Send, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { fieldErrorMap, isApiRequestError } from '@/lib/api-error';
import { cn } from '@/lib/cn';
import { FLOOR_REQUEST_MAX_IMAGES, IMAGE_ACCEPT, IMAGE_CATEGORY_HINT, IMAGE_CATEGORY_LABEL, imageProblem, MAX_IMAGE_MB, uploadReferenceImage, useCreateFloorRequest } from './data';

/**
 * Reference photos by room type, head count and notes (SPEC 29.5). Each photo uploads as soon as it is
 * picked (POST /files purpose reference_image) so a failed photo can be retried on its own; the
 * request is sent when the minimum rules pass (at least 3 photos, a work area, a cabin or meeting room).
 */

interface Pick {
  key: string;
  category: FloorImageCategory;
  file: File;
  preview: string;
  caption: string;
  state: 'uploading' | 'done' | 'failed';
  fileId: string | null;
  error: string | null;
}

let pickSeq = 0;
const nextPickKey = () => `pick-${++pickSeq}`;

const REQUIRED: Partial<Record<FloorImageCategory, string>> = { work_area: 'Required', cabin: 'Cabin or meeting room', meeting_room: 'Cabin or meeting room' };

export function FloorRequestForm({ initial, onDone, onCancel }: { initial?: { headcount: number; notes: string }; onDone: () => void; onCancel?: () => void }) {
  const [picks, setPicks] = useState<Pick[]>([]);
  const [headcount, setHeadcount] = useState(initial ? String(initial.headcount) : '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showRules, setShowRules] = useState(false);
  const create = useCreateFloorRequest();
  const formId = useId();
  const picksRef = useRef(picks);
  useEffect(() => {
    picksRef.current = picks;
  }, [picks]);

  // Release the local previews when the form goes away.
  useEffect(() => () => picksRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);

  const done = picks.filter((p) => p.state === 'done');
  const uploading = picks.some((p) => p.state === 'uploading');
  const problems = useMemo(() => floorRequestImageProblems(done.map((p) => p.category)), [done]);
  const full = picks.length >= FLOOR_REQUEST_MAX_IMAGES;

  const upload = (key: string, file: File) => {
    uploadReferenceImage(file)
      .then((stored) => setPicks((list) => list.map((p) => (p.key === key ? { ...p, state: 'done', fileId: stored.id, error: null } : p))))
      .catch((e: unknown) => {
        const message = e instanceof Error && e.message ? e.message : 'The photo did not upload. Try again.';
        setPicks((list) => list.map((p) => (p.key === key ? { ...p, state: 'failed', error: message } : p)));
      });
  };

  const add = (category: FloorImageCategory, files: FileList | null) => {
    if (!files?.length) return;
    const room = FLOOR_REQUEST_MAX_IMAGES - picksRef.current.length;
    const list = [...files].slice(0, Math.max(0, room));
    if (files.length > list.length) toast.error(`A request can have up to ${FLOOR_REQUEST_MAX_IMAGES} photos.`);
    const next: Pick[] = [];
    for (const file of list) {
      const problem = imageProblem(file);
      if (problem) {
        toast.error(problem);
        continue;
      }
      const key = nextPickKey();
      next.push({ key, category, file, preview: URL.createObjectURL(file), caption: '', state: 'uploading', fileId: null, error: null });
    }
    if (!next.length) return;
    setPicks((cur) => [...cur, ...next]);
    for (const p of next) upload(p.key, p.file);
  };

  const remove = (key: string) =>
    setPicks((list) => {
      const p = list.find((x) => x.key === key);
      if (p) URL.revokeObjectURL(p.preview);
      return list.filter((x) => x.key !== key);
    });

  const retry = (key: string) => {
    const p = picksRef.current.find((x) => x.key === key);
    if (!p) return;
    setPicks((list) => list.map((x) => (x.key === key ? { ...x, state: 'uploading', error: null } : x)));
    upload(key, p.file);
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setShowRules(true);
    const errs: Record<string, string> = {};
    const n = Number(headcount);
    if (!/^\d+$/.test(headcount.trim()) || n < 1 || n > 2000) errs.headcount = 'Enter the number of people who need a seat (1 to 2000).';
    if (notes.trim().length > 4000) errs.notes = 'Keep the notes under 4,000 characters.';
    if (problems.length) errs.images = problems[0]!;
    if (uploading) errs.images = 'Wait until every photo has uploaded.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      await create.mutateAsync({
        headcount: n,
        notes: notes.trim() || undefined,
        images: done.map((p) => ({ fileId: p.fileId!, category: p.category, caption: p.caption.trim() || undefined })),
      });
      toast.success('Photos sent. Vistar is preparing your office floor.');
      onDone();
    } catch (err) {
      const map = fieldErrorMap(err);
      setErrors({
        ...(map.headcount ? { headcount: map.headcount } : {}),
        ...(map.notes ? { notes: map.notes } : {}),
        ...(map.images ? { images: map.images } : {}),
        form: isApiRequestError(err) ? err.message : 'The request was not sent. Try again.',
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Get your own office floor</CardTitle>
          <CardDescription>
            Send photos of your office. Vistar builds a floor that looks like your space; until it is ready you see the standard office.
          </CardDescription>
        </div>
      </CardHeader>
      <form id={formId} onSubmit={onSubmit} noValidate>
        <CardContent className="flex flex-col gap-4">
          <section aria-labelledby={`${formId}-rules`} className="rounded-md border border-border bg-surface-2 p-3">
            <h4 id={`${formId}-rules`} className="text-xs font-semibold text-fg">
              Before you send
            </h4>
            <ul className="mt-1.5 grid gap-1 text-xs sm:grid-cols-3">
              <Rule ok={done.length >= FLOOR_REQUEST_MIN_IMAGES} text={`At least ${FLOOR_REQUEST_MIN_IMAGES} photos (${done.length} added)`} />
              <Rule ok={done.some((p) => p.category === 'work_area')} text="A photo of the work area" />
              <Rule ok={done.some((p) => p.category === 'cabin' || p.category === 'meeting_room')} text="A cabin or a meeting room" />
            </ul>
            <p className="mt-1.5 text-xs text-muted-strong">
              JPG, PNG or WebP up to {MAX_IMAGE_MB} MB each, at most {FLOOR_REQUEST_MAX_IMAGES} photos. Wide shots from a corner work best.
            </p>
          </section>

          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {FLOOR_IMAGE_CATEGORIES.map((c) => (
              <CategoryBox key={c} category={c} picks={picks.filter((p) => p.category === c)} disabled={full} onAdd={(files) => add(c, files)} onRemove={remove} onRetry={retry} onCaption={(key, caption) => setPicks((list) => list.map((p) => (p.key === key ? { ...p, caption } : p)))} />
            ))}
          </div>
          {showRules && errors.images && (
            <p role="alert" className="text-xs text-danger-text">
              {errors.images}
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <FormField label="People who need a seat" required error={errors.headcount} hint="Everyone who works from this office, including managers">
              <Input inputMode="numeric" value={headcount} onChange={(e) => setHeadcount(e.target.value)} placeholder="25" />
            </FormField>
            <FormField label="Notes for Vistar" error={errors.notes} hint="Anything the photos do not show: room sizes, which cabin is whose, where the sales team sits">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} rows={3} placeholder="One floor, about 30 x 18 m. Two cabins on the left, the calling team near the windows." />
            </FormField>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          {errors.form && (
            <p role="alert" className="mr-auto text-xs text-danger-text">
              {errors.form}
            </p>
          )}
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" variant="primary" loading={create.isPending} disabled={uploading}>
            <Send aria-hidden />
            Send photos
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function Rule({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li className={cn('flex items-center gap-1.5', ok ? 'text-success-text' : 'text-muted-strong')}>
      {ok ? <CheckCircle2 aria-hidden className="size-3.5" /> : <Circle aria-hidden className="size-3.5" />}
      <span>
        {text}
        <span className="sr-only">{ok ? ', done' : ', still needed'}</span>
      </span>
    </li>
  );
}

function CategoryBox({
  category,
  picks,
  disabled,
  onAdd,
  onRemove,
  onRetry,
  onCaption,
}: {
  category: FloorImageCategory;
  picks: Pick[];
  disabled: boolean;
  onAdd: (files: FileList | null) => void;
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
  onCaption: (key: string, caption: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const id = useId();
  const label = IMAGE_CATEGORY_LABEL[category];
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-category={category}
      className={cn('flex min-w-0 flex-col gap-2 rounded-md border border-dashed p-3 transition-colors', over ? 'border-ring bg-accent-soft' : 'border-border-strong bg-surface')}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) onAdd(e.dataTransfer.files);
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h5 id={`${id}-title`} className="text-sm font-medium text-fg">
            {label}
            {REQUIRED[category] && <span className="ml-1.5 text-2xs font-normal text-muted-strong">{REQUIRED[category]}</span>}
          </h5>
          <p className="text-xs text-muted">{IMAGE_CATEGORY_HINT[category]}</p>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          accept={IMAGE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            onAdd(e.target.files);
            e.target.value = '';
          }}
        />
        <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => input.current?.click()} aria-label={`Add photos: ${label}`}>
          <ImagePlus aria-hidden />
          Add
        </Button>
      </div>
      {picks.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {picks.map((p) => (
            <li key={p.key} className="flex min-w-0 flex-col gap-1">
              <div className="relative aspect-[4/3] overflow-hidden rounded-md border border-border bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                <img src={p.preview} alt={`${label}: ${p.file.name}`} className={cn('size-full object-cover', p.state !== 'done' && 'opacity-60')} />
                {p.state === 'uploading' && (
                  <span className="absolute inset-0 flex items-center justify-center" role="status">
                    <Loader2 aria-hidden className="size-5 animate-spin text-fg" />
                    <span className="sr-only">Uploading {p.file.name}</span>
                  </span>
                )}
                <Button type="button" size="icon-sm" variant="secondary" className="absolute top-1 right-1" onClick={() => onRemove(p.key)} aria-label={`Remove ${p.file.name}`}>
                  <X aria-hidden />
                </Button>
              </div>
              {p.state === 'failed' ? (
                <div className="flex items-center gap-1">
                  <p role="alert" className="min-w-0 flex-1 truncate text-2xs text-danger-text" title={p.error ?? undefined}>
                    {p.error}
                  </p>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => onRetry(p.key)} aria-label={`Upload ${p.file.name} again`}>
                    <RotateCcw aria-hidden />
                  </Button>
                </div>
              ) : (
                <Input size="sm" value={p.caption} maxLength={200} onChange={(e) => onCaption(p.key, e.target.value)} placeholder="Caption (optional)" aria-label={`Caption for ${p.file.name}`} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
