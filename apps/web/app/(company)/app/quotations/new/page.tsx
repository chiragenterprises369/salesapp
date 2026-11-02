import type { Metadata } from 'next';
import { NewDocumentPage } from '@/components/quotations/new-document-page';

export const metadata: Metadata = { title: 'New quotation' };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

export default async function Page({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  return <NewDocumentPage kind="quotation" seed={{ accountId: one(sp.accountId), contactId: one(sp.contactId), dealId: one(sp.dealId), leadId: one(sp.leadId) }} />;
}
