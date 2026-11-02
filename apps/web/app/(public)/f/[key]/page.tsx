import type { Metadata } from 'next';
import { Suspense } from 'react';
import { HostedFormPage } from '@/components/capture/hosted-form';

export const metadata: Metadata = { title: 'Enquiry form', robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return (
    <div className="mx-auto w-full max-w-2xl">
      <Suspense>
        <HostedFormPage formKey={decodeURIComponent(key)} />
      </Suspense>
    </div>
  );
}
