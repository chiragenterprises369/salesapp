'use client';

import { CompanyEmailTemplateKeySchema, sampleVariables, type CompanyEmailTemplateKey, type EmailBrand } from '@vistar/shared';
import { Mail } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { columnClass, DataTable, type DataColumn } from '@/components/common/data-table';
import { formatDateTimeIn } from '@/components/common/time';
import { LoadError } from '@/components/settings/common/states';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { TableCell, TableRow } from '@/components/ui/table';
import { API_ORIGIN } from '@/lib/api/config';
import { useReadOnly } from '@/lib/auth/use-auth';
import { brandName, resolveBrandTokens, useBranding } from '@/lib/branding';
import { useEmailTemplate, useEmailTemplateMutations, useEmailTemplates } from '@/lib/config/company';
import { cn } from '@/lib/cn';
import { useCan, useMe } from '@/lib/session/session';
import { EmailTemplateEditor } from './email-template-editor';

const COLUMNS: DataColumn[] = [
  { key: 'template', label: 'Template' },
  { key: 'subject', label: 'Subject', hideBelow: 'lg' },
  { key: 'state', label: 'Version' },
  { key: 'updated', label: 'Changed', hideBelow: 'md' },
];

export const isCompanyTemplateKey = (v: string | null | undefined): v is CompanyEmailTemplateKey => CompanyEmailTemplateKeySchema.safeParse(v).success;

const absolute = (url: string | null | undefined) => {
  if (!url) return null;
  try {
    return new URL(url, API_ORIGIN).toString();
  } catch {
    return null;
  }
};

/** The company's branding for e-mails: name, light logo, contrast-checked brand colour and its text colour. */
function useCompanyEmailBrand(): EmailBrand {
  const me = useMe();
  const draft = useBranding();
  return useMemo(() => {
    const tokens = resolveBrandTokens(draft)?.light;
    const name = brandName(me?.workspace);
    return {
      name,
      logoUrl: absolute(draft.logoLight?.url ?? draft.logoDark?.url),
      brandColor: tokens?.accent ?? null,
      brandTextColor: tokens?.['accent-fg'] ?? null,
      footerLines: [name],
    };
  }, [draft, me?.workspace]);
}

/**
 * Company > Settings > E-mail templates (change #20): quotation, invoice, payment reminder, follow-up,
 * meeting invite and welcome e-mails. Same editor as the platform templates; the preview uses the
 * company branding (logo, brand colour). `?key=<template>` opens one.
 */
export function CompanyEmailTemplates({ initialKey }: { initialKey: string | null }) {
  const [key, setKey] = useState<CompanyEmailTemplateKey | null>(isCompanyTemplateKey(initialKey) ? initialKey : null);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (key) url.searchParams.set('key', key);
    else url.searchParams.delete('key');
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url.href);
  }, [key]);

  if (key) return <CompanyTemplateEditor key={key} templateKey={key} onBack={() => setKey(null)} />;
  return <CompanyTemplateList onOpen={setKey} />;
}

function CompanyTemplateList({ onOpen }: { onOpen: (key: CompanyEmailTemplateKey) => void }) {
  const q = useEmailTemplates();
  const tz = useMe()?.workspace.timezone ?? 'Asia/Kolkata';
  const rows = q.data ?? [];
  const status = q.isPending ? 'loading' : q.isError ? 'error' : rows.length === 0 ? 'empty' : 'ready';
  return (
    <DataTable label="E-mail templates" columns={COLUMNS} status={status} onRetry={() => void q.refetch()} empty={{ icon: <Mail />, title: 'No templates', description: 'The server returned no templates. Reload the page.' }}>
      {rows.map((t) => {
        const key = t.key as CompanyEmailTemplateKey;
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
            <TableCell className={cn(columnClass(COLUMNS[3]!), 'py-2 text-fg-secondary')}>{t.updatedAt ? formatDateTimeIn(t.updatedAt, tz) : '–'}</TableCell>
          </TableRow>
        );
      })}
    </DataTable>
  );
}

function CompanyTemplateEditor({ templateKey, onBack }: { templateKey: CompanyEmailTemplateKey; onBack: () => void }) {
  const q = useEmailTemplate(templateKey);
  const m = useEmailTemplateMutations(templateKey);
  const me = useMe();
  const canManage = useCan('templates.manage');
  const { readOnly, reason } = useReadOnly();
  const brand = useCompanyEmailBrand();
  const sample = useMemo(() => ({ ...sampleVariables('company', templateKey), company: brand.name }), [templateKey, brand.name]);
  const tz = me?.workspace.timezone ?? 'Asia/Kolkata';

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
      scope="company"
      templateKey={t.key}
      label={t.label}
      description={t.description}
      value={{ subject: t.subject, html: t.html }}
      customised={t.isCustom}
      variables={t.variables}
      sample={sample}
      brand={brand}
      fromLine={`${brand.name}${me?.user.email ? ` (replies go to ${me.user.email} when sent by you)` : ''}`}
      lastChange={t.updatedAt ? `Changed ${formatDateTimeIn(t.updatedAt, tz)}${t.updatedBy ? ` by ${t.updatedBy.name}` : ''}` : null}
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
      defaultRecipient={me?.user.email ?? undefined}
      readOnlyReason={readOnly ? reason : canManage ? null : 'Your role can view templates but not change them.'}
      onBack={onBack}
      backLabel="All e-mail templates"
    />
  );
}
