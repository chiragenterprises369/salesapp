import { SettingsPage } from '@/components/settings/settings-layout';
import { WhatsAppTemplates } from '@/components/templates/whatsapp-templates';

/** `?id=<template id>` opens one template, `?id=new` a new one. */
export default async function WhatsAppTemplatesSettingsPage({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  const { id } = await searchParams;
  const initial = (Array.isArray(id) ? id[0] : id) ?? null;
  return (
    <SettingsPage id="settings-whatsapp-templates" description="Approved WhatsApp templates are the only messages you can send outside the 24-hour window. Create them here, submit them to Meta and sync their status.">
      <WhatsAppTemplates key={initial ?? ''} initialId={initial} />
    </SettingsPage>
  );
}
