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
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col px-4 pt-4 pb-8 md:px-6 md:pt-5">
      <RecordDetail objectKey={key} recordId={id} />
    </div>
  );
}
