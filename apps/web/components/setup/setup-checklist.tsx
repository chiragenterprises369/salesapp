'use client';

import type { SetupItem } from '@vistar/shared';
import { ArrowRight, CheckCircle2, Circle, CircleDashed, MinusCircle } from 'lucide-react';
import Link from 'next/link';
import { CheckboxRow } from '@/components/settings/common/checkbox';
import { LoadError } from '@/components/settings/common/states';
import { SettingsCard } from '@/components/settings/settings-card';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { useReadOnly } from '@/lib/auth/use-auth';
import { useSetupChecklist, useSetupMutations } from '@/lib/config/company';
import { formErrorMessage } from '@/lib/crm/ui/errors';
import { cn } from '@/lib/cn';

const STATUS = {
  done: { icon: CheckCircle2, cls: 'text-success-text', label: 'Done' },
  in_progress: { icon: CircleDashed, cls: 'text-warning-text', label: 'In progress' },
  todo: { icon: Circle, cls: 'text-muted', label: 'To do' },
  not_applicable: { icon: MinusCircle, cls: 'text-muted', label: 'Not needed' },
} as const;

export function SetupProgress({ percent, done, total, className }: { percent: number; done: number; total: number; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      <div className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent}%, ${done} of ${total} steps done`}>
        <div className={cn('h-full rounded-full transition-[width] duration-200 ease-standard', percent >= 100 ? 'bg-success' : 'bg-accent')} style={{ width: `${percent}%` }} />
      </div>
      <span className="shrink-0 text-sm font-semibold text-fg tabular">{`${percent}%`}</span>
    </div>
  );
}

/**
 * Company > Settings > Setup (change #20, SPEC 30): everything the company should configure, computed by
 * the API from the workspace (branding, GST, hours, team, roles, integrations, templates, routing,
 * capture forms, API keys and webhooks, office markers and floor, Android app), each with its status and
 * a link to the page that fixes it. Items that cannot be detected can be ticked by hand.
 */
export function SetupChecklistPage() {
  const q = useSetupChecklist();
  const m = useSetupMutations();
  const { readOnly, reason } = useReadOnly();

  if (q.isPending)
    return (
      <div role="status" aria-label="Loading the setup checklist" className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    );
  if (q.isError || !q.data) return <LoadError title="The setup checklist did not load" onRetry={() => void q.refetch()} />;

  const c = q.data;
  const required = c.items.filter((i) => !i.optional);
  const optional = c.items.filter((i) => i.optional);
  const next = required.find((i) => i.status === 'todo' || i.status === 'in_progress');

  const ack = (item: SetupItem, acknowledged: boolean) =>
    m.acknowledge.mutate(
      { key: item.key, acknowledged },
      {
        onSuccess: () => toast.success(acknowledged ? `${item.label}: marked as done` : `${item.label}: marked as to do`),
        onError: (e) => toast.error(formErrorMessage(e, 'The checklist was not updated. Try again.')),
      },
    );

  return (
    <>
      <SettingsCard title={c.complete ? 'Setup complete' : 'Your progress'} description={c.complete ? 'Everything required is in place. Optional steps below add more.' : `${c.done} of ${c.total} required steps done.`}>
        <div className="flex flex-col gap-3">
          <SetupProgress percent={c.percent} done={c.done} total={c.total} />
          <div className="flex flex-wrap items-center gap-2">
            {next && (
              <Button asChild variant="primary" size="sm">
                <Link href={next.href}>
                  {`Next: ${next.label}`}
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            )}
            {c.bannerDismissed && !c.complete && (
              <Button
                size="sm"
                variant="ghost"
                loading={m.banner.isPending}
                disabled={readOnly}
                onClick={() => m.banner.mutate(false, { onSuccess: () => toast.success('The setup banner shows on the dashboard again'), onError: (e) => toast.error(formErrorMessage(e)) })}
              >
                Show the banner on the dashboard
              </Button>
            )}
          </div>
        </div>
      </SettingsCard>

      <ChecklistSection title="Required" description="These decide whether your team can work from day one." items={required} onAck={ack} pendingKey={m.acknowledge.isPending ? m.acknowledge.variables?.key : undefined} readOnlyReason={readOnly ? reason : null} />
      {optional.length > 0 && <ChecklistSection title="Optional" description="Useful once the basics run. They do not count towards the percentage." items={optional} onAck={ack} pendingKey={m.acknowledge.isPending ? m.acknowledge.variables?.key : undefined} readOnlyReason={readOnly ? reason : null} />}
    </>
  );
}

function ChecklistSection({
  title,
  description,
  items,
  onAck,
  pendingKey,
  readOnlyReason,
}: {
  title: string;
  description: string;
  items: SetupItem[];
  onAck: (item: SetupItem, acknowledged: boolean) => void;
  pendingKey?: string;
  readOnlyReason: string | null;
}) {
  return (
    <SettingsCard title={title} description={description}>
      {items.length === 0 ? (
        <p className="text-sm text-muted-strong">Nothing here.</p>
      ) : (
        <ul className="-my-1 flex flex-col divide-y divide-border">
          {items.map((i) => {
            const s = STATUS[i.status];
            const Icon = s.icon;
            return (
              <li key={i.key} className="flex flex-wrap items-start gap-3 py-3">
                <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', s.cls)} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                    {i.label}
                    <span className="sr-only">{`: ${s.label}`}</span>
                    {i.status === 'in_progress' && <Chip tone="amber">In progress</Chip>}
                    {i.status === 'not_applicable' && <Chip tone="grey">Not needed</Chip>}
                  </p>
                  <p className="text-sm text-muted-strong">{i.description}</p>
                  {i.detail && <p className="mt-0.5 text-xs text-muted-strong">{i.detail}</p>}
                  {i.acknowledgeable && (
                    <CheckboxRow className="mt-1" checked={i.acknowledged} disabled={!!readOnlyReason || pendingKey === i.key} onCheckedChange={(v) => onAck(i, v)} label="I have done this" />
                  )}
                </div>
                {i.status !== 'done' && i.status !== 'not_applicable' ? (
                  <Button asChild size="sm" variant={i.status === 'todo' ? 'secondary' : 'ghost'}>
                    <Link href={i.href}>{i.actionLabel}</Link>
                  </Button>
                ) : (
                  <Button asChild size="sm" variant="ghost">
                    <Link href={i.href} aria-label={`Open ${i.label}`}>
                      Open
                    </Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SettingsCard>
  );
}
