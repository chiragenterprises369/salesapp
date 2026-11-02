'use client';

import type { FloorRequestStatus, TeamFloorLayout } from '@vistar/shared';
import { Building2, Check, Clock3, ImageIcon, RefreshCw, Sparkles, XCircle } from 'lucide-react';
import { useState } from 'react';
import { formatDateTimeIn } from '@/components/common/time';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { useMe } from '@/lib/session/session';
import { useTeamFloorLayout } from '../state/layout/published';
import { IMAGE_CATEGORY_LABEL, mockImageUrl, useFloorRequest, useFloorRequests } from './data';
import { FloorRequestForm } from './request-form';

/**
 * PUBLIC API (contract with FLOOR-WORKSPACE, floor-interface-19b.md): the company's custom floor request
 * on the Team Floor page (SPEC 29.5). Company admins (`canManage`, settings.manage) send reference photos
 * and follow the status; everyone else sees the status only ("your office is being prepared").
 */
export interface FloorRequestPanelProps {
  canManage: boolean;
  className?: string;
}

export function FloorRequestPanel({ canManage, className }: FloorRequestPanelProps) {
  const layout = useTeamFloorLayout();
  const requests = useFloorRequests(canManage);
  const [composing, setComposing] = useState(false);
  const tz = useMe()?.workspace.timezone ?? 'Asia/Kolkata';

  if (layout.isPending || (canManage && requests.isPending)) {
    return (
      <div className={cn('flex flex-col gap-2', className)} aria-busy="true" aria-label="Loading your office floor status">
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }
  if (layout.isError || (canManage && requests.isError)) {
    return (
      <Card className={className} role="alert">
        <CardContent className="flex flex-wrap items-center gap-3 pt-4">
          <p className="min-w-0 flex-1 text-sm text-fg">Your office floor status did not load. Check your connection and try again.</p>
          <Button
            size="sm"
            onClick={() => {
              void layout.refetch();
              if (canManage) void requests.refetch();
            }}
          >
            <RefreshCw aria-hidden />
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const latest = canManage ? (requests.data?.[0] ?? null) : null;
  const status = latest ? { id: latest.id, status: latest.status, statusNote: latest.statusNote, submittedAt: latest.submittedAt } : layout.data.request;
  const live = layout.data.floor;

  if (canManage && composing) {
    return (
      <div className={className} data-floor-request="form">
        <FloorRequestForm initial={latest ? { headcount: latest.headcount, notes: latest.notes ?? '' } : undefined} onDone={() => setComposing(false)} onCancel={() => setComposing(false)} />
      </div>
    );
  }

  if (!status) {
    if (live) return <LiveCard className={className} floor={live} tz={tz} canManage={canManage} onNew={() => setComposing(true)} />;
    if (canManage) {
      return (
        <div className={className} data-floor-request="form">
          <FloorRequestForm onDone={() => undefined} />
        </div>
      );
    }
    return (
      <Card className={className} data-floor-request="none">
        <CardContent className="flex items-start gap-3 pt-4">
          <Building2 aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-secondary" />
          <p className="text-sm text-fg-secondary">
            This is the standard office. Your company admin can send photos of your office from this page, and Vistar builds a floor that looks like your space.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (status.status === 'published' && live) return <LiveCard className={className} floor={live} tz={tz} canManage={canManage} onNew={() => setComposing(true)} />;

  return (
    <Card className={className} data-floor-request={status.status}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{TITLE[status.status]}</CardTitle>
          <CardDescription>{DESCRIPTION[status.status]}</CardDescription>
        </div>
        <Chip tone={TONE[status.status]} dot size="md">
          {CHIP[status.status]}
        </Chip>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Timeline status={status.status} submittedAt={status.submittedAt} tz={tz} />
        {status.statusNote && (
          <p className={cn('rounded-md border px-3 py-2 text-sm', status.status === 'rejected' ? 'border-status-red-border bg-status-red-bg text-status-red-fg' : 'border-border bg-surface-2 text-fg-secondary')}>
            <span className="font-medium">Message from Vistar: </span>
            {status.statusNote}
          </p>
        )}
        {canManage && latest && <PhotoStrip requestId={latest.id} count={latest.images.length} headcount={latest.headcount} />}
        {canManage && (status.status === 'rejected' || status.status === 'submitted') && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={status.status === 'rejected' ? 'primary' : 'secondary'} onClick={() => setComposing(true)}>
              <ImageIcon aria-hidden />
              {status.status === 'rejected' ? 'Send new photos' : 'Send more photos'}
            </Button>
          </div>
        )}
        {status.status === 'in_progress' && live === null && (
          <p className="text-xs text-muted-strong">Until it is published your team sees the standard office with live status as usual.</p>
        )}
      </CardContent>
    </Card>
  );
}

const TITLE: Record<FloorRequestStatus, string> = {
  submitted: 'Your photos reached Vistar',
  in_progress: 'Your office is being prepared',
  published: 'Your office floor is live',
  rejected: 'Vistar needs other photos',
};
const DESCRIPTION: Record<FloorRequestStatus, string> = {
  submitted: 'The Vistar team builds a floor from your photos. You get a notification when it is live.',
  in_progress: 'The Vistar team is building the floor from your photos. Your team sees it here as soon as it is published.',
  published: 'Everyone on the Team Floor now sees your own office.',
  rejected: 'The photos were not enough to build your office. Read the message, then send new photos.',
};
const CHIP: Record<FloorRequestStatus, string> = { submitted: 'Received', in_progress: 'In progress', published: 'Live', rejected: 'Needs photos' };
const TONE: Record<FloorRequestStatus, 'blue' | 'amber' | 'green' | 'red'> = { submitted: 'blue', in_progress: 'amber', published: 'green', rejected: 'red' };

function Timeline({ status, submittedAt, tz }: { status: FloorRequestStatus; submittedAt: string; tz: string }) {
  const rejected = status === 'rejected';
  const steps = [
    { key: 'sent', label: 'Photos sent', detail: formatDateTimeIn(submittedAt, tz), state: 'done' as const },
    { key: 'prep', label: rejected ? 'Not built: other photos needed' : 'Being prepared', detail: null, state: rejected ? ('failed' as const) : status === 'in_progress' ? ('current' as const) : status === 'published' ? ('done' as const) : ('next' as const) },
    { key: 'live', label: 'Live on your Team Floor', detail: null, state: status === 'published' ? ('done' as const) : ('next' as const) },
  ];
  return (
    <ol aria-label="Request progress" className="grid gap-2 sm:grid-cols-3">
      {steps.map((s) => (
        <li key={s.key} aria-current={s.state === 'current' ? 'step' : undefined} className="flex items-start gap-2">
          <span
            aria-hidden
            className={cn(
              'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
              s.state === 'done' && 'border-status-green-border bg-status-green-bg text-status-green-fg',
              s.state === 'current' && 'border-status-amber-border bg-status-amber-bg text-status-amber-fg',
              s.state === 'failed' && 'border-status-red-border bg-status-red-bg text-status-red-fg',
              s.state === 'next' && 'border-border-strong bg-surface text-muted',
            )}
          >
            {s.state === 'done' ? <Check className="size-3" /> : s.state === 'failed' ? <XCircle className="size-3" /> : s.state === 'current' ? <Clock3 className="size-3" /> : <span className="size-1.5 rounded-full bg-current" />}
          </span>
          <span className="min-w-0">
            <span className={cn('block text-sm', s.state === 'next' ? 'text-muted-strong' : 'font-medium text-fg')}>{s.label}</span>
            {s.detail && <span className="block text-xs text-muted">{s.detail}</span>}
            <span className="sr-only">{s.state === 'done' ? ', done' : s.state === 'current' ? ', in progress' : s.state === 'failed' ? ', stopped' : ', not yet'}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function PhotoStrip({ requestId, count, headcount }: { requestId: string; count: number; headcount: number }) {
  const detail = useFloorRequest(requestId);
  const images = detail.data?.images ?? [];
  const shown = images.slice(0, 8);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-strong">
        {count} {count === 1 ? 'photo' : 'photos'} · seats for {headcount} {headcount === 1 ? 'person' : 'people'}
      </p>
      {detail.isPending ? (
        <Skeleton className="h-14 w-full max-w-md rounded-md" />
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {shown.map((img) => {
            const src = img.url ?? mockImageUrl(img.fileId);
            return (
              <li key={img.fileId} className="size-14 overflow-hidden rounded-md border border-border bg-surface-2">
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived private URL
                  <img src={src} alt={`${IMAGE_CATEGORY_LABEL[img.category]}${img.caption ? `: ${img.caption}` : ''}`} className="size-full object-cover" loading="lazy" />
                ) : (
                  <span className="flex size-full items-center justify-center text-2xs text-muted">{IMAGE_CATEGORY_LABEL[img.category]}</span>
                )}
              </li>
            );
          })}
          {images.length > shown.length && <li className="flex size-14 items-center justify-center rounded-md border border-border bg-surface-2 text-xs text-muted-strong">+{images.length - shown.length}</li>}
        </ul>
      )}
    </div>
  );
}

function LiveCard({ floor, tz, canManage, onNew, className }: { floor: NonNullable<TeamFloorLayout['floor']>; tz: string; canManage: boolean; onNew: () => void; className?: string }) {
  return (
    <Card className={className} data-floor-request="live">
      <CardContent className="flex flex-wrap items-center gap-3 pt-4">
        <Sparkles aria-hidden className="size-4 shrink-0 text-accent-text" />
        <p className="min-w-0 flex-1 text-sm text-fg">
          Your own office floor is live <span className="text-muted-strong">(version {floor.version}, published {formatDateTimeIn(floor.publishedAt, tz)})</span>.
        </p>
        {canManage && (
          <Button size="sm" variant="ghost" onClick={onNew}>
            <ImageIcon aria-hidden />
            Office changed? Send new photos
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
