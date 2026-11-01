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
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col px-4 pt-4 pb-8 md:px-6 md:pt-5">
      <PackPage packKey={pack} segments={page} panel="company" />
    </div>
  );
}
