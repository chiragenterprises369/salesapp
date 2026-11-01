import type { Metadata } from 'next';
import { TasksView } from '@/components/employee/tasks-view';

export const metadata: Metadata = { title: 'Tasks and reminders' };

export default function MyTasksPage() {
  return <TasksView />;
}
