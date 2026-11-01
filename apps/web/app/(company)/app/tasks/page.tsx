import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/common/placeholder-page';

export const metadata: Metadata = { title: 'Tasks' };

export default function TasksPage() {
  return (
    <PlaceholderPage
      title="Tasks"
      description="Follow-ups and to-dos for you and your team, sorted by due time."
      icon="ListTodo"
      anyOf={['tasks.read']}
      emptyTitle="No open tasks"
      emptyDescription="Tasks added on a lead, and tasks created by workflows, appear here grouped by due date."
      action={{ label: 'Open leads', href: '/app/leads', anyOf: ['leads.read'] }}
    />
  );
}
