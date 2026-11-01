import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SettingsLayout } from '@/components/settings/settings-layout';

export const metadata: Metadata = { title: { default: 'Settings', template: '%s · Settings · Vistar' } };

export default function CompanySettingsLayout({ children }: { children: ReactNode }) {
  return <SettingsLayout>{children}</SettingsLayout>;
}
