'use client';

import { EMPLOYEE_STATUS_CONTROL, EMPLOYEE_STATUS_LABEL, EMPLOYEE_STATUS_TONE, PRESENCE_TIMEOUT_MS } from '@vistar/shared';
import { Check } from 'lucide-react';
import { RadioGroup } from 'radix-ui';
import { PageHeader } from '@/components/common/page-header';
import { StatusChip } from '@/components/ui/chip';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { useReadOnly } from '@/lib/auth/use-auth';
import { useMyStatus, type SelfStatus } from './status-store';

const HINT: Record<SelfStatus, string> = {
  idle: 'Ready for calls and new leads',
  on_call: 'On a call outside Vistar. Calls made in Vistar set this for you',
  away: 'Lunch or a short break. New leads skip you',
  offline: 'Done for the day',
};

const DOT: Record<string, string> = {
  green: 'bg-status-green-fg',
  blue: 'bg-status-blue-fg',
  amber: 'bg-status-amber-fg',
  grey: 'bg-status-grey-fg',
};

/**
 * Self-service status (EMPLOYEE_STATUS_CONTROL): large radio buttons. Feeds presence on the Team
 * Floor and lead routing. Mock local state; Wave 3: PUT /me/status.
 */
export function StatusControl() {
  const [status, setStatus] = useMyStatus();
  const { reason } = useReadOnly();
  const value = status === 'busy' ? '' : status;

  return (
    <>
      <PageHeader title="My status" description="Tell your team and lead routing whether you can take calls." meta={<StatusChip status={status} size="md" />} />
      <RadioGroup.Root
        value={value}
        disabled={!!reason}
        onValueChange={(v) => {
          setStatus(v as SelfStatus);
          toast.success(`Status set to ${EMPLOYEE_STATUS_LABEL[v as SelfStatus]}`);
        }}
        aria-label="My status"
        className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3 4xl:grid-cols-4"
      >
        {EMPLOYEE_STATUS_CONTROL.map(({ status: s, label }) => (
          <RadioGroup.Item
            key={s}
            value={s}
            className={cn(
              'focus-ring group flex min-h-20 items-center gap-4 rounded-lg border border-border bg-surface p-4 text-left shadow-card',
              'transition-[border-color,background-color] duration-150 ease-standard hover:border-border-strong hover:bg-surface-2',
              'data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            <span aria-hidden className={cn('size-3.5 shrink-0 rounded-full', DOT[EMPLOYEE_STATUS_TONE[s]])} />
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold text-fg group-data-[state=checked]:text-accent-soft-fg">{label}</span>
              <span className="block text-sm text-muted group-data-[state=checked]:text-muted-strong">{HINT[s]}</span>
            </span>
            <RadioGroup.Indicator>
              <Check aria-hidden className="size-5 text-accent-soft-fg" />
            </RadioGroup.Indicator>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      <p className="mt-4 text-sm text-muted-strong">
        {status === 'busy'
          ? 'You are Busy right now: Vistar sets this while you wrap up a call. Pick a status to change it.'
          : `Busy is set for you while you wrap up a call. Offline is set if Vistar is closed for more than ${Math.round(PRESENCE_TIMEOUT_MS / 1000)} seconds.`}
      </p>
    </>
  );
}
