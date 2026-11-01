'use client';

import type { PackInstallLog } from '@vistar/shared';
import { formatDateTimeIn } from '@/components/common/time';
import { LoadError } from '@/components/settings/common/states';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { usePackLog } from '@/lib/packs';
import { describeSummary } from './pack-meta';

const ACTION_LABEL: Record<PackInstallLog['action'], string> = { install: 'Installed', upgrade: 'Upgraded', uninstall: 'Uninstalled', sync: 'Synced by Vistar' };
const STATUS_CHIP: Record<PackInstallLog['status'], { label: string; tone: 'green' | 'grey' | 'red' }> = {
  success: { label: 'Done', tone: 'green' },
  noop: { label: 'No changes', tone: 'grey' },
  failed: { label: 'Failed', tone: 'red' },
};

/** Install history of one pack (PackInstallLog), newest first. */
export function PackHistory({ packKey, timeZone, modeLabel }: { packKey: string; timeZone: string; modeLabel: (key: string) => string }) {
  const q = usePackLog(packKey);
  if (q.isPending)
    return (
      <div aria-busy="true" className="flex flex-col gap-2 py-2">
        <span role="status" className="sr-only">
          Loading history
        </span>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-36" />
      </div>
    );
  if (q.isError) return <LoadError title="History did not load" onRetry={() => void q.refetch()} />;
  if (q.data.length === 0) return <p className="py-2 text-sm text-muted">No installs or changes recorded in this workspace yet.</p>;
  return (
    <ol className="flex flex-col divide-y divide-border">
      {q.data.map((l) => {
        const versions = l.fromVersion && l.toVersion && l.fromVersion !== l.toVersion ? `${l.fromVersion} to ${l.toVersion}` : (l.toVersion ?? l.fromVersion ?? '');
        return (
          <li key={l.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:gap-3">
            <time dateTime={l.createdAt} className="w-28 shrink-0 text-xs text-muted tabular">
              {formatDateTimeIn(l.createdAt, timeZone)}
            </time>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1.5 text-sm text-fg">
                <span className="font-medium">{ACTION_LABEL[l.action]}</span>
                {versions && <span className="text-xs text-muted">v{versions}</span>}
                <Chip tone={STATUS_CHIP[l.status].tone}>{STATUS_CHIP[l.status].label}</Chip>
              </p>
              <p className="text-xs text-muted">
                {describeSummary(l.summary)}
                {l.conflicts.length > 0 && `, ${l.conflicts.length} kept as you changed them`}
                {l.modes.length > 0 && ` · Modes: ${l.modes.map(modeLabel).join(', ')}`}
                {l.actorName && ` · by ${l.actorName}`}
              </p>
              {l.error && <p className="text-xs text-danger-text">{l.error}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
