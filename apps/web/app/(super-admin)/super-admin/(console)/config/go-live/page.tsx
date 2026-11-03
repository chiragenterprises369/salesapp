import type { Metadata } from 'next';
import { ConfigPage, type ConfigSearchParams } from '@/components/config/config-page';

export const metadata: Metadata = { title: 'Go-live checklist' };

/** Super Admin > Config > Go-live checklist. */
export default function SuperAdminGoLivePage({ searchParams }: { searchParams: ConfigSearchParams }) {
  return <ConfigPage searchParams={searchParams} section="go_live" />;
}
