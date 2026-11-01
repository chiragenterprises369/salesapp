import type { Metadata } from 'next';
import { WorkflowsList } from './workflows-list';

export const metadata: Metadata = { title: 'Workflows' };

export default function WorkflowsPage() {
  return <WorkflowsList />;
}
