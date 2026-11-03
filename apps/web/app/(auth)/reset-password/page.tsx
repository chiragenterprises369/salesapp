import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/auth/password-reset';

export const metadata: Metadata = { title: 'Choose a new password', referrer: 'no-referrer' };

/** Link from the password reset e-mail (AUTH_LINK_PATHS.passwordReset). */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await searchParams;
  return <ResetPasswordForm token={typeof token === 'string' && token.length >= 20 ? token : null} />;
}
