'use client';

import type { Company, SetupItem } from '@vistar/shared';
import { CheckCircle2, Circle, CircleDashed, ListChecks } from 'lucide-react';
import { SetupProgress } from '@/components/setup/setup-checklist';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { useCompanySetup } from '@/lib/config/company-detail';

const ICON = { done: CheckCircle2, in_progress: CircleDashed, todo: Circle, not_applicable: Circle } as const;
const TONE = { done: 'text-success-text', in_progress: 'text-warning-text', todo: 'text-muted', not_applicable: 'text-muted' } as const;
const SHOWN = 5;

/**
 * The company's setup progress (change #20, GET /api/super/companies/{id}/setup): the same checklist the company
 * admin sees in Settings, Setup, read-only here. Shows the required steps still open first.
 */
export function CompanySetupCard({ company: c }: { company: Company }) {
  const q = useCompanySetup(c.id);
  if (q.data === null) return null; // mock data mode: no per-company checklist
  const data = q.data;
  const open = data ? data.items.filter((i) => !i.optional && (i.status === 'todo' || i.status === 'in_progress')) : [];
  const done = data ? data.items.filter((i) => !i.optional && i.status === 'done') : [];
  const list: SetupItem[] = [...open, ...done].slice(0, SHOWN);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Setup</CardTitle>
          <CardDescription>{data ? (data.complete ? 'Every required step is done.' : `${data.done} of ${data.total} required steps done.`) : 'What the company has set up so far.'}</CardDescription>
        </div>
        <ListChecks aria-hidden className="size-4 text-fg-secondary" />
      </CardHeader>
      <CardContent>
        {q.isPending ? (
          <div role="status" aria-label="Loading the setup progress" className="flex flex-col gap-2">
            <Skeleton className="h-3 w-full rounded-full" />
            <Skeleton className="h-24 w-full rounded-md" />
          </div>
        ) : q.isError || !data ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-strong">The setup progress did not load.</p>
            <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <SetupProgress percent={data.percent} done={data.done} total={data.total} />
            <ul className="flex flex-col gap-1.5" aria-label="Required setup steps">
              {list.map((i) => {
                const Icon = ICON[i.status];
                return (
                  <li key={i.key} className="flex min-w-0 items-center gap-2 text-sm">
                    <Icon aria-hidden className={cn('size-4 shrink-0', TONE[i.status])} />
                    <span className={cn('truncate', i.status === 'done' ? 'text-muted-strong' : 'text-fg')}>{i.label}</span>
                    <span className="sr-only">{i.status === 'done' ? 'done' : i.status === 'in_progress' ? 'in progress' : 'to do'}</span>
                  </li>
                );
              })}
            </ul>
            {open.length > SHOWN && <p className="text-xs text-muted-strong">{`${open.length - SHOWN} more open steps`}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
