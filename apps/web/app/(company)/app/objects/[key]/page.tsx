import type { Metadata } from 'next';
import { RecordsList } from '@/components/customization/records/records-list';

export const metadata: Metadata = { title: 'Records' };

/** Records of a custom object (/app/objects/<key>). Unknown or archived objects show a not-found state. */
export default async function ObjectRecordsPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col px-4 pt-4 pb-8 md:px-6 md:pt-5">
      <RecordsList objectKey={key} />
    </div>
  );
}
