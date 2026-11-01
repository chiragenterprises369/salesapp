import type { Metadata } from 'next';
import { ContentLibrary } from '../_components/content-library';

export const metadata: Metadata = { title: 'Content' };

export default function SuperAdminContentPage() {
  return <ContentLibrary />;
}
