import type { Metadata } from 'next';
import { WorkflowEditor } from './workflow-editor';

export const metadata: Metadata = { title: 'Workflow' };

export default async function WorkflowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, { template }] = await Promise.all([params, searchParams]);
  return <WorkflowEditor id={decodeURIComponent(id)} templateKey={typeof template === 'string' ? template : null} />;
}
