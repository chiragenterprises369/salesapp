'use client';

import { packPageHref } from '@vistar/shared';
import { usePathname } from 'next/navigation';
import { RecordDetail } from '@/components/customization/records/record-detail';
import { RecordsList } from '@/components/customization/records/records-list';
import type { PackComponentProps } from '@/lib/packs/ui-index';

const OBJECT_KEY = 'supplier';

/**
 * MOCK-ONLY demo pack page ("demo-suppliers.SuppliersPage"): the generic records list for the
 * `supplier` object, titled by the pack's navigation label. /x/demo-suppliers/suppliers/<id> opens a record.
 */
export default function SuppliersPage({
  packKey,
  page = 'suppliers',
  params = [],
  title,
}: PackComponentProps) {
  const panel = (usePathname() ?? '').startsWith('/me') ? 'employee' : 'company';
  const base = packPageHref(panel, packKey, page);
  const recordId = params[0];
  if (recordId) return <RecordDetail objectKey={OBJECT_KEY} recordId={recordId} basePath={base} />;
  return <RecordsList objectKey={OBJECT_KEY} title={title} basePath={base} />;
}
