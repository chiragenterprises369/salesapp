import type { Metadata } from 'next';
import { ConfigPage, type ConfigSearchParams } from '@/components/config/config-page';

export const metadata: Metadata = { title: 'Config' };

/** Super Admin > Config (SPEC 29.6, 30). `?group=<key>` opens a group. */
export default function SuperAdminConfigPage({ searchParams }: { searchParams: ConfigSearchParams }) {
  return <ConfigPage searchParams={searchParams} />;
}
