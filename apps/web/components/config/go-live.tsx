'use client';

import type { GoLiveCheck } from '@vistar/shared';
import { CheckCircle2, CircleAlert, RefreshCw, Rocket, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { formatDateTimeIn } from '@/components/common/time';
import { InlineAlert, LoadError } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { useGoLive } from '@/lib/config/platform';
import { cn } from '@/lib/cn';

const TZ = 'Asia/Kolkata';

const ICON = { pass: CheckCircle2, warn: TriangleAlert, fail: CircleAlert } as const;
const ICON_CLASS = { pass: 'text-success-text', warn: 'text-warning-text', fail: 'text-danger-text' } as const;
const STATUS_TEXT = { pass: 'Pass', warn: 'Check', fail: 'Fail' } as const;

/** Config page sections a fix link can point at (`/super-admin/config?group=<key>`, `/super-admin/config/email-templates`): opened in place. */
function configTarget(href: string): string | null {
  try {
    const u = new URL(href, 'http://x');
    if (u.pathname === '/super-admin/config/email-templates') return 'email_templates';
    if (u.pathname === '/super-admin/config/go-live') return 'go_live';
    if (u.pathname !== '/super-admin/config') return null;
    return u.searchParams.get('group') ?? u.searchParams.get('section') ?? (u.hash ? u.hash.slice(1) : null);
  } catch {
    return null;
  }
}

/**
 * Go-live checklist (Super Admin > Config): production checks computed by the API with pass, warn or
 * fail, what was found, and a link to the place that fixes it. Server-side items (env, deploy) say what
 * to change on the server instead of linking.
 */
export function GoLiveChecklistPanel({ onOpenGroup }: { onOpenGroup: (key: string) => void }) {
  const q = useGoLive();
  if (q.isPending)
    return (
      <div role="status" aria-label="Running the checks" className="flex flex-col gap-3">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    );
  if (q.isError || !q.data) return <LoadError title="The go-live checks did not run" onRetry={() => void q.refetch()} />;
  const c = q.data;
  const failing = c.items.filter((i) => i.status === 'fail');
  const order = { fail: 0, warn: 1, pass: 2 } as const;
  const items = [...c.items].sort((a, b) => order[a.status] - order[b.status] || Number(b.blocking) - Number(a.blocking));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>Go-live checklist</CardTitle>
            <CardDescription>{`Checked ${formatDateTimeIn(c.checkedAt, TZ)} on the ${c.environment} server. Fix every failing item before you open sign-ups.`}</CardDescription>
          </div>
          <Button size="sm" onClick={() => void q.refetch()} loading={q.isFetching} aria-label="Run the checks again">
            <RefreshCw aria-hidden />
            Check again
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className={cn('inline-flex size-10 items-center justify-center rounded-full', c.ready ? 'bg-status-green-bg text-status-green-fg' : 'bg-status-amber-bg text-status-amber-fg')}>
              <Rocket aria-hidden className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-base font-semibold text-fg">{c.ready ? 'Ready for production' : 'Not ready yet'}</p>
              <p className="text-sm text-muted-strong tabular">{`${c.passed} of ${c.total} checks pass${failing.length ? `, ${failing.length} failing` : ''}`}</p>
            </div>
            <div className="ml-auto h-2 w-full max-w-xs overflow-hidden rounded-full bg-surface-3 sm:w-48" role="progressbar" aria-label="Checks passing" aria-valuemin={0} aria-valuemax={c.total} aria-valuenow={c.passed}>
              <div className={cn('h-full rounded-full transition-[width] duration-200 ease-standard', c.ready ? 'bg-success' : 'bg-accent')} style={{ width: `${c.total ? Math.round((c.passed / c.total) * 100) : 0}%` }} />
            </div>
          </div>
          {c.environment !== 'production' && (
            <InlineAlert tone="info">This server does not run with NODE_ENV=production, so development defaults and mock providers still count as failures here. Run the checklist again on the production server.</InlineAlert>
          )}
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <p className="text-sm text-muted-strong">No checks came back from the server.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface" aria-label="Checks">
          {items.map((i) => (
            <CheckRow key={i.key} item={i} onOpenGroup={onOpenGroup} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CheckRow({ item: i, onOpenGroup }: { item: GoLiveCheck; onOpenGroup: (key: string) => void }) {
  const Icon = ICON[i.status];
  const target = i.fixHref ? configTarget(i.fixHref) : null;
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', ICON_CLASS[i.status])} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
          {i.label}
          <span className="sr-only">{`: ${STATUS_TEXT[i.status]}`}</span>
          {i.blocking && i.status !== 'pass' && <Chip tone="red">Blocks go-live</Chip>}
        </p>
        <p className="text-sm break-words text-muted-strong">{i.detail}</p>
      </div>
      {i.status !== 'pass' &&
        (target ? (
          <Button size="sm" onClick={() => onOpenGroup(target)}>
            Fix
          </Button>
        ) : i.fixHref ? (
          <Button asChild size="sm">
            <Link href={i.fixHref}>Fix</Link>
          </Button>
        ) : (
          <span className="text-xs text-muted-strong">Change on the server</span>
        ))}
    </li>
  );
}
