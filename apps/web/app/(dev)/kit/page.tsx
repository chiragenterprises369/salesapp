import type { Metadata } from 'next';
import { KitShowcase } from '@/components/ui/kit-showcase';

export const metadata: Metadata = { title: 'UI kit' };

export default function KitPage() {
  return <KitShowcase />;
}
