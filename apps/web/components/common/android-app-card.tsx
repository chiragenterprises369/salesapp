'use client';

import { Download, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { apiUrl } from '@/lib/branding/http';
import { formatBytes, useLatestAndroidRelease } from '@/lib/branding/platform-config';
import { cn } from '@/lib/cn';
import { QrCode } from './qr/qr-code';
import { formatDateTimeIn } from './time';

const STEPS = [
  'Tap Download on the phone, or scan the code with the phone camera.',
  'When Android asks, allow installs from this browser (Settings, Install unknown apps).',
  'Open the downloaded file and tap Install.',
  'Open Vistar and sign in with your work email.',
];

/**
 * "Get the Android app" (SPEC 29.1): download of the latest release (GET /app/config -> android.latest),
 * a QR code for the same link and install steps. Renders nothing while loading or when no release
 * exists. `audience` changes the wording for the Team page (admins share it with employees).
 */
export function AndroidAppCard({ audience = 'employee', className }: { audience?: 'employee' | 'team'; className?: string }) {
  const latest = useLatestAndroidRelease();
  const r = latest.data;
  if (!r) return null;
  // A phone cannot open a blob: link from this browser; the QR always points at the API download.
  const qrUrl = r.downloadUrl.startsWith('blob:') ? apiUrl('/app/android/latest') : r.downloadUrl;
  return (
    <Card className={cn('overflow-hidden', className)} data-slot="android-app-card">
      <section aria-labelledby="android-app-title" className="flex flex-col gap-4 p-4 md:flex-row md:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-start gap-3">
            <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-fg">
              <Smartphone className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 id="android-app-title" className="text-base font-semibold text-fg">
                Get the Android app
              </h2>
              <p className="text-sm text-muted-strong">
                {audience === 'team'
                  ? 'Share this with your team: calls from their own SIM are logged to the lead, with live status on the Team Floor.'
                  : 'Call from your own SIM with every call logged to the lead, plus tasks, leads and WhatsApp on your phone.'}
              </p>
              <p className="mt-1 text-xs text-muted-strong tabular">
                Version {r.versionName} · {formatBytes(r.size)} · {formatDateTimeIn(r.createdAt, 'Asia/Kolkata')}
              </p>
            </div>
          </div>
          {r.notes && <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-fg-secondary">{r.notes}</p>}
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-fg-secondary">
            {STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="primary" size="touch" className="w-full sm:w-auto">
              <a href={r.downloadUrl} download={`vistar-${r.versionName}.apk`}>
                <Download aria-hidden />
                Download for Android
              </a>
            </Button>
            <span className="text-xs text-muted-strong">Android 8 or newer. iPhone is not supported yet.</span>
          </div>
        </div>
        <figure className="hidden shrink-0 flex-col items-center gap-1.5 sm:flex">
          <QrCode value={qrUrl} label={`QR code to download Vistar ${r.versionName} for Android`} size={148} className="border border-border" />
          <figcaption className="text-xs text-muted-strong">Scan with the phone camera</figcaption>
        </figure>
      </section>
    </Card>
  );
}
