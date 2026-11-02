'use client';

import { CheckCircle2, CircleAlert, FileJson, KeyRound, Smartphone, Trash2, Upload } from 'lucide-react';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { columnClass, DataTable, type DataColumn } from '@/components/common/data-table';
import { PageHeader } from '@/components/common/page-header';
import { formatDateTimeIn } from '@/components/common/time';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { FormField, Input, Label, Textarea } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/branding/http';
import {
  ANDROID_PACKAGE,
  formatBytes,
  previewGoogleServices,
  useAndroidReleases,
  useFirebaseStatus,
  useRemoveFirebasePart,
  useUploadGoogleServices,
  useUploadRelease,
  useUploadServiceAccount,
  validateRelease,
} from '@/lib/branding/platform-config';

const TZ = 'Asia/Kolkata';
const when = (iso: string | null) => (iso ? formatDateTimeIn(iso, TZ) : '–');

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="truncate text-sm font-medium text-fg">{children}</dd>
    </div>
  );
}

/** Hidden file input + button; resets after each pick so the same file can be chosen again. */
function FilePick({ accept, label, onFile, loading, variant = 'secondary' }: { accept: string; label: string; onFile: (f: File) => void; loading?: boolean; variant?: 'primary' | 'secondary' }) {
  const ref = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <>
      <input
        ref={ref}
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      <Button variant={variant} size="sm" loading={loading} onClick={() => ref.current?.click()}>
        <Upload aria-hidden />
        {label}
      </Button>
    </>
  );
}

