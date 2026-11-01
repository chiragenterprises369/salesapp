'use client';

import { defaultModes, type PackListItem, type PackPlanResponse } from '@vistar/shared';
import { Archive, ArrowLeft, PenLine, Plus, RotateCcw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { CheckboxRow } from '@/components/settings/common/checkbox';
import { errorCode, errorMessage, InlineAlert } from '@/components/settings/common/states';
import { TAP_BUTTON } from '@/components/settings/common/touch';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { useInstallPack, usePackPlan, useUninstallPack, useUpgradePack } from '@/lib/packs';
import { cn } from '@/lib/cn';
import { changeGroup, type ChangeGroup } from './pack-meta';

export type PackAction = 'install' | 'modes' | 'upgrade' | 'uninstall';

const GROUPS: ReadonlyArray<{ group: ChangeGroup; title: string; icon: ReactNode; mark: string }> = [
  { group: 'add', title: 'Adds', icon: <Plus aria-hidden />, mark: 'text-success-text' },
  { group: 'restore', title: 'Brings back', icon: <RotateCcw aria-hidden />, mark: 'text-success-text' },
  { group: 'update', title: 'Updates', icon: <PenLine aria-hidden />, mark: 'text-accent-text' },
  { group: 'archive', title: 'Archives (data is kept)', icon: <Archive aria-hidden />, mark: 'text-warning-text' },
];

const ERROR_TITLE: Record<string, string> = {
  PACK_NOT_ENTITLED: 'Your plan does not include this pack',
  PACK_CORE_LOCKED: 'This pack is always on',
  VALIDATION_FAILED: 'Check the modes',
};

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

function initialModes(pack: PackListItem, action: PackAction): string[] {
  if (action === 'modes' || (pack.status === 'uninstalled' && pack.enabledModes.length)) return [...pack.enabledModes];
  return pack.modes.length ? defaultModes(pack) : [];
}

function Preview({ plan }: { plan: PackPlanResponse }) {
  if (plan.noop && plan.conflicts.length === 0) {
    return <InlineAlert tone="info" title="Nothing to change">Your workspace already matches this pack. Confirming only records the step in the history.</InlineAlert>;
  }
  return (
    <div className="flex flex-col gap-3">
      {GROUPS.map(({ group, title, icon, mark }) => {
        const items = plan.changes.filter((c) => changeGroup(c.op) === group);
        if (!items.length) return null;
        return (
          <section key={group} aria-label={`${title}: ${items.length}`}>
            <h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-fg-secondary">
              <span className={cn('inline-flex [&_svg]:size-3.5', mark)}>{icon}</span>
              {title}
              <span className="font-normal text-muted tabular">{items.length}</span>
            </h4>
            <ul className="divide-y divide-border rounded-md border border-border bg-surface-2">
              {items.map((c, i) => (
                <li key={`${c.op}-${i}`} className="px-3 py-1.5 text-sm text-fg">
                  {c.label}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {plan.conflicts.length > 0 && (
        <InlineAlert tone="warning" title={`${plan.conflicts.length} ${plan.conflicts.length === 1 ? 'item is' : 'items are'} skipped`}>
          <p className="mb-1">Your own changes win. These items stay as they are:</p>
          <ul className="list-disc pl-4">
            {plan.conflicts.map((c) => (
              <li key={`${c.kind}-${c.key}`}>
                {c.kind} <code className="font-mono text-xs">{c.key}</code>: {c.reason}
              </li>
            ))}
          </ul>
        </InlineAlert>
      )}
    </div>
  );
}

/**
 * Install / change modes / upgrade / uninstall with a dry-run preview first (usePackPlan writes
 * nothing). Packs with modes start with the mode step; everything else opens on the preview.
 */
export function PackActionDialog({ pack, action, onClose }: { pack: PackListItem; action: PackAction; onClose: () => void }) {
  const hasModes = pack.modes.length > 0 && (action === 'install' || action === 'modes');
  const [step, setStep] = useState<'modes' | 'review'>(hasModes ? 'modes' : 'review');
  const [modes, setModes] = useState<string[]>(() => initialModes(pack, action));
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null);
  const planAction = action === 'modes' ? 'install' : action;
  const plan = usePackPlan(step === 'review' ? pack.key : null, planAction, hasModes ? modes : undefined);
  const install = useInstallPack();
  const upgrade = useUpgradePack();
  const uninstall = useUninstallPack();
  const busy = install.isPending || upgrade.isPending || uninstall.isPending;
  const reinstall = action === 'install' && pack.status === 'uninstalled';
  const unchangedModes = action === 'modes' && sameSet(modes, pack.enabledModes);

  const title = {
    install: reinstall ? `Reinstall ${pack.name}` : `Install ${pack.name}`,
    modes: `Change modes of ${pack.name}`,
    upgrade: `Upgrade ${pack.name} to ${pack.latestVersion}`,
    uninstall: `Uninstall ${pack.name}?`,
  }[action];
  const confirmLabel = { install: reinstall ? 'Reinstall pack' : 'Install pack', modes: 'Apply modes', upgrade: 'Upgrade pack', uninstall: 'Uninstall pack' }[action];

  async function confirm() {
    setError(null);
    try {
      const result =
        action === 'upgrade'
          ? await upgrade.mutateAsync(pack.key)
          : action === 'uninstall'
            ? await uninstall.mutateAsync(pack.key)
            : await install.mutateAsync({ key: pack.key, body: hasModes ? { modes } : {} });
      const skipped = result.conflicts.length ? ` ${result.conflicts.length} of your own changes were kept.` : '';
      const message = {
        install: reinstall ? `${pack.name} reinstalled` : `${pack.name} installed`,
        modes: `Modes updated for ${pack.name}`,
        upgrade: `${pack.name} upgraded to ${pack.latestVersion}`,
        uninstall: `${pack.name} uninstalled`,
      }[action];
      toast.success(message, { description: ((action === 'uninstall' ? 'Your data is kept. Reinstall to bring it back.' : '') + skipped).trim() || undefined });
      onClose();
    } catch (e) {
      setError({ code: errorCode(e), message: errorMessage(e) });
    }
  }

  const modeLabels = pack.modes.filter((m) => modes.includes(m.key)).map((m) => m.label);
  const description =
    step === 'modes'
      ? 'Choose what this pack sets up. You can change modes later.'
      : action === 'uninstall'
        ? 'Check what changes before you confirm. Nothing is deleted.'
        : `Check what changes before you confirm.${hasModes ? ` Modes: ${modeLabels.join(', ')}.` : ''}`;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          {hasModes && (
            <p className="pt-1 text-xs text-muted">
              Step {step === 'modes' ? 1 : 2} of 2
            </p>
          )}
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-3">
            {error && <InlineAlert title={(error.code && ERROR_TITLE[error.code]) || 'Pack not changed'}>{error.message}</InlineAlert>}
            {step === 'modes' ? (
              <fieldset>
                <legend className="mb-1 text-xs font-medium text-fg-secondary">Modes</legend>
                <div className="flex flex-col gap-1">
                  {pack.modes.map((m) => (
                    <CheckboxRow
                      key={m.key}
                      checked={modes.includes(m.key)}
                      onCheckedChange={(on) => setModes((all) => (on ? [...all, m.key] : all.filter((x) => x !== m.key)))}
                      label={
                        <>
                          {m.label}
                          {m.default && <span className="ml-1.5 text-xs text-muted">(recommended)</span>}
                        </>
                      }
                      hint={m.description}
                    />
                  ))}
                </div>
                {modes.length === 0 && <p className="mt-2 text-xs text-danger-text">Choose at least one mode.</p>}
              </fieldset>
            ) : (
              <>
                {action === 'uninstall' && (
                  <InlineAlert tone="info" title="Your data is kept">
                    Objects, fields and pipelines from this pack are archived, not deleted. Records, field values and leads stay. Reinstall the pack to bring
                    everything back.
                  </InlineAlert>
                )}
                {unchangedModes && <InlineAlert tone="info">These are the modes already in use. Pick different modes to see changes.</InlineAlert>}
                {plan.isPending ? (
                  <div aria-busy="true" className="flex flex-col gap-2">
                    <span role="status" className="sr-only">
                      Preparing the preview
                    </span>
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                ) : plan.isError ? (
                  <InlineAlert title={(errorCode(plan.error) && ERROR_TITLE[errorCode(plan.error)!]) || 'Preview did not load'}>
                    {errorMessage(plan.error)}
                    <div className="mt-2">
                      <Button size="sm" onClick={() => void plan.refetch()}>
                        Try again
                      </Button>
                    </div>
                  </InlineAlert>
                ) : (
                  <Preview plan={plan.data} />
                )}
              </>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          {step === 'review' && hasModes ? (
            <Button className={cn('sm:mr-auto', TAP_BUTTON)} variant="ghost" onClick={() => setStep('modes')} disabled={busy}>
              <ArrowLeft aria-hidden />
              Back to modes
            </Button>
          ) : null}
          <Button className={TAP_BUTTON} onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {step === 'modes' ? (
            <Button variant="primary" className={TAP_BUTTON} onClick={() => setStep('review')} disabled={modes.length === 0}>
              Review changes
            </Button>
          ) : (
            <Button
              variant={action === 'uninstall' ? 'danger' : 'primary'}
              className={TAP_BUTTON}
              onClick={confirm}
              loading={busy}
              disabled={!plan.isSuccess || unchangedModes}
            >
              {confirmLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
