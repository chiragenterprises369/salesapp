import type { Metadata } from 'next';
import { RecordDetail } from '@/components/customization/records/record-detail';

export const metadata: Metadata = { title: 'Record' };

/** One record of a custom object (/app/objects/<key>/<id>). */
export default async function ObjectRecordPage({
  params,
}: {
  params: Promise<{ key: string; id: string }>;
}) {
  const { key, id } = await params;
  return (
    <div className="flex w-full min-w-0 flex-col pb-4">
      <RecordDetail objectKey={key} recordId={id} />
    </div>
  );
}
