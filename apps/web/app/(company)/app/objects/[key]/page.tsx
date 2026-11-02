import type { Metadata } from 'next';
import { RecordsList } from '@/components/customization/records/records-list';

export const metadata: Metadata = { title: 'Records' };

/** Records of a custom object (/app/objects/<key>). Unknown or archived objects show a not-found state. */
export default async function ObjectRecordsPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return (
    <div className="flex w-full min-w-0 flex-col pb-4">
      <RecordsList objectKey={key} />
    </div>
  );
}
