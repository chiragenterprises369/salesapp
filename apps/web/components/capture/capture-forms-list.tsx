'use client';

import { ClipboardList, Code, Copy, ExternalLink, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/common/empty-state';
import { useNow } from '@/components/common/use-now';
import { SettingsCard } from '@/components/settings/settings-card';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { useCaptureForms } from '@/lib/crm/automation';
import { ago } from '@/lib/crm/format';
import { useCrmRealtime } from '@/lib/crm/realtime';

export async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error('Copy did not work in this browser. Select the text and copy it.');
  }
}

/** Settings > Lead capture forms: list with hosted link and embed snippet, and the entry to the builder. */
export function CaptureFormsList() {
  useCrmRealtime();
  const now = useNow(60_000);
  const q = useCaptureForms();
  const forms = q.data?.items ?? [];
  return (
    <SettingsCard
      title="Forms"
      description="Put a form on your website (embed snippet) or share its hosted page. Every submission creates a lead with source Website and runs lead routing."
      footer={
        <Button variant="primary" asChild>
          <Link href="/app/settings/lead-capture/new">
            <Plus aria-hidden />
            New form
          </Link>
        </Button>
      }
    >
      {q.isPending ? (
        <div role="status" aria-label="Loading forms" className="flex flex-col gap-2">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-md" />
          ))}
        </div>
      ) : q.isError ? (
        <EmptyState size="sm" title="Forms did not load" description="Check your connection, then try again." action={<Button onClick={() => void q.refetch()}>Try again</Button>} />
      ) : forms.length === 0 ? (
        <EmptyState size="sm" icon={<ClipboardList />} title="No capture forms yet" description="Create an enquiry form in a minute. Visitors who fill it become leads straight away." />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {forms.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold text-fg">
                  <Link href={`/app/settings/lead-capture/${f.id}`} className="focus-ring rounded-sm hover:underline">
                    {f.name}
                  </Link>
                  {f.status === 'active' ? <Chip tone="green">Live</Chip> : <Chip tone="grey">Paused</Chip>}
                </p>
                <p className="text-xs text-muted-strong">
                  {f.fields.length} {f.fields.length === 1 ? 'field' : 'fields'} · {f.submissionCount} {f.submissionCount === 1 ? 'submission' : 'submissions'}
                  {f.lastSubmissionAt ? `, last ${ago(f.lastSubmissionAt, now)}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => void copyText(f.hostedUrl, 'Form link')}>
                  <Copy aria-hidden />
                  Copy link
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void copyText(f.embedHtml, 'Embed snippet')}>
                  <Code aria-hidden />
                  Copy embed
                </Button>
                <Button size="icon-sm" variant="ghost" asChild aria-label={`Open the hosted page of ${f.name}`}>
                  <a href={f.hostedUrl} target="_blank" rel="noreferrer">
                    <ExternalLink aria-hidden />
                  </a>
                </Button>
                <Button size="sm" asChild>
                  <Link href={`/app/settings/lead-capture/${f.id}`}>
                    <Pencil aria-hidden />
                    Edit
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
