'use client';

import { type PackListItem } from '@vistar/shared';
import { ArrowUpCircle, ChevronDown, History, Lock, Package, ShieldCheck, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { NavIcon } from '@/components/shell/nav-icon';
import { InlineAlert, ListSkeleton, LoadError } from '@/components/settings/common/states';
import { TAP_BUTTON } from '@/components/settings/common/touch';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { useReadOnly } from '@/lib/auth/use-auth';
import { usePacks } from '@/lib/packs';
import { useMe } from '@/lib/session/session';
import { cn } from '@/lib/cn';
import { PackActionDialog, type PackAction } from './pack-action-dialog';
import { PackHistory } from './pack-history';
import { displayStatus, entitlementText, STATUS_CHIP, summaryItems } from './pack-meta';

/** Settings > Industry: packs the company can use, their status, and install / modes / upgrade / uninstall. */
export function IndustrySettings() {
  const q = usePacks();
  const [dialog, setDialog] = useState<{ pack: PackListItem; action: PackAction } | null>(null);

  if (q.isPending) return <ListSkeleton rows={2} label="Loading industry packs" />;
  if (q.isError) return <LoadError title="Industry packs did not load" onRetry={() => void q.refetch()} />;
  if (q.data.length === 0) return <EmptyState icon={<Package />} title="No packs available yet" description="Vistar support can add industry packs to your plan." />;

  // Core first, then active, then the rest.
  const rank = (p: PackListItem) => (p.core ? 0 : displayStatus(p) === 'active' ? 1 : displayStatus(p) === 'locked' ? 3 : 2);
  const packs = [...q.data].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  return (
    <>
      <p className="text-sm text-fg-secondary">
        Packs add fields, objects, pipelines and pages for your industry. They never change data you entered, and uninstalling keeps everything so you can
        come back later.
      </p>
      <ul className="grid gap-4 lg:grid-cols-2" aria-label="Industry packs">
        {packs.map((p) => (
          <li key={p.key} className="min-w-0">
            <PackCard pack={p} onAction={(action) => setDialog({ pack: p, action })} />
          </li>
        ))}
      </ul>
      {dialog && <PackActionDialog key={`${dialog.pack.key}-${dialog.action}`} pack={dialog.pack} action={dialog.action} onClose={() => setDialog(null)} />}
    </>
  );
}

function PackCard({ pack, onAction }: { pack: PackListItem; onAction: (a: PackAction) => void }) {
  const me = useMe()!;
  const { reason } = useReadOnly();
  const [historyOpen, setHistoryOpen] = useState(false);
  const status = displayStatus(pack);
  const chip = STATUS_CHIP[status];
  const items = summaryItems(pack.summary);
  const headingId = `pack-${pack.key}`;
  const historyId = `pack-${pack.key}-history`;
  const enabledModeLabels = pack.modes.filter((m) => pack.enabledModes.includes(m.key)).map((m) => m.label);
  const modeLabel = (key: string) => pack.modes.find((m) => m.key === key)?.label ?? key;
  const canAct = !reason && status !== 'locked';
  const installed = pack.installedVersion !== null;

  return (
    <Card className="flex h-full flex-col" aria-labelledby={headingId} role="article">
      <div className="flex items-start gap-3 px-4 pt-4">
        <span aria-hidden className={cn('flex size-10 shrink-0 items-center justify-center rounded-md', status === 'active' ? 'bg-accent-soft text-accent-soft-fg' : 'bg-surface-3 text-fg-secondary')}>
          <NavIcon name={pack.icon} fallback="Package" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-sm font-semibold text-fg">
            {pack.name}
          </h2>
          <p className="text-xs text-muted">
            {pack.industry} · v{pack.installedVersion ?? pack.latestVersion}
            {pack.upgradeAvailable && <span className="text-accent-text"> · v{pack.latestVersion} available</span>}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Chip tone={chip.tone} dot={status === 'active'}>
            {status === 'locked' && <Lock aria-hidden />}
            {chip.label}
          </Chip>
          {pack.core && <Chip tone="neutral">Always on</Chip>}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-4 py-3">
        <p className="text-sm text-fg-secondary">{pack.description}</p>
        {items.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="What this pack includes">
            {items.map((t) => (
              <li key={t}>
                <Chip tone="neutral">{t}</Chip>
              </li>
            ))}
          </ul>
        )}
        <p className="flex items-center gap-1.5 text-xs text-fg-secondary">
          {status === 'locked' ? <Lock aria-hidden className="size-3.5 shrink-0" /> : <ShieldCheck aria-hidden className="size-3.5 shrink-0 text-success-text" />}
          {entitlementText(pack.entitlement, me.workspace.plan)}
        </p>
        {pack.modes.length > 0 && status === 'active' && (
          <p className="text-xs text-fg-secondary">
            Modes: <span className="font-medium text-fg">{enabledModeLabels.join(', ') || 'none'}</span>
          </p>
        )}
        {status === 'locked' && (
          <InlineAlert tone="info" title={pack.entitlement === 'revoked' ? 'Turned off for your company' : 'Not in your plan'}>
            {pack.entitlement === 'revoked' ? 'Ask Vistar support to turn it back on.' : 'Upgrade your plan or ask Vistar support to turn it on.'}
            {installed && ' Data this pack added is kept and comes back when it is turned on again.'}
          </InlineAlert>
        )}
        {status === 'failed' && <InlineAlert title="The last install did not finish">{pack.lastError ?? 'Try again. Nothing was changed.'}</InlineAlert>}
        {status === 'uninstalled' && !pack.core && <p className="text-xs text-muted">Uninstalled. Its data is archived and comes back when you reinstall.</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        {(status === 'available' || status === 'uninstalled' || status === 'failed') && (
          <Button variant="primary" className={TAP_BUTTON} disabled={!canAct} onClick={() => onAction('install')}>
            {status === 'uninstalled' ? 'Reinstall' : status === 'failed' ? 'Try again' : 'Install'}
          </Button>
        )}
        {status === 'active' && pack.upgradeAvailable && (
          <Button variant="primary" className={TAP_BUTTON} disabled={!canAct} onClick={() => onAction('upgrade')}>
            <ArrowUpCircle aria-hidden />
            Upgrade to {pack.latestVersion}
          </Button>
        )}
        {status === 'active' && pack.modes.length > 0 && (
          <Button className={TAP_BUTTON} disabled={!canAct} onClick={() => onAction('modes')}>
            <SlidersHorizontal aria-hidden />
            Change modes
          </Button>
        )}
        {status === 'active' && !pack.core && (
          <Button variant="ghost" className={TAP_BUTTON} disabled={!canAct} onClick={() => onAction('uninstall')}>
            <Trash2 aria-hidden />
            Uninstall
          </Button>
        )}
        <Button
          variant="ghost"
          className={cn('ml-auto', TAP_BUTTON)}
          aria-expanded={historyOpen}
          aria-controls={historyOpen ? historyId : undefined}
          onClick={() => setHistoryOpen((o) => !o)}
        >
          <History aria-hidden />
          History
          <ChevronDown aria-hidden className={cn('transition-transform duration-150', historyOpen && 'rotate-180')} />
        </Button>
      </div>
      {historyOpen && (
        <div id={historyId} className="border-t border-border px-4 py-2">
          <h3 className="sr-only">Install history of {pack.name}</h3>
          <PackHistory packKey={pack.key} timeZone={me.workspace.timezone} modeLabel={modeLabel} />
        </div>
      )}
      {reason && <p className="px-4 pb-3 text-xs text-muted">{reason}</p>}
    </Card>
  );
}