function FirebaseCard() {
  const status = useFirebaseStatus();
  const uploadClient = useUploadGoogleServices();
  const uploadAccount = useUploadServiceAccount();
  const removePart = useRemoveFirebasePart();
  const [clientError, setClientError] = useState<string[] | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const s = status.data;

  async function onClientFile(file: File) {
    setClientError(null);
    const preview = await previewGoogleServices(file);
    if (!preview.parsed.ok) {
      setClientError(preview.parsed.errors);
      return;
    }
    try {
      await uploadClient.mutateAsync(file);
      toast.success(`google-services.json saved for ${preview.projectId ?? 'the project'}`);
    } catch (e) {
      setClientError([errorMessage(e, 'The file was not saved. Try again.')]);
    }
  }

  async function onAccountFile(file: File) {
    setAccountError(null);
    try {
      await uploadAccount.mutateAsync(file);
      toast.success('Service account saved. It is stored encrypted and never shown again.');
    } catch (e) {
      setAccountError(errorMessage(e, 'The key was not saved. Try again.'));
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Firebase (push notifications)</CardTitle>
          <CardDescription>The Android app reads these options at start-up, so one APK works with any Firebase project.</CardDescription>
        </div>
        {s && (
          <Chip tone={s.pushReady && s.client ? 'green' : 'amber'} dot size="md">
            {s.pushReady && s.client ? 'Push ready' : 'Not configured'}
          </Chip>
        )}
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="fb-client" className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <FileJson aria-hidden className="size-4 text-fg-secondary" />
            <h3 id="fb-client" className="text-sm font-semibold text-fg">
              google-services.json
            </h3>
          </div>
          {status.isPending ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : s?.client ? (
            <dl className="grid grid-cols-2 gap-3">
              <Fact label="Project id">{s.client.projectId}</Fact>
              <Fact label="Sender id">{s.client.messagingSenderId}</Fact>
              <Fact label="App id">
                <span className="font-mono text-xs">{s.client.appId}</span>
              </Fact>
              <Fact label="Package name">
                <span className="inline-flex items-center gap-1">
                  {s.client.packageName === ANDROID_PACKAGE ? <CheckCircle2 aria-hidden className="size-3.5 text-success-text" /> : <CircleAlert aria-hidden className="size-3.5 text-danger-text" />}
                  {s.client.packageName}
                </span>
              </Fact>
              <Fact label="Uploaded">{when(s.clientUploadedAt)}</Fact>
            </dl>
          ) : (
            <p className="text-sm text-muted">
              Not uploaded. Firebase console: Project settings, Your apps, Android app <span className="font-mono text-xs text-fg">{ANDROID_PACKAGE}</span>, download google-services.json.
            </p>
          )}
          {clientError && (
            <ul role="alert" className="flex flex-col gap-1 text-xs text-danger-text">
              {clientError.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <div className="mt-auto flex flex-wrap gap-2">
            <FilePick accept="application/json,.json" label={s?.client ? 'Replace file' : 'Upload file'} onFile={(f) => void onClientFile(f)} loading={uploadClient.isPending} variant={s?.client ? 'secondary' : 'primary'} />
            {s?.client && (
              <Button size="sm" variant="ghost" loading={removePart.isPending && removePart.variables === 'client'} onClick={() => removePart.mutate('client')}>
                <Trash2 aria-hidden />
                Remove
              </Button>
            )}
          </div>
        </section>

        <section aria-labelledby="fb-account" className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <KeyRound aria-hidden className="size-4 text-fg-secondary" />
            <h3 id="fb-account" className="text-sm font-semibold text-fg">
              Service account key
            </h3>
          </div>
          {s?.serviceAccount.configured ? (
            <dl className="grid grid-cols-2 gap-3">
              <Fact label="Status">
                <span className="inline-flex items-center gap-1 text-success-text">
                  <CheckCircle2 aria-hidden className="size-3.5" />
                  Configured
                </span>
              </Fact>
              <Fact label="Project id">{s.serviceAccount.projectId ?? '–'}</Fact>
              <Fact label="Account">{s.serviceAccount.clientEmail ?? '–'}</Fact>
              <Fact label="Key">{s.serviceAccount.privateKeyIdLast4 ? `…${s.serviceAccount.privateKeyIdLast4}` : '–'}</Fact>
              <Fact label="Uploaded">{when(s.serviceAccount.uploadedAt)}</Fact>
            </dl>
          ) : (
            <p className="text-sm text-muted">Not uploaded. Firebase console: Project settings, Service accounts, Generate new private key.</p>
          )}
          <p className="text-xs text-muted-strong">The key is stored encrypted and is never shown again; only its status appears here.</p>
          {s?.projectMatch === false && (
            <p role="alert" className="text-xs text-danger-text">
              The two files belong to different Firebase projects. Upload both from the same project.
            </p>
          )}
          {accountError && (
            <p role="alert" className="text-xs text-danger-text">
              {accountError}
            </p>
          )}
          <div className="mt-auto flex flex-wrap gap-2">
            <FilePick accept="application/json,.json" label={s?.serviceAccount.configured ? 'Replace key' : 'Upload key'} onFile={(f) => void onAccountFile(f)} loading={uploadAccount.isPending} />
            {s?.serviceAccount.configured && (
              <Button size="sm" variant="ghost" loading={removePart.isPending && removePart.variables === 'service_account'} onClick={() => removePart.mutate('service_account')}>
                <Trash2 aria-hidden />
                Remove
              </Button>
            )}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

const RELEASE_COLUMNS: DataColumn[] = [
  { key: 'version', label: 'Version' },
  { key: 'code', label: 'Version code', align: 'right', hideBelow: 'sm' },
  { key: 'size', label: 'Size', align: 'right', hideBelow: 'md' },
  { key: 'notes', label: 'Notes', hideBelow: 'lg' },
  { key: 'uploaded', label: 'Uploaded', hideBelow: 'sm' },
];

function ReleasesCard() {
  const releases = useAndroidReleases();
  const upload = useUploadRelease();
  const [versionName, setVersionName] = useState('');
  const [versionCode, setVersionCode] = useState('');
  const [notes, setNotes] = useState('');
  const [minSupported, setMinSupported] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const rows = releases.data ?? [];
  const status = releases.isPending ? 'loading' : releases.isError ? 'error' : rows.length === 0 ? 'empty' : 'ready';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errs = validateRelease({ versionName, versionCode, notes, file }, rows);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      const r = await upload.mutateAsync({ versionName: versionName.trim(), versionCode: Number(versionCode), notes: notes.trim(), minSupported, file: file! });
      toast.success(`Version ${r.versionName} is now the download in the employee panel`);
      setVersionName('');
      setVersionCode('');
      setNotes('');
      setMinSupported(false);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setErrors({ form: errorMessage(err, 'The APK was not uploaded. Try again.') });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Android app releases</CardTitle>
          <CardDescription>
            The employee panel and the QR code always offer the latest release of <span className="font-mono">{ANDROID_PACKAGE}</span>.
          </CardDescription>
        </div>
        <Smartphone aria-hidden className="size-4 text-fg-secondary" />
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          <FormField label="Version" error={errors.versionName} hint="As shown in the app, e.g. 1.4.0" required>
            <Input value={versionName} onChange={(e) => setVersionName(e.target.value)} placeholder="1.0.0" spellCheck={false} />
          </FormField>
          <FormField label="Version code" error={errors.versionCode} hint="The build number; higher than the last release" required>
            <Input value={versionCode} onChange={(e) => setVersionCode(e.target.value)} inputMode="numeric" placeholder="1" />
          </FormField>
          <FormField label="APK file" error={errors.file} hint="Signed release build, up to 150 MB" required className="md:col-span-2">
            <input
              ref={fileRef}
              type="file"
              accept=".apk,application/vnd.android.package-archive"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="focus-ring block w-full rounded-md border border-input bg-surface text-sm text-fg-secondary file:mr-3 file:h-8 file:cursor-pointer file:border-0 file:border-r file:border-border file:bg-surface-2 file:px-3 file:text-sm file:font-medium file:text-fg"
            />
          </FormField>
          <FormField label="Release notes" error={errors.notes} hint="Shown to employees next to the download" className="md:col-span-2 2xl:col-span-3">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} placeholder="Faster call logging, new Today screen" />
          </FormField>
          <div className="flex items-start gap-2 self-center">
            <input id="min-supported" type="checkbox" checked={minSupported} onChange={(e) => setMinSupported(e.target.checked)} className="focus-ring mt-0.5 size-4 accent-[var(--accent)]" />
            <Label htmlFor="min-supported" className="text-sm text-fg">
              Require this version
              <span className="block text-xs font-normal text-muted">Older apps ask the employee to update before they continue.</span>
            </Label>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          {errors.form && (
            <p role="alert" className="mr-auto text-xs text-danger-text">
              {errors.form}
            </p>
          )}
          {file && !errors.file && <span className="mr-auto text-xs text-muted-strong">{`${file.name}, ${formatBytes(file.size)}`}</span>}
          <Button type="submit" variant="primary" loading={upload.isPending}>
            <Upload aria-hidden />
            Upload release
          </Button>
        </CardFooter>
      </form>
      <div className="border-t border-border p-3">
        <DataTable label="Android releases" columns={RELEASE_COLUMNS} status={status} onRetry={() => void releases.refetch()} empty={{ icon: <Smartphone />, title: 'No releases yet', description: 'Upload the first APK above. Until then the employee panel hides the download card.' }}>
          {rows.map((r, i) => (
            <TableRow key={r.id}>
              <TableCell>
                <span className="flex items-center gap-1.5 font-medium text-fg">
                  {r.versionName}
                  {i === 0 && (
                    <Chip tone="green" dot>
                      Latest
                    </Chip>
                  )}
                  {r.minSupported && <Chip tone="amber">Required</Chip>}
                </span>
              </TableCell>
              <TableCell className={`${columnClass(RELEASE_COLUMNS[1]!)} tabular`}>{r.versionCode}</TableCell>
              <TableCell className={`${columnClass(RELEASE_COLUMNS[2]!)} tabular`}>{formatBytes(r.size)}</TableCell>
              <TableCell className={`${columnClass(RELEASE_COLUMNS[3]!)} max-w-md truncate text-fg-secondary`}>{r.notes ?? '–'}</TableCell>
              <TableCell className={`${columnClass(RELEASE_COLUMNS[4]!)} text-fg-secondary`}>{when(r.createdAt)}</TableCell>
            </TableRow>
          ))}
        </DataTable>
      </div>
    </Card>
  );
}

/** Super Admin > Config (SPEC 29.6): Firebase for push and the Android app releases. */
export function PlatformConfig() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Config" description="Push notifications and the Android employee app for every company." className="mb-1" />
      <div className="grid items-start gap-4 3xl:grid-cols-2">
        <FirebaseCard />
        <ReleasesCard />
      </div>
    </div>
  );
}
