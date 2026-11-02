'use client';

import { FLOOR_IMAGE_CATEGORIES, type FloorAsset, type FloorRequest } from '@vistar/shared';
import {
  Check,
  ClipboardCopy,
  ExternalLink,
  FileJson,
  ImageIcon,
  Layers,
  Upload,
} from 'lucide-react';
import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import { columnClass, DataTable, type DataColumn } from '@/components/common/data-table';
import { formatDateTimeIn } from '@/components/common/time';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField, Textarea } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { isApiRequestError } from '@/lib/api-error';
import { cn } from '@/lib/cn';
import { IMAGE_CATEGORY_LABEL } from '@/features/team-floor/request/data';
import {
  checkFloorFile,
  checkPlanText,
  floorPrompt,
  planFile,
  useCompanyFloors,
  usePublishFloor,
  useUploadFloor,
  type FileCheck,
} from './data';
import { AssetStatusChip, FORMAT_LABEL, TZ } from './status';

// ---------------------------------------------------------------- photos

export function PhotoGallery({ request }: { request: FloorRequest }) {
  const [open, setOpen] = useState<number | null>(null);
  const images = request.images;
  const current = open === null ? null : images[open];
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Office photos</CardTitle>
          <CardDescription>
            {images.length} {images.length === 1 ? 'photo' : 'photos'}. Save them (open, then save
            the image) to attach them in the AI chat.
          </CardDescription>
        </div>
        <ImageIcon aria-hidden className="size-4 text-fg-secondary" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {FLOOR_IMAGE_CATEGORIES.map((cat) => {
          const list = images
            .map((img, i) => ({ img, i }))
            .filter(({ img }) => img.category === cat);
          if (!list.length) return null;
          return (
            <section key={cat} aria-label={IMAGE_CATEGORY_LABEL[cat]}>
              <h4 className="mb-1.5 text-xs font-semibold text-fg-secondary">
                {IMAGE_CATEGORY_LABEL[cat]}{' '}
                <span className="font-normal text-muted">({list.length})</span>
              </h4>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
                {list.map(({ img, i }) => (
                  <li key={img.fileId}>
                    <button
                      type="button"
                      onClick={() => setOpen(i)}
                      className="focus-ring group relative block aspect-[4/3] w-full overflow-hidden rounded-md border border-border bg-surface-2"
                      aria-label={`Open ${IMAGE_CATEGORY_LABEL[cat]} photo ${img.name}${img.caption ? `: ${img.caption}` : ''}`}
                    >
                      {img.url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- signed private URL (15 min)
                        <img
                          src={img.url}
                          alt=""
                          className="size-full object-cover transition-transform duration-200 ease-standard group-hover:scale-[1.03]"
                          loading="lazy"
                        />
                      ) : (
                        <span className="flex size-full items-center justify-center text-xs text-muted">
                          {img.name}
                        </span>
                      )}
                    </button>
                    {img.caption && (
                      <p className="mt-1 truncate text-2xs text-muted-strong">{img.caption}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {request.notes && (
          <section
            aria-label="Notes from the company"
            className="rounded-md border border-border bg-surface-2 p-3"
          >
            <h4 className="text-xs font-semibold text-fg-secondary">Notes from the company</h4>
            <p className="mt-1 text-sm whitespace-pre-line text-fg">{request.notes}</p>
          </section>
        )}
      </CardContent>
      <Dialog
        open={current !== null && current !== undefined}
        onOpenChange={(o) => !o && setOpen(null)}
      >
        <DialogContent size="xl">
          {current && (
            <>
              <DialogHeader>
                <DialogTitle>{IMAGE_CATEGORY_LABEL[current.category]}</DialogTitle>
                <DialogDescription>{current.caption ?? current.name}</DialogDescription>
              </DialogHeader>
              <DialogBody className="flex flex-col gap-3">
                {current.url && (
                  // eslint-disable-next-line @next/next/no-img-element -- signed private URL (15 min)
                  <img
                    src={current.url}
                    alt={`${IMAGE_CATEGORY_LABEL[current.category]}: ${current.caption ?? current.name}`}
                    className="max-h-[65dvh] w-full rounded-md object-contain"
                  />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={open === 0}
                    onClick={() => setOpen((o) => (o === null ? o : Math.max(0, o - 1)))}
                  >
                    Previous
                  </Button>
                  <span className="text-xs text-muted tabular">
                    {(open ?? 0) + 1} of {images.length}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={open === images.length - 1}
                    onClick={() =>
                      setOpen((o) => (o === null ? o : Math.min(images.length - 1, o + 1)))
                    }
                  >
                    Next
                  </Button>
                  {current.url && (
                    <Button size="sm" variant="secondary" asChild className="ml-auto">
                      <a href={current.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink aria-hidden />
                        Open full size
                      </a>
                    </Button>
                  )}
                </div>
              </DialogBody>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------- prompt

export function PromptCard({ request }: { request: FloorRequest }) {
  const prompt = floorPrompt(request);
  const [copied, setCopied] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      toast.success('Prompt copied. Paste it into the AI chat with the photos.');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      area.current?.select();
      toast.error('Copy did not work in this browser. The prompt is selected: press Ctrl+C.');
    }
  };
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Make the floor with AI</CardTitle>
          <CardDescription>
            No API key needed: the prompt already has this company&apos;s head count (
            {request.headcount}) and notes.
          </CardDescription>
        </div>
        <Button size="sm" variant="primary" onClick={() => void copy()}>
          {copied ? <Check aria-hidden /> : <ClipboardCopy aria-hidden />}
          {copied ? 'Copied' : 'Copy prompt'}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ol className="grid gap-2 text-sm text-fg md:grid-cols-3">
          <Step n={1} text="Open a new Claude chat and attach the office photos from this page." />
          <Step
            n={2}
            text="Paste the prompt and send it. Save the JSON it answers with as a .json file, or copy it."
          />
          <Step
            n={3}
            text="Upload the file or paste the JSON below, check the preview and seats, then publish."
          />
        </ol>
        <label className="sr-only" htmlFor="floor-prompt">
          AI prompt
        </label>
        <Textarea
          id="floor-prompt"
          ref={area}
          readOnly
          value={prompt}
          rows={9}
          className="font-mono text-xs leading-5"
          onFocus={(e) => e.currentTarget.select()}
        />
      </CardContent>
    </Card>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <li className="flex items-start gap-2">
      <span
        aria-hidden
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent-soft-fg"
      >
        {n}
      </span>
      <span>
        <span className="sr-only">Step {n}: </span>
        {text}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------- upload

export function UploadCard({
  request,
  onUploaded,
}: {
  request: FloorRequest;
  onUploaded: (asset: FloorAsset) => void;
}) {
  const upload = useUploadFloor(request.workspaceId);
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [check, setCheck] = useState<FileCheck | null>(null);
  const [serverProblems, setServerProblems] = useState<string[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();

  const pick = async (f: File | null) => {
    setFile(f);
    setServerProblems(null);
    setCheck(f ? await checkFloorFile(f) : null);
  };
  const onPaste = (value: string) => {
    setText(value);
    setServerProblems(null);
    setCheck(value.trim() ? checkPlanText(value) : null);
  };

  async function send() {
    const f =
      mode === 'file'
        ? file
        : text.trim()
          ? planFile(
              text,
              `${request.workspaceName.replace(/[^\w-]+/g, '-').toLowerCase() || 'office'}-floor.json`,
            )
          : null;
    if (!f || !check?.ok) return;
    setServerProblems(null);
    try {
      const asset = await upload.mutateAsync({ file: f, requestId: request.id });
      toast.success(
        `Version ${asset.version} uploaded. Check the preview and the seats, then publish.`,
      );
      setFile(null);
      setText('');
      setCheck(null);
      if (input.current) input.current.value = '';
      onUploaded(asset);
    } catch (e) {
      if (isApiRequestError(e))
        setServerProblems([
          e.message,
          ...e.details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)),
        ]);
      else setServerProblems(['The file was not uploaded. Try again.']);
    }
  }

  const problems = check && !check.ok ? check.problems : serverProblems;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Upload the floor</CardTitle>
          <CardDescription>
            A Vistar floor plan (.json from the AI chat), a .glb model, or a .zip with one .gltf. Up
            to 40 MB; each upload is a new draft version.
          </CardDescription>
        </div>
        <Upload aria-hidden className="size-4 text-fg-secondary" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div role="group" aria-label="How to add the floor" className="flex gap-1">
          {(['file', 'paste'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m);
                setCheck(m === 'file' ? null : text.trim() ? checkPlanText(text) : null);
                setServerProblems(null);
              }}
              className="focus-ring h-7 rounded-md px-2.5 text-xs font-medium text-fg-secondary hover:bg-surface-3 aria-pressed:bg-accent-soft aria-pressed:text-accent-soft-fg"
            >
              {m === 'file' ? 'Upload a file' : 'Paste JSON'}
            </button>
          ))}
        </div>
        {mode === 'file' ? (
          <FormField label="Floor file" hint=".json, .glb or .zip">
            <input
              ref={input}
              type="file"
              accept=".json,.glb,.zip,application/json,model/gltf-binary,application/zip"
              onChange={(e) => void pick(e.target.files?.[0] ?? null)}
              className="focus-ring block w-full rounded-md border border-input bg-surface text-sm text-fg-secondary file:mr-3 file:h-8 file:cursor-pointer file:border-0 file:border-r file:border-border file:bg-surface-2 file:px-3 file:text-sm file:font-medium file:text-fg"
            />
          </FormField>
        ) : (
          <FormField
            label="Floor plan JSON"
            hint="Paste the whole answer of the AI chat; a ```json fence is fine."
          >
            <Textarea
              id={`${id}-paste`}
              value={text}
              onChange={(e) => onPaste(e.target.value)}
              rows={8}
              className="font-mono text-xs"
              placeholder='{ "schemaVersion": 1, "kind": "vistar.floor-plan", ... }'
              spellCheck={false}
            />
          </FormField>
        )}
        {check?.ok && !serverProblems && (
          <p
            className="flex items-start gap-1.5 rounded-md border border-status-green-border bg-status-green-bg px-3 py-2 text-xs text-status-green-fg"
            role="status"
          >
            <Check aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {check.summary}
          </p>
        )}
        {problems && problems.length > 0 && (
          <div
            role="alert"
            className="rounded-md border border-status-red-border bg-status-red-bg px-3 py-2"
          >
            <p className="text-xs font-semibold text-status-red-fg">
              {check && !check.ok ? 'This file cannot be used yet' : 'The upload was refused'}
            </p>
            <ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-4 font-mono text-2xs leading-5 text-status-red-fg">
              {problems.map((p, i) => (
                <li key={`${i}-${p}`}>{p}</li>
              ))}
            </ul>
            {check && !check.ok && (
              <p className="mt-1.5 text-2xs text-status-red-fg">
                Ask the AI chat to fix exactly these points and return the full JSON again.
              </p>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          variant="primary"
          onClick={() => void send()}
          disabled={!check?.ok}
          loading={upload.isPending}
        >
          {check?.ok && check.format === 'layout_json' ? (
            <FileJson aria-hidden />
          ) : (
            <Upload aria-hidden />
          )}
          Upload as a new version
        </Button>
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------- versions

const VERSION_COLUMNS: DataColumn[] = [
  { key: 'version', label: 'Version' },
  { key: 'format', label: 'Format', hideBelow: 'sm' },
  { key: 'seats', label: 'Seats', align: 'right' },
  { key: 'uploaded', label: 'Uploaded', hideBelow: 'md' },
  { key: 'published', label: 'Published', hideBelow: 'lg' },
  { key: 'actions', label: 'Actions', align: 'right' },
];

export function VersionsCard({
  workspaceId,
  highlight,
}: {
  workspaceId: string;
  highlight?: string | null;
}) {
  const versions = useCompanyFloors(workspaceId);
  const rows = versions.data ?? [];
  const state = versions.isPending
    ? 'loading'
    : versions.isError
      ? 'error'
      : rows.length === 0
        ? 'empty'
        : 'ready';
  return (
    <section aria-labelledby="floor-versions" className="flex flex-col gap-2">
      <h3 id="floor-versions" className="text-sm font-semibold text-fg">
        Version history
      </h3>
      <DataTable
        label="Floor versions"
        columns={VERSION_COLUMNS}
        status={state}
        onRetry={() => void versions.refetch()}
        skeletonRows={2}
        empty={{
          icon: <Layers />,
          title: 'No floor uploaded yet',
          description: 'Upload the file from the AI chat above; it appears here as version 1.',
        }}
      >
        {rows.map((v) => (
          <VersionRow key={v.id} v={v} highlight={v.id === highlight} />
        ))}
      </DataTable>
    </section>
  );
}

function VersionRow({ v, highlight }: { v: FloorAsset; highlight: boolean }) {
  const publish = usePublishFloor(v.id);
  return (
    <TableRow data-new={highlight || undefined}>
      <TableCell className="py-2">
        <span className="flex items-center gap-1.5 font-medium text-fg">
          v{v.version}
          <AssetStatusChip status={v.status} />
        </span>
        {v.notes && <span className="block max-w-xs truncate text-xs text-muted">{v.notes}</span>}
      </TableCell>
      <TableCell className={cn(columnClass(VERSION_COLUMNS[1]!), 'py-2 text-fg-secondary')}>
        {FORMAT_LABEL[v.format]}
      </TableCell>
      <TableCell className={cn(columnClass(VERSION_COLUMNS[2]!), 'tabular py-2')}>
        {v.seatMap ? v.seatCount : <span className="text-warning-text">None yet</span>}
      </TableCell>
      <TableCell className={cn(columnClass(VERSION_COLUMNS[3]!), 'py-2 text-fg-secondary')}>
        {formatDateTimeIn(v.createdAt, TZ)}
        {v.uploadedBy && <span className="block text-xs text-muted">{v.uploadedBy.name}</span>}
      </TableCell>
      <TableCell className={cn(columnClass(VERSION_COLUMNS[4]!), 'py-2 text-fg-secondary')}>
        {v.publishedAt ? formatDateTimeIn(v.publishedAt, TZ) : '–'}
      </TableCell>
      <TableCell className="py-2 text-right">
        <span className="inline-flex flex-wrap justify-end gap-1">
          <Button size="sm" variant="secondary" asChild>
            <Link href={`/super-admin/floors/versions/${v.id}`}>
              {v.status === 'superseded' ? 'View' : 'Seats and preview'}
            </Link>
          </Button>
          {v.status === 'draft' && v.seatMap && (
            <Button
              size="sm"
              variant="primary"
              loading={publish.isPending}
              onClick={() =>
                publish.mutate(undefined, {
                  onSuccess: (a) =>
                    toast.success(`Version ${a.version} is live on the company's Team Floor.`),
                  onError: (e) =>
                    toast.error(
                      isApiRequestError(e) ? e.message : 'The floor was not published. Try again.',
                    ),
                })
              }
            >
              Publish
            </Button>
          )}
        </span>
      </TableCell>
    </TableRow>
  );
}
