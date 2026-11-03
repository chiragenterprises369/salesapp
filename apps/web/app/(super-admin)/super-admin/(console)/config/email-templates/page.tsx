import type { Metadata } from 'next';
import { ConfigPage, type ConfigSearchParams } from '@/components/config/config-page';

export const metadata: Metadata = { title: 'Platform e-mail templates' };

/** Super Admin > Config > E-mail templates. `?template=<key>` opens one in the editor. */
export default function SuperAdminEmailTemplatesPage({ searchParams }: { searchParams: ConfigSearchParams }) {
  return <ConfigPage searchParams={searchParams} section="email_templates" />;
}
