import { Injectable, Logger } from '@nestjs/common';
import { API_ROUTES } from '@vistar/shared';
import ExcelJS from 'exceljs';
import type { Request, Response } from 'express';
import Papa from 'papaparse';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { AuthContext } from '../../../common/auth/auth-context.js';
import { ScopeService } from '../../../common/auth/scope.service.js';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import { parseCustomFields, type LeadListRow } from '../lead.mapper.js';
import { buildLeadWhere } from '../lead-query.js';
import { LeadsService } from '../leads.service.js';
import { requestActor } from '../lib/context.js';

export const LeadExportQuerySchema = API_ROUTES.leadExport.query;
export type LeadExportQuery = z.output<typeof LeadExportQuerySchema>;

const BATCH = 1000;
type Cell = string | number | Date | null;

/** Spreadsheet formula injection guard for CSV: prefix risky leading characters (phones and numbers stay as they are). */
function csvSafe(v: Cell): string {
  if (v === null) return '';
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d[\d\s.]*$/.test(s)) return `'${s}`;
  return s;
}

@Injectable()
export class LeadExportService {
  private readonly logger = new Logger(LeadExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly leads: LeadsService,
  ) {}

  /** Streams every lead matching the filters + data scope as CSV or XLSX, in batches of 1000. */
  async export(auth: AuthContext, req: Request, res: Response, query: LeadExportQuery, raw: Record<string, unknown>): Promise<void> {
    const q = await this.leads.resolveView(auth, query, raw, LeadExportQuerySchema);
    const db = this.prisma.forTenant(auth.workspaceId);
    const base = await buildLeadWhere(auth, this.scope, q);
    const [stages, users, customFields, actor] = await Promise.all([
      db.stage.findMany({ select: { id: true, name: true } }),
      db.user.findMany({ select: { id: true, name: true, email: true } }),
      db.customField.findMany({ where: { entity: 'lead' }, orderBy: { order: 'asc' }, select: { key: true, label: true } }),
      requestActor(db, auth),
    ]);
    const stageName = new Map(stages.map((s) => [s.id, s.name]));
    const userById = new Map(users.map((u) => [u.id, u]));

    const columns: Array<{ header: string; width: number; value: (l: LeadListRow) => Cell }> = [
      { header: 'Id', width: 38, value: (l) => l.id },
      { header: 'Name', width: 24, value: (l) => l.name },
      { header: 'Company', width: 24, value: (l) => l.companyName },
      { header: 'Phone', width: 16, value: (l) => l.phone },
      { header: 'Email', width: 28, value: (l) => l.email },
      { header: 'City', width: 14, value: (l) => l.city },
      { header: 'State', width: 14, value: (l) => l.state },
      { header: 'Source', width: 12, value: (l) => l.source },
      { header: 'Source ref', width: 16, value: (l) => l.sourceRef },
      { header: 'Product', width: 20, value: (l) => l.productInterest },
      { header: 'Requirement', width: 40, value: (l) => l.requirement },
      { header: 'Stage', width: 14, value: (l) => stageName.get(l.stageId) ?? null },
      { header: 'Owner', width: 18, value: (l) => (l.ownerId ? (userById.get(l.ownerId)?.name ?? null) : null) },
      { header: 'Owner email', width: 26, value: (l) => (l.ownerId ? (userById.get(l.ownerId)?.email ?? null) : null) },
      { header: 'Value (INR)', width: 14, value: (l) => l.valueInr },
      { header: 'Score', width: 8, value: (l) => l.score },
      { header: 'Temperature', width: 12, value: (l) => l.temperature },
      { header: 'Tags', width: 24, value: (l) => l.tags.join('; ') },
      { header: 'Next follow-up', width: 22, value: (l) => l.nextFollowUpAt },
      { header: 'Last activity', width: 22, value: (l) => l.lastActivityAt },
      { header: 'Created', width: 22, value: (l) => l.createdAt },
      ...customFields.map((f) => ({
        header: f.label,
        width: 18,
        value: (l: LeadListRow) => {
          const v = parseCustomFields(l.customFields)[f.key];
          return v === undefined || v === null ? null : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v;
        },
      })),
    ];

    const stamp = new Date().toISOString().slice(0, 10);
    const xlsx = q.format === 'xlsx';
    res.status(200);
    res.setHeader('Content-Type', xlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${stamp}.${xlsx ? 'xlsx' : 'csv'}"`);
    res.setHeader('Cache-Control', 'no-store');

    let count = 0;
    const batches = async function* (svc: LeadsService) {
      let cursor: string | undefined;
      do {
        const page = await svc.page(db, base, { sort: q.sort, dir: q.dir, limit: BATCH, cursor });
        yield page.rows;
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    };

    try {
      if (xlsx) {
        const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: false, useSharedStrings: false });
        const ws = wb.addWorksheet('Leads');
        ws.columns = columns.map((c, i) => ({ header: c.header, key: String(i), width: c.width }));
        for await (const rows of batches(this.leads)) {
          for (const l of rows) ws.addRow(columns.map((c) => c.value(l))).commit();
          count += rows.length;
        }
        ws.commit();
        await wb.commit();
      } else {
        const write = (chunk: string) => (res.write(chunk) ? Promise.resolve() : new Promise<void>((r) => res.once('drain', () => r())));
        await write(`\uFEFF${Papa.unparse([columns.map((c) => c.header)], { newline: '\r\n' })}\r\n`);
        for await (const rows of batches(this.leads)) {
          if (rows.length) await write(`${Papa.unparse(rows.map((l) => columns.map((c) => csvSafe(c.value(l)))), { newline: '\r\n' })}\r\n`);
          count += rows.length;
        }
        res.end();
      }
    } catch (err) {
      this.logger.error(`Lead export failed after ${count} rows: ${(err as Error).name}`);
      if (!res.headersSent) throw err;
      res.destroy();
      return;
    }

    const { q: search, ...filters } = q;
    await this.audit.record(
      auth,
      req,
      { action: 'lead.export', entityType: 'lead', diff: { format: q.format, count, filters: { ...filters, ...(search ? { q: '[search]' } : {}) } } },
      actor.summary?.name,
    );
  }
}
