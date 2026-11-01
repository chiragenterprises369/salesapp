'use client';

import { NODE_CATALOG, WORKFLOW_TEMPLATES } from '@vistar/shared';
import { WHATSAPP_TEMPLATE_FIXTURES } from '@vistar/shared/fixtures';
import { DataTable, columnClass, type DataColumn } from '@/components/common/data-table';
import { PageHeader } from '@/components/common/page-header';
import { Chip } from '@/components/ui/chip';
import { TableCell, TableRow } from '@/components/ui/table';

const WORKFLOW_COLUMNS: DataColumn[] = [
  { key: 'name', label: 'Workflow template' },
  { key: 'trigger', label: 'Trigger' },
  { key: 'steps', label: 'Steps', align: 'right' },
  { key: 'description', label: 'What it does', hideBelow: 'lg' },
];

const WHATSAPP_COLUMNS: DataColumn[] = [
  { key: 'name', label: 'WhatsApp template' },
  { key: 'category', label: 'Category' },
  { key: 'body', label: 'Message', hideBelow: 'md' },
];

/** Shipped content library: the shared workflow templates and the WhatsApp templates they use. Editing arrives in Phase 9. */
export function ContentLibrary() {
  return (
    <div className="flex max-w-7xl flex-col gap-4">
      <PageHeader title="Content" description="Templates shipped to every company. Editing and publishing new versions arrive in Phase 9." className="mb-1" />
      <DataTable label="Workflow templates" columns={WORKFLOW_COLUMNS} status="ready" empty={{ title: 'No templates' }}>
        {WORKFLOW_TEMPLATES.map((t) => {
          const trigger = t.graph.nodes.find((n) => n.type.startsWith('trigger.'));
          return (
            <TableRow key={t.key}>
              <TableCell className="font-medium">{t.name}</TableCell>
              <TableCell className="text-fg-secondary">{trigger ? NODE_CATALOG[trigger.type].label : 'None'}</TableCell>
              <TableCell className="text-right tabular">{t.graph.nodes.length}</TableCell>
              <TableCell className={`${columnClass(WORKFLOW_COLUMNS[3]!)} max-w-md truncate text-fg-secondary`}>{t.description}</TableCell>
            </TableRow>
          );
        })}
      </DataTable>
      <DataTable label="WhatsApp templates" columns={WHATSAPP_COLUMNS} status="ready" empty={{ title: 'No templates' }}>
        {WHATSAPP_TEMPLATE_FIXTURES.map((t) => (
          <TableRow key={t.name}>
            <TableCell className="font-mono text-xs">{t.name}</TableCell>
            <TableCell>
              <Chip tone={t.category === 'marketing' ? 'amber' : 'blue'}>{t.category === 'marketing' ? 'Marketing' : 'Utility'}</Chip>
            </TableCell>
            <TableCell className={`${columnClass(WHATSAPP_COLUMNS[2]!)} max-w-xl truncate text-fg-secondary`}>{t.body}</TableCell>
          </TableRow>
        ))}
      </DataTable>
    </div>
  );
}
