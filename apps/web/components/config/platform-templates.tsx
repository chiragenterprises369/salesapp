'use client';

import { PlatformEmailTemplateKeySchema, sampleVariables, type ConfigRegistry, type EmailBrand, type PlatformEmailTemplateKey } from '@vistar/shared';
import { Mail } from 'lucide-react';
import { useMemo } from 'react';
import { columnClass, DataTable, type DataColumn } from '@/components/common/data-table';
import { formatDateTimeIn } from '@/components/common/time';
import { LoadError } from '@/components/settings/common/states';
import { EmailTemplateEditor } from '@/components/templates/email-template-editor';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { TableCell, TableRow } from '@/components/ui/table';
import { useConfigRegistry, useSuperEmailTemplate, useSuperEmailTemplateMutations, useSuperEmailTemplates } from '@/lib/config/platform';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session/session';

const TZ = 'Asia/Kolkata';

const COLUMNS: DataColumn[] = [
  { key: 'template', label: 'Template' },
  { key: 'subject', label: 'Subject', hideBelow: 'lg' },
  { key: 'state', label: 'Version' },
  { key: 'updated', label: 'Changed', hideBelow: 'md' },
];

export const isPlatformTemplateKey = (v: string | null | undefined): v is PlatformEmailTemplateKey => PlatformEmailTemplateKeySchema.safeParse(v).success;

/** Platform branding and sender from the registry (product name, footer, legal links; from name and address). */
export function usePlatformBrand(registry: ConfigRegistry | undefined): { brand: EmailBrand; fromLine: string } {
  return useMemo(() => {
    const field = (group: string, key: string) => {
      const v = registry?.groups.find((g) => g.key === group)?.fields.find((f) => f.key === key)?.value;
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    };
    const name = field('branding', 'productName') ?? 'Vistar';
    const footer = field('branding', 'emailFooter');
    const support = field('branding', 'supportEmail');
    const links = [
      { label: 'Terms', url: field('branding', 'termsUrl') },
      { label: 'Privacy', url: field('branding', 'privacyUrl') },
    ].filter((l): l is { label: string; url: string } => !!l.url);
    const fromName = field('email', 'fromName') ?? name;
    const fromEmail = field('email', 'fromEmail');
    return {
      brand: { name, footerLines: [footer, support ? `Questions? Write to ${support}` : null].filter((x): x is string => !!x), links },
      fromLine: fromEmail ? `${fromName} <${fromEmail}>` : `${fromName} (sender not set: Platform email)`,
    };
  }, [registry]);
}

/** Platform e-mail templates: list, then the editor for one key. */
export function PlatformTemplates({ templateKey, onOpen }: { templateKey: PlatformEmailTemplateKey | null; onOpen: (key: PlatformEmailTemplateKey | null) => void }) {
  if (templateKey) return <PlatformTemplateEditor key={templateKey} templateKey={templateKey} onBack={() => onOpen(null)} />;
  return <PlatformTemplateList onOpen={onOpen} />;
}

function PlatformTemplateList({ onOpen }: { onOpen: (key: PlatformEmailTemplateKey) => void }) {
  const q = useSuperEmailTemplates();
  const rows = q.data ?? [];
  const status = q.isPending ? 'loading' : q.isError ? 'error' : rows.length === 0 ? 'empty' : 'ready';
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold text-fg">Platform e-mail templates</h2>
        <p className="text-sm text-muted-strong">E-mails Vistar sends to people in every company: invites, password resets, verification, billing and alerts. Each starts from a default you can edit and reset.</p>
      </div>
      <DataTable label="Platform e-mail templates" columns={COLUMNS} status={status} onRetry={() => void q.refetch()} empty={{ icon: <Mail />, title: 'No templates', description: 'The server returned no templates. Check that the API is up to date.' }}>
        {rows.map((t) => {
          const key = t.key as PlatformEmailTemplateKey;
          return (
            <TableRow key={t.key} className="cursor-pointer" onClick={() => onOpen(key)}>
              <TableCell className="max-w-md py-2">
                <button
                  type="button"
                  className="focus-ring rounded-sm text-left font-medium text-fg hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(key);
                  }}
                >
                  {t.label}
                </button>
                <span className="block truncate text-xs text-muted">{t.description}</span>
              </TableCell>
              <TableCell className={cn(columnClass(COLUMNS[1]!), 'max-w-sm truncate py-2 text-fg-secondary')}>{t.subject}</TableCell>
              <TableCell className="py-2">{t.isCustom ? <Chip tone="indigo">Customised</Chip> : <Chip>Default</Chip>}</TableCell>
              <TableCell className={cn(columnClass(COLUMNS[3]!), 'py-2 text-fg-secondary')}>{t.updatedAt ? formatDateTimeIn(t.updatedAt, TZ) : '–'}</TableCell>
            </TableRow>
          );
        })}
      </DataTable>
    </div>
  );
}

function PlatformTemplateEditor({ templateKey, onBack }: { templateKey: PlatformEmailTemplateKey; onBack: () => void }) {
  const q = useSuperEmailTemplate(templateKey);
  const registry = useConfigRegistry();
  const m = useSuperEmailTemplateMutations(templateKey);
  const { brand, fromLine } = usePlatformBrand(registry.data);
  const session = useSession();
  const adminEmail = session?.audience === 'platform' ? session.admin.email : undefined;
  const sample = useMemo(() => sampleVariables('platform', templateKey), [templateKey]);

  if (q.isPending)
    return (
      <div role="status" aria-label="Loading the template" className="flex flex-col gap-3">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 2xl:grid-cols-2">
          <Skeleton className="h-[520px] w-full rounded-lg" />
          <Skeleton className="h-[520px] w-full rounded-lg" />
        </div>
      </div>
    );
  if (q.isError || !q.data) return <LoadError title="The template did not load" onRetry={() => void q.refetch()} />;
  const t = q.data;
  return (
    <EmailTemplateEditor
      key={`${t.key}:${t.updatedAt ?? 'default'}`}
      scope="platform"
      templateKey={t.key}
      label={t.label}
      description={t.description}
      value={{ subject: t.subject, html: t.html }}
      customised={t.isCustom}
      variables={t.variables}
      sample={sample}
      brand={brand}
      fromLine={fromLine}
      lastChange={t.updatedAt ? `Changed ${formatDateTimeIn(t.updatedAt, TZ)}${t.updatedBy ? ` by ${t.updatedBy.name}` : ''}` : null}
      onSave={async (d) => {
        const r = await m.save.mutateAsync(d);
        return { subject: r.subject, html: r.html };
      }}
      onReset={async () => {
        const r = await m.reset.mutateAsync();
        return { subject: r.subject, html: r.html };
      }}
      onTestSend={async ({ to, subject, html }) => {
        const r = await m.test.mutateAsync({ to, subject, html });
        return { ok: r.ok, message: r.message };
      }}
      saving={m.save.isPending}
      resetting={m.reset.isPending}
      testing={m.test.isPending}
      defaultRecipient={adminEmail}
      onBack={onBack}
      backLabel="All platform templates"
    />
  );
}
