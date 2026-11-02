import type { Metadata } from 'next';
import { PageHeader } from '@/components/common/page-header';
import { PersonalPreferences } from '@/components/settings/personal-preferences';
import { ProfileForm } from '@/components/settings/profile-form';

export const metadata: Metadata = { title: 'Profile and preferences' };

/** Company panel: your own profile, avatar and personal preferences (theme, motion, notifications). */
export default function CompanyProfilePage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Profile and preferences" description="Your details, Team Floor avatar and how Vistar looks and notifies you." className="mb-1" />
      <ProfileForm />
      <PersonalPreferences />
    </div>
  );
}
