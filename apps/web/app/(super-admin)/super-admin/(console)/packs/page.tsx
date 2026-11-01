import type { Metadata } from 'next';
import { PacksRegistry } from '@/components/packs/registry/packs-registry';

export const metadata: Metadata = { title: 'Industry packs' };

export default function SuperAdminPacksPage() {
  return <PacksRegistry />;
}
