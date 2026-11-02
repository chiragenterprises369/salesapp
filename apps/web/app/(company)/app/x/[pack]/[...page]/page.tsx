import type { Metadata } from 'next';
import { PackPage } from '@/lib/packs';

export const metadata: Metadata = { title: 'Vistar' };

/**
 * Pack page host (/app/x/<packKey>/<page...>), SPEC 22.4. The runtime decides what renders: the pack's
 * registered component, "Not available yet", or a neutral state when the pack is not active.
 */
export default async function CompanyPackPage({
  params,
}: {
  params: Promise<{ pack: string; page: string[] }>;
}) {
  const { pack, page } = await params;
  return (
    <div className="flex w-full min-w-0 flex-col pb-4">
      <PackPage packKey={pack} segments={page} panel="company" />
    </div>
  );
}
