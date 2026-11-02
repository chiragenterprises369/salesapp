import type { Metadata } from 'next';
import { SharedDocumentPage } from '@/components/quotations/shared-document';

export const metadata: Metadata = { title: 'Shared document', robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="mx-auto w-full max-w-5xl">
      <SharedDocumentPage token={decodeURIComponent(token)} />
    </div>
  );
}
