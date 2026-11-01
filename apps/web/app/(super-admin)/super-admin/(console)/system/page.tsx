import type { Metadata } from 'next';
import { SystemSettings } from '../_components/system-settings';

export const metadata: Metadata = { title: 'System settings' };

export default function SuperAdminSystemPage() {
  return <SystemSettings />;
}
