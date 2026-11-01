import type { Metadata } from 'next';
import { PageHeader } from '@/components/common/page-header';
import { PersonalPreferences } from '@/components/settings/personal-preferences';

export const metadata: Metadata = { title: 'Notifications and theme' };

export default function MyPreferencesPage() {
  return (
    <>
      <PageHeader title="Notifications and theme" description="Changes save as you make them." />
      <PersonalPreferences touch />
    </>
  );
}
