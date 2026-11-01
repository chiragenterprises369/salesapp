'use client';

import { stageTone } from '@vistar/shared';
import { mockPipeline, TAGS, WHATSAPP_TEMPLATE_FIXTURES } from '@vistar/shared/fixtures';
import { ImageUp, Route, ScrollText, TextCursorInput } from 'lucide-react';
import { columnClass, DataTable, type DataColumn } from '@/components/common/data-table';
import { EmptyState } from '@/components/common/empty-state';
import { Chip } from '@/components/ui/chip';
import { TableCell, TableRow } from '@/components/ui/table';
import { useMe } from '@/lib/session/session';
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

const STAGE_COLUMNS: DataColumn[] = [
  { key: 'order', label: '#', align: 'right' },
  { key: 'name', label: 'Stage' },
  { key: 'type', label: 'Type' },
  { key: 'probability', label: 'Win probability', align: 'right', hideBelow: 'sm' },
];

export function StagesSettings() {
  const pipeline = mockPipeline();
  return (
    <>
      <div>
        <ViewOnly />
      </div>
      <DataTable label={`${pipeline.name} pipeline stages`} columns={STAGE_COLUMNS} status="ready" empty={{ title: 'No stages' }}>
        {pipeline.stages.map((s) => (
          <TableRow key={s.id}>
            <TableCell className="w-10 text-right text-muted tabular">{s.order + 1}</TableCell>
            <TableCell>
              <Chip tone={stageTone(s)} dot>
                {s.name}
              </Chip>
            </TableCell>
            <TableCell className="text-fg-secondary">{s.type === 'open' ? 'Open' : s.type === 'won' ? 'Won' : 'Lost'}</TableCell>
            <TableCell className={`${columnClass(STAGE_COLUMNS[3]!)} tabular`}>{s.probability === null ? '–' : `${s.probability}%`}</TableCell>
          </TableRow>
        ))}
      </DataTable>
      <p className="text-xs text-muted-strong">Renaming, reordering and adding stages arrives with the pipeline editor. Workflows refer to stages by key, so renaming will not break them.</p>
    </>
  );
}

export function FieldsSettings() {
  return (
    <EmptyState
      icon={<TextCursorInput />}
      title="No custom fields yet"
      description="Custom fields capture details like GST number, product size or delivery city on every lead. Creating them arrives with the field editor."
    />
  );
}

export function TagsSettings() {
  return (
    <SettingsCard title="Tags in use" description="Tags group leads across stages, for example export buyers or tender enquiries.">
      <div className="mb-3">
        <ViewOnly />
      </div>
      <ul className="flex flex-wrap gap-2" aria-label="Tags">
        {TAGS.map((t) => (
          <li key={t}>
            <Chip size="md">{t}</Chip>
          </li>
        ))}
      </ul>
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
  return (
    <>
      <div>
        <ViewOnly />
      </div>
      <DataTable label="WhatsApp templates" columns={TEMPLATE_COLUMNS} status="ready" empty={{ title: 'No templates' }}>
        {WHATSAPP_TEMPLATE_FIXTURES.map((t) => (
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

export function AuditSettings() {
  return (
    <DataTable
      label="Audit log"
      columns={AUDIT_COLUMNS}
      status="empty"
      empty={{
        icon: <ScrollText />,
        title: 'No audit entries to show yet',
        description: 'Role changes, exports, deletions, API keys and support sessions are recorded here once the audit API is connected.',
      }}
    />
  );
}
