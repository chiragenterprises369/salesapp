import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../infra/prisma/prisma.service.js';

/**
 * Aggregate queries for the dashboard. Raw SQL is NOT tenant-scoped automatically: every query filters
 * by "workspaceId" explicitly, and by owner/user ids when the caller's scope (or a team filter) applies.
 * Timestamps are `timestamp without time zone` holding UTC, so bounds are built as UTC wall times and
 * buckets use epoch seconds (independent of the session time zone).
 */
export type UserFilter = string[] | null;

const ts = (d: Date) => Prisma.sql`(to_timestamp(${d.getTime() / 1000}::float8) AT TIME ZONE 'UTC')`;
const inRange = (col: string, start: Date, end: Date) => Prisma.sql`${Prisma.raw(col)} >= ${ts(start)} AND ${Prisma.raw(col)} < ${ts(end)}`;
const bucket = (col: string, start: Date, end: Date, n: number) =>
  Prisma.sql`LEAST(GREATEST(FLOOR((EXTRACT(EPOCH FROM ${Prisma.raw(col)}) - ${start.getTime() / 1000}::float8) / ${(end.getTime() - start.getTime()) / 1000 / n}::float8)::int, 0), ${n - 1}::int)`;
const usersIn = (col: string, users: UserFilter) => (users === null ? Prisma.empty : Prisma.sql`AND ${Prisma.raw(col)} = ANY(${users}::uuid[])`);

type Row = { b: number } & Record<string, number | bigint | null>;
const num = (v: number | bigint | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

function spread<K extends string>(rows: Row[], n: number, keys: K[]): Record<K, number[]> {
  const out = Object.fromEntries(keys.map((k) => [k, Array.from({ length: n }, () => 0)])) as Record<K, number[]>;
  for (const r of rows) for (const k of keys) out[k][r.b] = (out[k][r.b] ?? 0) + num(r[k]);
  return out;
}

export class DashboardSql {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceId: string,
    private readonly users: UserFilter,
  ) {}

  async newLeads(start: Date, end: Date, n: number) {
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT ${bucket('l."createdAt"', start, end, n)} AS b, COUNT(*)::int AS v
      FROM "Lead" l
      WHERE l."workspaceId" = ${this.workspaceId}::uuid AND l."deletedAt" IS NULL AND ${inRange('l."createdAt"', start, end)} ${usersIn('l."ownerId"', this.users)}
      GROUP BY 1`;
    return spread(rows, n, ['v']).v;
  }

  async calls(start: Date, end: Date, n: number) {
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT ${bucket('c."startedAt"', start, end, n)} AS b, COUNT(*)::int AS total, COUNT(c."answeredAt")::int AS answered
      FROM "Call" c
      WHERE c."workspaceId" = ${this.workspaceId}::uuid AND ${inRange('c."startedAt"', start, end)} ${usersIn('c."userId"', this.users)}
      GROUP BY 1`;
    return spread(rows, n, ['total', 'answered']);
  }

  /** Leads closed in the range: won (wonAt) and lost (lostAt). */
  async closed(start: Date, end: Date, n: number) {
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT b, SUM(won)::int AS won, SUM(lost)::int AS lost FROM (
        SELECT ${bucket('l."wonAt"', start, end, n)} AS b, 1 AS won, 0 AS lost FROM "Lead" l
        WHERE l."workspaceId" = ${this.workspaceId}::uuid AND l."deletedAt" IS NULL AND ${inRange('l."wonAt"', start, end)} ${usersIn('l."ownerId"', this.users)}
        UNION ALL
        SELECT ${bucket('l."lostAt"', start, end, n)} AS b, 0 AS won, 1 AS lost FROM "Lead" l
        WHERE l."workspaceId" = ${this.workspaceId}::uuid AND l."deletedAt" IS NULL AND ${inRange('l."lostAt"', start, end)} ${usersIn('l."ownerId"', this.users)}
      ) x GROUP BY b`;
    return spread(rows, n, ['won', 'lost']);
  }

  /** Won deal value closed in the range (deals of deleted leads excluded). */
  async revenue(start: Date, end: Date, n: number) {
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT ${bucket('d."closedAt"', start, end, n)} AS b, COALESCE(SUM(d."valueInr"), 0)::bigint AS v
      FROM "Deal" d JOIN "Lead" l ON l.id = d."leadId"
      WHERE d."workspaceId" = ${this.workspaceId}::uuid AND d.status = 'won' AND l."deletedAt" IS NULL
        AND ${inRange('d."closedAt"', start, end)} ${usersIn('l."ownerId"', this.users)}
      GROUP BY 1`;
    return spread(rows, n, ['v']).v;
  }

  /** Lead created -> first response, for leads created in the range. */
  async response(start: Date, end: Date, n: number) {
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT ${bucket('l."createdAt"', start, end, n)} AS b,
        COALESCE(SUM(EXTRACT(EPOCH FROM (l."firstResponseAt" - l."createdAt"))), 0)::float8 AS s, COUNT(*)::int AS c
      FROM "Lead" l
      WHERE l."workspaceId" = ${this.workspaceId}::uuid AND l."deletedAt" IS NULL AND l."firstResponseAt" IS NOT NULL
        AND l."firstResponseAt" >= l."createdAt" AND ${inRange('l."createdAt"', start, end)} ${usersIn('l."ownerId"', this.users)}
      GROUP BY 1`;
    return spread(rows, n, ['s', 'c']);
  }

  /** 24 rows (hour 0-23, workspace timezone); answered = has answeredAt. */
  async callsPerHour(start: Date, end: Date, tz: string) {
    const rows = await this.prisma.$queryRaw<Array<{ h: number; answered: number; missed: number }>>`
      SELECT EXTRACT(HOUR FROM (c."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}))::int AS h,
        COUNT(c."answeredAt")::int AS answered, (COUNT(*) - COUNT(c."answeredAt"))::int AS missed
      FROM "Call" c
      WHERE c."workspaceId" = ${this.workspaceId}::uuid AND ${inRange('c."startedAt"', start, end)} ${usersIn('c."userId"', this.users)}
      GROUP BY 1`;
    const byHour = new Map(rows.map((r) => [r.h, r]));
    return Array.from({ length: 24 }, (_, hour) => ({ hour, answered: num(byHour.get(hour)?.answered), missed: num(byHour.get(hour)?.missed) }));
  }

  /** Won revenue and deal count per lead owner for deals closed in the range. */
  async wonByOwner(start: Date, end: Date): Promise<Map<string, { revenue: number; deals: number }>> {
    const rows = await this.prisma.$queryRaw<Array<{ ownerId: string; revenue: bigint; deals: number }>>`
      SELECT l."ownerId" AS "ownerId", COALESCE(SUM(d."valueInr"), 0)::bigint AS revenue, COUNT(*)::int AS deals
      FROM "Deal" d JOIN "Lead" l ON l.id = d."leadId"
      WHERE d."workspaceId" = ${this.workspaceId}::uuid AND d.status = 'won' AND l."deletedAt" IS NULL AND l."ownerId" IS NOT NULL
        AND ${inRange('d."closedAt"', start, end)} ${usersIn('l."ownerId"', this.users)}
      GROUP BY 1`;
    return new Map(rows.map((r) => [r.ownerId, { revenue: num(r.revenue), deals: num(r.deals) }]));
  }
}
