import type { Metadata } from 'next';
import { PackPage } from '@/lib/packs';

export const metadata: Metadata = { title: 'Vistar' };

/** Pack page host for the Employee panel (/me/x/<packKey>/<page...>), SPEC 22.4. */
export default async function EmployeePackPage({
  params,
}: {
  params: Promise<{ pack: string; page: string[] }>;
}) {
  const { pack, page } = await params;
  return (
    <div className="flex w-full min-w-0 flex-col px-4 pt-4 pb-6">
      <PackPage packKey={pack} segments={page} panel="employee" />
    </div>
  );
}
