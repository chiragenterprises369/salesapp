'use client';

import { packPageHref } from '@vistar/shared';
import { ArrowRight, Truck } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useRecords } from '@/lib/customization';
import { usePackRuntime } from '@/lib/packs/hooks';
import type { PackComponentProps } from '@/lib/packs/ui-index';

/** MOCK-ONLY demo pack widget ("demo-suppliers.SupplierCount", slot dashboard.side): supplier count + link. */
export default function SupplierCount({ packKey, title = 'Suppliers' }: PackComponentProps) {
  const q = useRecords('supplier', { limit: 1 });
  const rt = usePackRuntime();
  const page =
    rt.data?.navigation.find(
      (n) => n.packKey === packKey && n.component === `${packKey}.SuppliersPage`,
    )?.page ?? 'suppliers';
  const total = q.data?.total;
  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          <CardDescription>Suppliers your team works with</CardDescription>
        </div>
        <span
          aria-hidden
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-soft-fg"
        >
          <Truck className="size-4" />
        </span>
      </CardHeader>
      <CardContent className="flex items-end justify-between gap-3">
        {q.isPending ? (
          <Skeleton className="h-8 w-16" />
        ) : q.isError ? (
          <p className="text-sm text-muted">Count did not load.</p>
        ) : (
          <p className="tabular text-2xl font-semibold text-fg">
            {(total ?? q.data.items.length).toLocaleString('en-IN')}
            <span className="sr-only"> suppliers</span>
          </p>
        )}
        <Link
          href={packPageHref('company', packKey, page)}
          className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium text-accent-text hover:underline sm:min-h-0"
        >
          Open suppliers
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </CardContent>
    </Card>
  );
}
