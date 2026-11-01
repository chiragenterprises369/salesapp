'use client';

import { BUILTIN_PACK_MANIFESTS } from '@vistar/shared';
import { Package } from 'lucide-react';
import { Chip } from '@/components/ui/chip';
import { DEMO_PACK_MANIFEST } from '@/lib/packs';

const PACK_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  [...Object.values(BUILTIN_PACK_MANIFESTS), DEMO_PACK_MANIFEST].map((m) => [m.key, m.name]),
);

/** Display name of a pack by key (known manifests), else a readable version of the key. */
export function packName(key: string): string {
  return PACK_NAMES[key] ?? key.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

/** "From Generic Sales" badge for items a pack created. */
export function PackBadge({ packKey }: { packKey: string }) {
  return (
    <Chip tone="neutral" title={`Added by the ${packName(packKey)} pack`}>
      <Package aria-hidden />
      From {packName(packKey)}
    </Chip>
  );
}
