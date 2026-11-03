import type { Metadata } from 'next';
import { VerifyEmail } from '@/components/auth/password-reset';

export const metadata: Metadata = { title: 'Confirm your e-mail', referrer: 'no-referrer' };

/** Link from the e-mail verification e-mail (AUTH_LINK_PATHS.emailVerify). */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await searchParams;
  return <VerifyEmail token={typeof token === 'string' && token.length >= 20 ? token : null} />;
}
