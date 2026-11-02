import type { Metadata } from 'next';
import { PlatformConfig } from '../_components/platform-config';

export const metadata: Metadata = { title: 'Config' };

export default function SuperAdminConfigPage() {
  return <PlatformConfig />;
}
