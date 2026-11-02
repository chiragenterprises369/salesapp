import { Injectable, Logger } from '@nestjs/common';
import {
  defaultFloorTemplateFor,
  floorRequestImageProblems,
  SeatMapSchema,
  seatMapFromPlan,
  type FloorAsset,
  type FloorPlan,
  type FloorRequest,
  type FloorRequestCreate,
  type FloorRequestStatus,
  type Page,
  type SeatMap,
  type TeamFloorLayout,
  type TeamFloorRef,
} from '@vistar/shared';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext, PlatformAuthContext } from '../../common/auth/auth-context.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import type { FloorAsset as AssetRow, FloorRequest as RequestRow, FloorRequestImage as ImageRow, File as FileRow, Prisma } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { afterTimeCursor, encodeCursor } from '../leads/lib/cursor.js';
import { publishSafe } from '../leads/lib/context.js';
import { StorageService, type UploadedFileLike } from '../storage/storage.service.js';

type RequestWithImages = RequestRow & { images: ImageRow[] };
const PLATFORM_ACTOR = (adminId: string) => ({ type: 'system' as const, id: adminId, name: 'Vistar support' });

/**
 * Custom Team Floors (D-061). Company: reference-image requests and the published layout. Super Admin:
 * requests across companies, floor versions (GLB, zipped glTF or an AI-written floor plan JSON), seat map,
 * publish. Company rows are tenant tables; Super Admin calls use the company's tenant client.
 */
