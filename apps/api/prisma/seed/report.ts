/** Row-count table printed at the end of the seed (per model, per seeded company). */
import type { PrismaClient } from '../../src/generated/prisma/client.js';

/** Tenant tables (all carry workspaceId). Constant names only: safe to interpolate into SQL. */
export const TENANT_TABLES = [
  'User', 'Role', 'Team', 'Invite', 'Session', 'Contact', 'Company', 'Lead', 'Deal', 'Pipeline', 'Stage', 'Activity', 'Tag', 'CustomField', 'CustomObject', 'CustomRecord',
  'SavedView', 'File', 'ImportJob', 'Task', 'Call', 'Conversation', 'Message', 'Template', 'QuickReply', 'ConsentRecord', 'Workflow', 'WorkflowVersion', 'WorkflowRun',
  'WorkflowRunStep', 'Integration', 'WebhookEndpoint', 'WebhookDelivery', 'ApiKey', 'Notification', 'PushSubscription', 'AuditLog', 'Target', 'Setting', 'UsageCounter',
  'FeatureFlagOverride', 'ImpersonationSession', 'WorkspacePack', 'PackInstallLog',
  // change #19 wave B
  'Product', 'PriceList', 'Quotation', 'Invoice', 'Payment', 'Meeting', 'TimeOff', 'RoutingRule', 'CaptureForm', 'AttendanceSession', 'LocationPing',
] as const;

export async function countRows(prisma: PrismaClient, companies: Array<{ id: string; label: string }>): Promise<Map<string, Map<string, number>>> {
  const ids = companies.map((c) => c.id);
  const out = new Map<string, Map<string, number>>();
  for (const table of TENANT_TABLES) {
    const rows = await prisma.$queryRawUnsafe<Array<{ w: string; n: bigint }>>(
      `SELECT "workspaceId"::text AS w, COUNT(*) AS n FROM "${table}" WHERE "workspaceId" = ANY($1::uuid[]) GROUP BY 1`,
      ids,
    );
    out.set(table, new Map(rows.map((r) => [r.w, Number(r.n)])));
  }
  return out;
}

export function formatTable(counts: Map<string, Map<string, number>>, companies: Array<{ id: string; label: string }>, platform: Array<[string, number]>): string {
  const header = ['Model', ...companies.map((c) => c.label), 'Total'];
  const lines: string[][] = [header];
  for (const [table, byWs] of counts) {
    const vals = companies.map((c) => byWs.get(c.id) ?? 0);
    lines.push([table, ...vals.map(String), String(vals.reduce((a, b) => a + b, 0))]);
  }
  for (const [name, n] of platform) lines.push([name, ...companies.map(() => '-'), String(n)]);
  const widths = header.map((_, i) => Math.max(...lines.map((l) => l[i]!.length)));
  const fmt = (l: string[]) => `| ${l.map((v, i) => (i === 0 ? v.padEnd(widths[i]!) : v.padStart(widths[i]!))).join(' | ')} |`;
  return [fmt(lines[0]!), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...lines.slice(1).map(fmt)].join('\n');
}
