import type { Metadata } from 'next';
import { PageHeader } from '@/components/common/page-header';
import { ProfileForm } from '@/components/settings/profile-form';

export const metadata: Metadata = { title: 'Profile and avatar' };

export default function MyProfilePage() {
  return (
    <>
      <PageHeader title="Profile and avatar" description="How your team sees you on leads, tasks and the Team Floor." />
      <ProfileForm touch />
    </>
  );
}
