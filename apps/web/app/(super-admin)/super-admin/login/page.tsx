import type { Metadata } from 'next';
import { AuthFrame } from '@/components/auth/auth-frame';
import { SuperLoginFlow } from '@/components/auth/super-login-flow';
import { Chip } from '@/components/ui/chip';

export const metadata: Metadata = { title: 'Super Admin sign-in', robots: { index: false } };

/** Public: outside the guarded (console) group. */
export default async function SuperAdminLoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { next, reason } = await searchParams;
  return (
    <AuthFrame badge={<Chip tone="indigo">Platform</Chip>}>
      <SuperLoginFlow next={typeof next === 'string' ? next : null} reason={typeof reason === 'string' ? reason : null} />
    </AuthFrame>
  );
}