@Injectable()
export class FloorsService {
  private readonly logger = new Logger(FloorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  // ---------------------------------------------------------------- mapping

  private async names(workspaceIds: string[], userIds: string[], adminIds: string[]) {
    const [ws, users, admins] = await Promise.all([
      workspaceIds.length ? this.prisma.workspace.findMany({ where: { id: { in: workspaceIds } }, select: { id: true, name: true } }) : [],
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
      adminIds.length ? this.prisma.platformAdmin.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true } }) : [],
    ]);
    return { ws: new Map(ws.map((w) => [w.id, w.name])), users: new Map(users.map((u) => [u.id, u.name])), admins: new Map(admins.map((a) => [a.id, a.name])) };
  }

  private async toRequests(rows: RequestWithImages[], withUrls: boolean): Promise<FloorRequest[]> {
    const fileIds = rows.flatMap((r) => r.images.map((i) => i.fileId));
    const files = fileIds.length ? await this.prisma.file.findMany({ where: { id: { in: fileIds } } }) : [];
    const fileById = new Map(files.map((f) => [f.id, f]));
    const n = await this.names([...new Set(rows.map((r) => r.workspaceId))], rows.flatMap((r) => (r.createdById ? [r.createdById] : [])), []);
    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspaceId,
      workspaceName: n.ws.get(r.workspaceId) ?? '',
      status: r.status,
      headcount: r.headcount,
      notes: r.notes,
      statusNote: r.statusNote,
      images: [...r.images]
        .sort((a, b) => a.order - b.order)
        .flatMap((i) => {
          const f = fileById.get(i.fileId);
          return f ? [{ fileId: f.id, category: i.category, caption: i.caption, name: f.name, mime: f.mime, size: f.size, url: withUrls ? this.storage.signedUrl(f).url : null }] : [];
        }),
      createdBy: r.createdById ? { id: r.createdById, name: n.users.get(r.createdById) ?? 'Former member' } : null,
      submittedAt: r.submittedAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      publishedFloorId: r.publishedFloorId,
    }));
  }

  private async toAssets(rows: AssetRow[], withUrls: boolean): Promise<FloorAsset[]> {
    const files = rows.length ? await this.prisma.file.findMany({ where: { id: { in: rows.map((r) => r.modelFileId) } } }) : [];
    const fileById = new Map(files.map((f) => [f.id, f]));
    const n = await this.names([], [], rows.flatMap((r) => [r.uploadedByAdminId, r.publishedByAdminId].filter((x): x is string => !!x)));
    return rows.map((r) => {
      const f = fileById.get(r.modelFileId);
      const seat = SeatMapSchema.safeParse(r.seatMap);
      return {
        id: r.id,
        workspaceId: r.workspaceId,
        requestId: r.requestId,
        version: r.version,
        status: r.status,
        format: r.format,
        model: { fileId: r.modelFileId, name: f?.name ?? 'model', mime: f?.mime ?? 'application/octet-stream', size: f?.size ?? 0, url: withUrls && f ? this.storage.signedUrl(f).url : null },
        seatMap: seat.success ? seat.data : null,
        seatCount: seat.success ? seat.data.seats.length : 0,
        notes: r.notes,
        uploadedBy: r.uploadedByAdminId ? { id: r.uploadedByAdminId, name: n.admins.get(r.uploadedByAdminId) ?? 'Vistar support' } : null,
        publishedAt: r.publishedAt?.toISOString() ?? null,
        publishedBy: r.publishedByAdminId ? { id: r.publishedByAdminId, name: n.admins.get(r.publishedByAdminId) ?? 'Vistar support' } : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  private async publishRequest(r: FloorRequest, actor: { type: 'user' | 'system'; id: string | null; name: string | null }) {
    const { images: _images, ...request } = r;
    await publishSafe(this.events, this.logger, 'floor_request.updated', r.workspaceId, { request }, { actor });
  }

  // ---------------------------------------------------------------- company

  async createRequest(auth: AuthContext, req: Request, body: FloorRequestCreate): Promise<FloorRequest> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const problems = floorRequestImageProblems(body.images.map((i) => i.category));
    if (problems.length) throw new AppException('FLOOR_REQUEST_INCOMPLETE', problems[0]!, { details: problems.map((message) => ({ path: 'images', message })) });
    const ids = body.images.map((i) => i.fileId);
    if (new Set(ids).size !== ids.length) throw new AppException('VALIDATION_FAILED', 'Each photo can be added once', { details: [{ path: 'images', message: 'Duplicate fileId' }] });
    const files = await db.file.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, purpose: true } });
    if (files.length !== ids.length) throw notFound('File');
    if (files.some((f) => f.purpose !== 'reference_image')) throw new AppException('FILE_INVALID', 'Upload the photos with purpose "reference_image"');

    const created = await db.$transaction(async (tx) => {
      const r = await tx.floorRequest.create({ data: { workspaceId: wid, headcount: body.headcount, notes: body.notes ?? null, createdById: auth.userId } });
      await tx.floorRequestImage.createMany({ data: body.images.map((i, order) => ({ workspaceId: wid, requestId: r.id, fileId: i.fileId, category: i.category, caption: i.caption ?? null, order })) });
      return tx.floorRequest.findFirstOrThrow({ where: { id: r.id }, include: { images: true } });
    });
    const [out] = await this.toRequests([created], true);
    await this.audit.record(auth, req, { action: 'floor_request.create', entityType: 'floor_request', entityId: created.id, diff: { headcount: body.headcount, images: body.images.length } });
    await this.publishRequest(out!, { type: 'user', id: auth.userId, name: null });
    return out!;
  }

  async listRequests(auth: AuthContext): Promise<{ items: FloorRequest[] }> {
    const rows = await this.prisma.forTenant(auth.workspaceId).floorRequest.findMany({ include: { images: true }, orderBy: { submittedAt: 'desc' }, take: 50 });
    return { items: await this.toRequests(rows, false) };
  }

  async getRequest(auth: AuthContext, id: string): Promise<FloorRequest> {
    const row = await this.prisma.forTenant(auth.workspaceId).floorRequest.findFirst({ where: { id }, include: { images: true } });
    if (!row) throw notFound('Floor request');
    return (await this.toRequests([row], true))[0]!;
  }

  /** Which floor the company shows: the published custom floor, else the default template for its head count. */
  async layoutRef(workspaceId: string): Promise<TeamFloorRef & { asset: AssetRow | null }> {
    const db = this.prisma.forTenant(workspaceId);
    const [asset, people] = await Promise.all([
      db.floorAsset.findFirst({ where: { status: 'published' }, orderBy: { version: 'desc' } }),
      db.user.count({ where: { isActive: true, deletedAt: null, role: { kind: { not: 'viewer' } } } }),
    ]);
    const templateId = defaultFloorTemplateFor(people);
    return asset ? { source: 'custom', templateId, floorAssetId: asset.id, version: asset.version, asset } : { source: 'template', templateId, floorAssetId: null, version: null, asset: null };
  }

  async layout(auth: AuthContext): Promise<TeamFloorLayout> {
    const { asset, ...ref } = await this.layoutRef(auth.workspaceId);
    const db = this.prisma.forTenant(auth.workspaceId);
    const request = await db.floorRequest.findFirst({ orderBy: { submittedAt: 'desc' }, select: { id: true, status: true, statusNote: true, submittedAt: true } });
    let floor: TeamFloorLayout['floor'] = null;
    if (asset) {
      const file = await db.file.findFirst({ where: { id: asset.modelFileId, deletedAt: null } });
      const seat = SeatMapSchema.safeParse(asset.seatMap);
      if (file && seat.success && asset.publishedAt) {
        const url = this.storage.signedUrl(file);
        floor = { id: asset.id, version: asset.version, format: asset.format, modelUrl: url.url, modelUrlExpiresAt: url.expiresAt, seatMap: seat.data, publishedAt: asset.publishedAt.toISOString() };
      }
    }
    return {
      ...(floor ? ref : { source: 'template' as const, templateId: ref.templateId, floorAssetId: null, version: null }),
      floor,
      request: request ? { id: request.id, status: request.status, statusNote: request.statusNote, submittedAt: request.submittedAt.toISOString() } : null,
    };
  }

  // ---------------------------------------------------------------- Super Admin

  async superListRequests(query: { cursor?: string; limit: number; status?: FloorRequestStatus[]; workspaceId?: string }): Promise<Page<FloorRequest>> {
    const where: Prisma.FloorRequestWhereInput = { ...(query.status?.length ? { status: { in: query.status } } : {}), ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}) };
    const after = afterTimeCursor(query.cursor, 'submittedAt');
    const rows = await this.prisma.floorRequest.findMany({
      where: Object.keys(after).length ? { AND: [where, after as Prisma.FloorRequestWhereInput] } : where,
      include: { images: true },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return { items: await this.toRequests(page, false), nextCursor: rows.length > query.limit ? encodeCursor({ t: page[page.length - 1]!.submittedAt.toISOString(), id: page[page.length - 1]!.id }) : null };
  }

  private async requestRow(id: string): Promise<RequestWithImages> {
    const row = await this.prisma.floorRequest.findUnique({ where: { id }, include: { images: true } });
    if (!row) throw notFound('Floor request');
    return row;
  }

  async superGetRequest(id: string): Promise<FloorRequest> {
    return (await this.toRequests([await this.requestRow(id)], true))[0]!;
  }

  async superChangeStatus(admin: PlatformAuthContext, req: Request, id: string, body: { status: 'in_progress' | 'rejected'; note?: string }): Promise<FloorRequest> {
    const row = await this.requestRow(id);
    if (row.status === 'published') throw new AppException('CONFLICT', 'This request is already published');
    await this.prisma.forTenant(row.workspaceId).floorRequest.update({ where: { id }, data: { status: body.status, statusNote: body.note ?? row.statusNote, handledByAdminId: admin.adminId } });
    await this.audit.platform(admin, req, { action: `floor_request.${body.status}`, entityType: 'floor_request', entityId: id, workspaceId: row.workspaceId, reason: body.note ?? null, diff: { status: { from: row.status, to: body.status } } });
    const out = await this.superGetRequest(id);
    await this.publishRequest(out, PLATFORM_ACTOR(admin.adminId));
    return out;
  }

  private async workspaceExists(workspaceId: string): Promise<void> {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { deletedAt: true } });
    if (!ws || ws.deletedAt) throw notFound('Company');
  }

  async superListFloors(workspaceId: string): Promise<{ items: FloorAsset[] }> {
    await this.workspaceExists(workspaceId);
    const rows = await this.prisma.forTenant(workspaceId).floorAsset.findMany({ orderBy: { version: 'desc' } });
    return { items: await this.toAssets(rows, false) };
  }

  async superUpload(admin: PlatformAuthContext, req: Request, workspaceId: string, file: UploadedFileLike | undefined, fields: { requestId?: string; notes?: string }): Promise<FloorAsset> {
    await this.workspaceExists(workspaceId);
    const db = this.prisma.forTenant(workspaceId);
    if (fields.requestId && !(await db.floorRequest.count({ where: { id: fields.requestId } }))) throw notFound('Floor request');
    const stored: FileRow & { format?: FloorAsset['format']; plan?: FloorPlan } = await this.storage.saveTenantFile(workspaceId, 'floor_model', file, { uploadedByAdminId: admin.adminId });
    const seatMap: SeatMap | null = stored.plan ? seatMapFromPlan(stored.plan) : null;
    let asset: AssetRow | null = null;
    for (let attempt = 0; attempt < 3 && !asset; attempt++) {
      const last = await db.floorAsset.findFirst({ orderBy: { version: 'desc' }, select: { version: true } });
      asset = await db.floorAsset
        .create({
          data: {
            workspaceId,
            requestId: fields.requestId ?? null,
            version: (last?.version ?? 0) + 1,
            format: stored.format ?? 'glb',
            modelFileId: stored.id,
            seatMap: (seatMap ?? undefined) as Prisma.InputJsonValue | undefined,
            notes: fields.notes ?? null,
            uploadedByAdminId: admin.adminId,
          },
        })
        .catch((err: { code?: string }) => {
          if (err.code === 'P2002') return null; // version race: retry
          throw err;
        });
    }
    if (!asset) throw new AppException('CONFLICT', 'Another upload for this company is in progress. Try again');
    if (fields.requestId) await db.floorRequest.updateMany({ where: { id: fields.requestId, status: 'submitted' }, data: { status: 'in_progress', handledByAdminId: admin.adminId } });
    await this.audit.platform(admin, req, { action: 'floor.upload', entityType: 'floor_asset', entityId: asset.id, workspaceId, diff: { version: asset.version, format: asset.format, size: stored.size, sha256: stored.sha256 } });
    return (await this.toAssets([asset], true))[0]!;
  }

  private async assetRow(id: string): Promise<AssetRow> {
    const row = await this.prisma.floorAsset.findUnique({ where: { id } });
    if (!row) throw notFound('Floor');
    return row;
  }

  async superGetFloor(id: string): Promise<FloorAsset> {
    return (await this.toAssets([await this.assetRow(id)], true))[0]!;
  }

  async superSaveSeatMap(admin: PlatformAuthContext, req: Request, id: string, seatMap: SeatMap): Promise<FloorAsset> {
    const row = await this.assetRow(id);
    if (row.status === 'superseded') throw new AppException('FLOOR_NOT_READY', 'This version was replaced by a newer published floor; upload or edit the current one');
    const updated = await this.prisma.forTenant(row.workspaceId).floorAsset.update({ where: { id }, data: { seatMap: seatMap as unknown as Prisma.InputJsonValue } });
    await this.audit.platform(admin, req, { action: 'floor.seat_map', entityType: 'floor_asset', entityId: id, workspaceId: row.workspaceId, diff: { seats: seatMap.seats.length, zones: seatMap.zones.length } });
    if (updated.status === 'published') await this.publishFloor(row.workspaceId, admin.adminId);
    return (await this.toAssets([updated], true))[0]!;
  }

  async superPublish(admin: PlatformAuthContext, req: Request, id: string): Promise<FloorAsset> {
    const row = await this.assetRow(id);
    if (!SeatMapSchema.safeParse(row.seatMap).success) throw new AppException('FLOOR_NOT_READY', 'Place the seats (seat map) before publishing');
    if (row.status === 'superseded') throw new AppException('FLOOR_NOT_READY', 'This version was replaced by a newer published floor');
    const db = this.prisma.forTenant(row.workspaceId);
    const now = new Date();
    await db.$transaction([
      db.floorAsset.updateMany({ where: { status: 'published', id: { not: id } }, data: { status: 'superseded' } }),
      db.floorAsset.update({ where: { id }, data: { status: 'published', publishedAt: now, publishedByAdminId: admin.adminId } }),
      ...(row.requestId ? [db.floorRequest.updateMany({ where: { id: row.requestId }, data: { status: 'published', publishedFloorId: id, handledByAdminId: admin.adminId } })] : []),
    ]);
    await this.audit.platform(admin, req, { action: 'floor.publish', entityType: 'floor_asset', entityId: id, workspaceId: row.workspaceId, diff: { version: row.version } });
    await this.publishFloor(row.workspaceId, admin.adminId);
    if (row.requestId) await this.publishRequest(await this.superGetRequest(row.requestId), PLATFORM_ACTOR(admin.adminId));
    return this.superGetFloor(id);
  }

  private async publishFloor(workspaceId: string, adminId: string): Promise<void> {
    const { asset: _asset, ...floor } = await this.layoutRef(workspaceId);
    await publishSafe(this.events, this.logger, 'floor.published', workspaceId, { floor }, { actor: PLATFORM_ACTOR(adminId) });
  }
}
