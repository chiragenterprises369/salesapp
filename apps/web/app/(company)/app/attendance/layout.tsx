import type { ReactNode } from 'react';
import { AttendanceShell } from '@/components/attendance/attendance-shell';

export default function AttendanceLayout({ children }: { children: ReactNode }) {
  return <AttendanceShell>{children}</AttendanceShell>;
}
