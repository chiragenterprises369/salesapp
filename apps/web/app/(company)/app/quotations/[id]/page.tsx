import type { Metadata } from 'next';
import { QuotationDetailPage } from '@/components/quotations/quotation-detail';

export const metadata: Metadata = { title: 'Quotation' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuotationDetailPage id={id} />;
}
