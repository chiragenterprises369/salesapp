'use client';

import type { ConfigAuditEntry, ConfigFieldState, ConfigGroupKey } from '@vistar/shared';
import { History } from 'lucide-react';
import { formatDateTimeIn } from '@/components/common/time';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useConfigGroupAudit } from '@/lib/config/platform';

const TZ = 'Asia/Kolkata';

function actionText(e: ConfigAuditEntry): string {
  const a = e.action;
  if (a.endsWith('.test')) return 'Ran the test';
  if (a.endsWith('.reset')) return 'Cleared the panel values';
  if (a.endsWith('.update')) return 'Changed values';
  if (a.includes('firebase')) return 'Changed the Firebase files';
  if (a.includes('razorpay')) return 'Changed Razorpay';
  if (a.includes('android_release')) return 'Changed Android releases';
  if (a.includes('billing.profile')) return 'Changed the billing profile';
  return a;
}

/** Who changed which fields of a config group, and when (never values). */
export function GroupAudit({ group, fields = [] }: { group: ConfigGroupKey; fields?: readonly ConfigFieldState[] }) {
  const q = useConfigGroupAudit(group);
  const label = (k: string) => fields.find((f) => f.key === k)?.label ?? k;
  const items = q.data ?? [];
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Changes</CardTitle>
          <CardDescription>Newest first. Values are never logged, only which fields changed.</CardDescription>
        </div>
        <History aria-hidden className="size-4 text-fg-secondary" />
      </CardHeader>
      <CardContent>
        {q.isPending ? (
          <div className="flex flex-col gap-2" role="status" aria-label="Loading changes">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : q.isError ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-strong">
            The changes did not load.
            <Button size="sm" onClick={() => void q.refetch()}>
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-strong">No changes yet. Saving, clearing or testing this group adds an entry here and to the platform audit log.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-border">
            {items.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2 text-sm first:pt-0 last:pb-0">
                <span className="font-medium text-fg">{actionText(e)}</span>
                {e.ok !== null && <Chip tone={e.ok ? 'green' : 'red'}>{e.ok ? 'Passed' : 'Failed'}</Chip>}
                <span className="text-muted-strong">
                  {e.adminName ?? 'System'} · {formatDateTimeIn(e.at, TZ)}
                  {e.ip ? ` · ${e.ip}` : ''}
                </span>
                {(e.changed.length > 0 || e.cleared.length > 0) && (
                  <span className="w-full text-xs text-muted-strong">
                    {e.changed.length > 0 && `Set: ${e.changed.map(label).join(', ')}`}
                    {e.changed.length > 0 && e.cleared.length > 0 && ' · '}
                    {e.cleared.length > 0 && `Cleared: ${e.cleared.map(label).join(', ')}`}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
