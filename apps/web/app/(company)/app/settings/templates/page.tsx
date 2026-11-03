import { redirect } from 'next/navigation';

/** Change #20: WhatsApp templates (Meta status, create, submit, sync) replaced the read-only Templates page. */
export default function TemplatesSettingsPage() {
  redirect('/app/settings/whatsapp-templates');
}
