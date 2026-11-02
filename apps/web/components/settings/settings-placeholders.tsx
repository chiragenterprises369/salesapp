'use client';

import { formatNumber, type AuditLog, type ChipTone } from '@vistar/shared';
import { WHATSAPP_TEMPLATE_FIXTURES } from '@vistar/shared/fixtures';
import { ImageUp, Route, ScrollText } from 'lucide-react';
import { useState } from 'react';
import { columnClass, DataTable, type DataColumn } from '@/components/common/data-table';
import { formatDateTimeIn } from '@/components/common/time';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { TableCell, TableRow } from '@/components/ui/table';
import { useMe } from '@/lib/session/session';
import { useAuditLog } from '@/lib/world/hooks';
import { useTags } from '@/lib/api/directory';
import { isMockData } from '@/lib/api/data-source';
import { SettingsCard } from './settings-card';

/**
 * Settings pages whose editors ship later. Each shows the real current values (from fixtures/session)
 * read-only, so admins can check their setup, and says what editing will cover.
 */
function ViewOnly() {
  return <Chip tone="grey">View only for now</Chip>;
}

export function BrandingSettings() {
  const me = useMe()!;
  return (
    <SettingsCard title="Logo and colour" description="Used on the sidebar, emails and the Employee app icon.">
      <div className="mb-3">
        <ViewOnly />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-strong bg-surface-2 px-4 py-8 text-center">
          <ImageUp aria-hidden className="size-5 text-fg-secondary" />
          <p className="text-sm font-medium text-fg">{me.workspace.logoUrl ? 'Logo uploaded' : 'No logo yet'}</p>
          <p className="text-xs text-muted">PNG or SVG, square, up to 1 MB. Uploading arrives with file storage.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-secondary">Accent colour</span>
          <span className="text-sm text-fg">{me.workspace.accentColor ?? 'Vistar indigo (default)'}</span>
          <span className="text-xs text-muted">Custom colours are adjusted automatically so text stays readable in light and dark themes.</span>
        </div>
      </div>
    </SettingsCard>
  );
}

