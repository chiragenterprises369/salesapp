'use client';

import type { PackCompanyUsage, SuperPack } from '@vistar/shared';
import { useState, type FormEvent } from 'react';
import { columnClass, DataTable, type DataColumn } from '@/components/common/data-table';
import { PLAN_LABELS } from '@/components/packs/industry/pack-meta';
import { errorMessage, InlineAlert } from '@/components/settings/common/states';
import { TAP_BUTTON } from '@/components/settings/common/touch';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Textarea } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { fieldErrorMap } from '@/lib/customization';
import { usePackUsage, useSetPackCompany } from '@/lib/packs';
import { ENTITLEMENT_CHIP, OVERRIDE_COPY, USAGE_STATUS_CHIP, type OverrideAction } from './registry-meta';

const COLUMNS: DataColumn[] = [
  { key: 'company', label: 'Company' },
  { key: 'plan', label: 'Plan', hideBelow: 'sm' },
  { key: 'access', label: 'Access' },
  { key: 'status', label: 'Status', hideBelow: 'md' },
  { key: 'version', label: 'Version', hideBelow: 'lg' },
  { key: 'records', label: 'Records', align: 'right', hideBelow: 'lg' },
  { key: 'actions', label: 'Actions', align: 'right' },
];

function actionsFor(c: PackCompanyUsage): OverrideAction[] {
  if (c.override === 'grant') return ['revoke', 'follow'];
  if (c.override === 'revoke') return ['grant', 'follow'];
  return c.entitlement === 'plan' ? ['revoke'] : ['grant', 'revoke'];
}

/** Usage per company with Grant / Revoke / Follow plan (reason required, audited). */
export function CompanyUsage({ pack }: { pack: SuperPack }) {
  const q = usePackUsage(pack.key);
  const [pending, setPending] = useState<{ company: PackCompanyUsage; action: OverrideAction } | null>(null);
  const status = q.isPending ? 'loading' : q.isError ? 'error' : q.data.companies.length === 0 ? 'empty' : 'ready';

  return (
    <section aria-labelledby={`usage-${pack.key}`} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id={`usage-${pack.key}`} className="text-sm font-semibold text-fg">
            Companies
          </h3>
          <p className="text-xs text-muted-strong">Who can use {pack.name}, who installed it, and how many records it holds.</p>
        </div>
        {q.data && (
          <dl className="flex gap-4 text-xs">
            {[
              ['Can use', q.data.totals.entitled],
              ['Active', q.data.totals.active],
              ['Records', q.data.totals.records],
            ].map(([label, n]) => (
              <div key={label} className="flex items-baseline gap-1.5">
                <dt className="text-muted-strong">{label}</dt>
                <dd className="text-sm font-semibold text-fg tabular">{n}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <DataTable label={`Companies using ${pack.name}`} columns={COLUMNS} status={status} onRetry={() => void q.refetch()} empty={{ title: 'No companies yet' }} skeletonRows={4}>
        {q.data?.companies.map((c) => {
          const ent = ENTITLEMENT_CHIP[c.entitlement];
          const st = USAGE_STATUS_CHIP[c.status];
          return (
            <TableRow key={c.workspaceId}>
              <TableCell className="max-w-48 truncate font-medium">{c.name}</TableCell>
              <TableCell className={columnClass(COLUMNS[1]!)}>{PLAN_LABELS[c.plan]}</TableCell>
              <TableCell>
                <Chip tone={ent.tone}>{ent.label}</Chip>
              </TableCell>
              <TableCell className={columnClass(COLUMNS[3]!)}>
                <Chip tone={st.tone} dot={c.status === 'active'}>
                  {st.label}
                </Chip>
              </TableCell>
              <TableCell className={`${columnClass(COLUMNS[4]!)} text-fg-secondary tabular`}>{c.installedVersion ?? '–'}</TableCell>
              <TableCell className={`${columnClass(COLUMNS[5]!)} tabular`}>{c.recordCount}</TableCell>
              <TableCell className="text-right">
                {pack.core ? (
                  <span className="text-xs text-muted">Always on</span>
                ) : (
                  <span className="inline-flex flex-wrap justify-end gap-1">
                    {actionsFor(c).map((a) => (
                      <Button key={a} size="sm" variant={a === 'revoke' ? 'ghost' : 'secondary'} className={TAP_BUTTON} onClick={() => setPending({ company: c, action: a })} aria-label={`${OVERRIDE_COPY[a].button} ${pack.name} for ${c.name}`}>
                        {OVERRIDE_COPY[a].button}
                      </Button>
                    ))}
                  </span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </DataTable>
      {pending && <OverrideDialog key={`${pending.company.workspaceId}-${pending.action}`} pack={pack} company={pending.company} action={pending.action} onClose={() => setPending(null)} />}
    </section>
  );
}

function OverrideDialog({ pack, company, action, onClose }: { pack: SuperPack; company: PackCompanyUsage; action: OverrideAction; onClose: () => void }) {
  const setCompany = useSetPackCompany();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const copy = OVERRIDE_COPY[action];

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (reason.trim().length < 5) {
      setError('Give a reason of at least 5 characters');
      return;
    }
    setError(null);
    try {
      await setCompany.mutateAsync({ key: pack.key, workspaceId: company.workspaceId, body: { override: action === 'follow' ? null : action, reason: reason.trim() } });
      toast.success(copy.done(pack.name, company.name));
      onClose();
    } catch (err) {
      const map = fieldErrorMap(err);
      if (map.reason) setError(map.reason);
      setFormError(errorMessage(err));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{copy.title(pack.name, company.name)}</DialogTitle>
            <DialogDescription>{copy.body}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-3">
              {formError && <InlineAlert>{formError}</InlineAlert>}
              <FormField label="Reason" required error={error ?? undefined} hint="Saved in the platform and company audit logs. At least 5 characters.">
                <Textarea value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} autoFocus />
              </FormField>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button className={TAP_BUTTON} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={action === 'revoke' ? 'danger' : 'primary'} className={TAP_BUTTON} loading={setCompany.isPending}>
              {copy.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
