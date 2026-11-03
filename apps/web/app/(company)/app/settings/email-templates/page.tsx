import { CompanyEmailTemplates } from '@/components/templates/company-email-templates';
import { SettingsPage } from '@/components/settings/settings-layout';

/** `?key=<template>` opens one template in the editor. */
export default async function EmailTemplatesSettingsPage({ searchParams }: { searchParams: Promise<{ key?: string | string[] }> }) {
  const { key } = await searchParams;
  const initial = (Array.isArray(key) ? key[0] : key) ?? null;
  return (
    <SettingsPage id="settings-email-templates" description="E-mails your team sends to customers: quotations, invoices, payment reminders, follow-ups, meeting invites and the welcome e-mail. Your logo and brand colour are added automatically.">
      <CompanyEmailTemplates key={initial ?? ''} initialKey={initial} />
    </SettingsPage>
  );
}