export function TagsSettings() {
  const tags = useTags();
  const list = tags.data ?? [];
  return (
    <SettingsCard title="Tags in use" description="Tags group leads across stages, for example export buyers or tender enquiries.">
      <div className="mb-3">
        <ViewOnly />
      </div>
      {!tags.isPending && list.length === 0 ? (
        <p className="text-sm text-muted-strong">{tags.isError ? 'Tags did not load. Reload the page to try again.' : 'No tags yet. Add a tag to a lead and it shows up here.'}</p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label="Tags">
          {list.map((t) => (
            <li key={t.id}>
              <Chip size="md">{t.name}</Chip>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

const TEMPLATE_COLUMNS: DataColumn[] = [
  { key: 'name', label: 'Template' },
  { key: 'category', label: 'Category' },
  { key: 'status', label: 'Status' },
  { key: 'body', label: 'Message', hideBelow: 'lg' },
];

export function TemplatesSettings() {
  // Approved templates come from WhatsApp Business (GET /templates), which is not connected yet.
  const templates = isMockData() ? WHATSAPP_TEMPLATE_FIXTURES : [];
  return (
    <>
      <div>
        <ViewOnly />
      </div>
      <DataTable label="WhatsApp templates" columns={TEMPLATE_COLUMNS} status={templates.length ? 'ready' : 'empty'} empty={{ title: 'No templates yet' }}>
        {templates.map((t) => (
          <TableRow key={t.name}>
            <TableCell className="font-mono text-xs">{t.name}</TableCell>
            <TableCell className="text-fg-secondary">{t.category === 'marketing' ? 'Marketing' : 'Utility'}</TableCell>
            <TableCell>
              <Chip tone="green" dot>
                Approved
              </Chip>
            </TableCell>
            <TableCell className={`${columnClass(TEMPLATE_COLUMNS[3]!)} max-w-md truncate text-fg-secondary`}>{t.body}</TableCell>
          </TableRow>
        ))}
      </DataTable>
      <p className="text-xs text-muted-strong">Submitting new templates to Meta for approval arrives with the WhatsApp integration.</p>
    </>
  );
}

export function RoutingSettings() {
  return (
    <SettingsCard title="How new leads are assigned" description="Applies to leads from IndiaMART, your website, WhatsApp and webhooks.">
      <div className="mb-3">
        <ViewOnly />
      </div>
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-fg-secondary">
          <Route className="size-4" />
        </span>
        <div>
          <p className="text-sm font-medium text-fg">Round robin among available employees</p>
          <p className="text-xs text-muted">
            Each new lead goes to the next employee whose status is Available, during business hours. Outside hours, leads wait unassigned until the
            team is back.
          </p>
        </div>
      </div>
      <p className="mt-4 text-xs text-muted">Rules by source, city or product, and weighted assignment, arrive with the routing editor.</p>
    </SettingsCard>
  );
}

const AUDIT_COLUMNS: DataColumn[] = [
  { key: 'time', label: 'Time' },
  { key: 'person', label: 'Person' },
  { key: 'action', label: 'Action' },
  { key: 'item', label: 'Item', hideBelow: 'sm' },
  { key: 'ip', label: 'IP address', hideBelow: 'lg' },
];

const AUDIT_ACTION_LABEL: Record<string, string> = {
  'leads.export': 'Exported leads',
  'leads.import': 'Imported leads',
  'leads.bulk_assign': 'Reassigned leads',
  'leads.bulk_delete': 'Deleted leads',
  'lead.delete': 'Deleted a lead',
  'user.role_change': 'Changed a role',
  'user.invite': 'Invited a teammate',
  'user.deactivate': 'Deactivated a user',
  'roles.update': 'Edited role permissions',
  'impersonation.start': 'Support session started',
  'impersonation.end': 'Support session ended',
  'support_access.enable': 'Allowed support access',
  'workflow.pause': 'Paused a workflow',
  'workflow.publish': 'Published a workflow',
  'apikey.create': 'Created an API key',
  'apikey.revoke': 'Revoked an API key',
  'settings.business_hours.update': 'Changed business hours',
  'settings.update': 'Changed a setting',
  'workspace.update': 'Changed workspace defaults',
  'integration.connect': 'Connected an integration',
  'webhook.create': 'Added a webhook',
  'plan.change': 'Plan changed',
  'pipeline.stage.update': 'Edited a pipeline stage',
  'field.create': 'Added a custom field',
  'pack.install': 'Installed a pack',
};

const fromTo = (v: unknown) => {
  const d = v as { from?: unknown; to?: unknown } | null;
  return d && typeof d === 'object' && 'to' in d ? `${String(d.from ?? 'none')} → ${String(d.to)}` : null;
};

/** One readable line from the (PII-masked) diff. */
function auditItem(a: AuditLog): string {
  const d = a.diff ?? {};
  const parts: string[] = [];
  if (typeof d.rows === 'number') parts.push(`${formatNumber(d.rows)} rows${d.format ? ` (${String(d.format).toUpperCase()})` : ''}`);
  if (typeof d.count === 'number') parts.push(`${formatNumber(d.count)} ${d.count === 1 ? 'lead' : 'leads'}`);
  for (const key of ['role', 'plan', 'status', 'probability', 'defaultTheme']) {
    const ft = fromTo(d[key]);
    if (ft) parts.push(ft);
  }
  for (const key of ['name', 'email', 'provider', 'key', 'reason'] as const) if (typeof d[key] === 'string') parts.push(String(d[key]));
  if (typeof d.until === 'string') parts.push(`until ${formatDateTimeIn(d.until, 'Asia/Kolkata')}`);
  return parts.length ? parts.slice(0, 2).join(' · ') : a.entityType.replace(/_/g, ' ');
}

const ACTOR_TONE: Record<AuditLog['actorType'], ChipTone> = { user: 'neutral', super_admin: 'indigo', system: 'grey', api_key: 'blue', workflow: 'grey' };
const ACTOR_LABEL: Record<AuditLog['actorType'], string> = { user: 'Person', super_admin: 'Vistar support', system: 'System', api_key: 'API key', workflow: 'Workflow' };
const PAGE = 25;

export function AuditSettings() {
  const me = useMe()!;
  const [shown, setShown] = useState(PAGE);
  const query = useAuditLog({ limit: 500 });
  const rows = query.data?.items ?? [];
  const status = query.isPending ? 'loading' : query.isError ? 'error' : rows.length === 0 ? 'empty' : 'ready';
  const tz = me.workspace.timezone;
  return (
    <>
      <DataTable
        label="Audit log"
        columns={AUDIT_COLUMNS}
        status={status}
        onRetry={() => void query.refetch()}
        empty={{
          icon: <ScrollText />,
          title: 'No audit entries yet',
          description: 'Role changes, exports, deletions, API keys and support sessions are recorded here as they happen.',
        }}
      >
        {rows.slice(0, shown).map((a) => (
          <TableRow key={a.id}>
            <TableCell className="text-fg-secondary tabular whitespace-nowrap">{formatDateTimeIn(a.createdAt, tz)}</TableCell>
            <TableCell>
              <span className="flex items-center gap-1.5">
                <span className="truncate text-fg">{a.actorName ?? 'System'}</span>
                {a.actorType !== 'user' && <Chip tone={ACTOR_TONE[a.actorType]}>{ACTOR_LABEL[a.actorType]}</Chip>}
              </span>
            </TableCell>
            <TableCell className="font-medium text-fg">{AUDIT_ACTION_LABEL[a.action] ?? a.action}</TableCell>
            <TableCell className={`${columnClass(AUDIT_COLUMNS[3]!)} max-w-sm truncate text-fg-secondary`}>{auditItem(a)}</TableCell>
            <TableCell className={`${columnClass(AUDIT_COLUMNS[4]!)} font-mono text-xs text-muted`}>{a.ip ?? '–'}</TableCell>
          </TableRow>
        ))}
      </DataTable>
      {status === 'ready' && (
        <div className="flex items-center justify-between gap-3 text-xs text-muted-strong">
          <span>
            Showing {Math.min(shown, rows.length)} of {rows.length} entries from the last 45 days. Support sessions by Vistar are always listed here.
          </span>
          {shown < rows.length && (
            <Button size="sm" onClick={() => setShown((n) => n + PAGE)}>
              Show more
            </Button>
          )}
        </div>
      )}
    </>
  );
}
