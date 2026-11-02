import type { Metadata } from 'next';
import { InvoiceDetailPage } from '@/components/invoices/invoice-detail';

export const metadata: Metadata = { title: 'Invoice' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoiceDetailPage id={id} />;
}
