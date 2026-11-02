import { Injectable } from '@nestjs/common';
import {
  ChartPaletteSchema,
  EMPTY_BRANDING,
  HexColorSchema,
  resolveBrandColors,
  resolveChartPalette,
  SETTING_KEYS,
  type BrandingUpdate,
  type FilePurpose,
  type FileRef,
  type WorkspaceBranding,
} from '@vistar/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { TenantPrisma } from '../../infra/prisma/tenant.js';
import { StorageService } from '../storage/storage.service.js';

const K = SETTING_KEYS.workspace;
const FILE_KEYS = {
  logoLight: { key: K.brandingLogoLight, purpose: 'logo', body: 'logoLightFileId' },
  logoDark: { key: K.brandingLogoDark, purpose: 'logo', body: 'logoDarkFileId' },
  loginImage: { key: K.brandingLoginImage, purpose: 'login_image', body: 'loginImageFileId' },
  favicon: { key: K.brandingFavicon, purpose: 'favicon', body: 'faviconFileId' },
} as const satisfies Record<string, { key: string; purpose: FilePurpose; body: keyof BrandingUpdate }>;
type FileField = keyof typeof FILE_KEYS;
const FILE_FIELDS = Object.keys(FILE_KEYS) as FileField[];
const ALL_KEYS = [K.brandingDisplayName, K.brandingBrandColor, K.brandingChartPalette, ...FILE_FIELDS.map((f) => FILE_KEYS[f].key)];
const IdOrNull = z.uuid();

/**
 * Company branding (D-060): Setting rows `branding.*` (scope workspace) holding text, colours and File ids.
 * Files must be this workspace's public files of the matching purpose (logo, login_image, favicon).
 * Colours are stored as chosen and resolved with the contrast guard (packages/shared/src/branding.ts) on read.
 * The legacy Workspace columns logoUrl and accentColor mirror logoLight and brandColor.
 */
@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async get(db: TenantPrisma, workspaceId: string): Promise<WorkspaceBranding> {
    const rows = await db.setting.findMany({ where: { scope: 'workspace', scopeId: workspaceId, key: { in: ALL_KEYS } }, select: { key: true, value: true } });
    if (!rows.length) return EMPTY_BRANDING;
    const byKey = new Map(rows.map((r) => [r.key, r.value as unknown]));
    const ids = FILE_FIELDS.map((f) => IdOrNull.safeParse(byKey.get(FILE_KEYS[f].key))).flatMap((r) => (r.success ? [r.data] : []));
    const files = ids.length ? await db.file.findMany({ where: { id: { in: ids }, deletedAt: null, visibility: 'public' } }) : [];
    const fileById = new Map(files.map((f) => [f.id, f]));
    const ref = (field: FileField): FileRef | null => {
      const id = IdOrNull.safeParse(byKey.get(FILE_KEYS[field].key));
      const f = id.success ? fileById.get(id.data) : undefined;
      return f ? { fileId: f.id, name: f.name, mime: f.mime, size: f.size, url: this.storage.publicUrl(f.id) } : null;
    };
    const color = HexColorSchema.safeParse(byKey.get(K.brandingBrandColor));
    const palette = ChartPaletteSchema.safeParse(byKey.get(K.brandingChartPalette));
    const name = z.string().min(1).safeParse(byKey.get(K.brandingDisplayName));
    return {
      displayName: name.success ? name.data : null,
      logoLight: ref('logoLight'),
      logoDark: ref('logoDark'),
      brandColor: color.success ? color.data.toUpperCase() : null,
      chartPalette: palette.success ? palette.data.map((c) => c.toUpperCase()) : null,
      loginImage: ref('loginImage'),
      favicon: ref('favicon'),
      colors: color.success ? resolveBrandColors(color.data) : null,
      chartColors: palette.success ? resolveChartPalette(palette.data) : null,
    };
  }

  /** Apply a PATCH; returns the before/after branding (the caller audits and publishes). */
  async update(auth: AuthContext, req: Request, body: BrandingUpdate): Promise<{ before: WorkspaceBranding; after: WorkspaceBranding; changed: string[] }> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const before = await this.get(db, wid);

    // File ids: this workspace, matching purpose, public, not deleted. Other tenants' ids are NOT_FOUND.
    const fileWrites: Array<{ field: FileField; id: string | null }> = [];
    for (const field of FILE_FIELDS) {
      const id = body[FILE_KEYS[field].body];
      if (id === undefined) continue;
      if (id !== null) {
        const f = await db.file.findFirst({ where: { id, deletedAt: null }, select: { purpose: true, visibility: true } });
        if (!f) throw notFound('File');
        if (f.purpose !== FILE_KEYS[field].purpose || f.visibility !== 'public') {
          throw new AppException('FILE_INVALID', `Upload this file with purpose "${FILE_KEYS[field].purpose}"`, { details: [{ path: FILE_KEYS[field].body, message: `Expected a ${FILE_KEYS[field].purpose} file` }] });
        }
      }
      fileWrites.push({ field, id });
    }

    const writes: Array<{ key: string; value: Prisma.InputJsonValue | null }> = [
      ...fileWrites.map((w) => ({ key: FILE_KEYS[w.field].key, value: w.id })),
      ...(body.displayName !== undefined ? [{ key: K.brandingDisplayName, value: body.displayName }] : []),
      ...(body.brandColor !== undefined ? [{ key: K.brandingBrandColor, value: body.brandColor?.toUpperCase() ?? null }] : []),
      ...(body.chartPalette !== undefined ? [{ key: K.brandingChartPalette, value: body.chartPalette?.map((c) => c.toUpperCase()) ?? null }] : []),
    ];
    const ops = writes.map(({ key, value }) =>
      value === null
        ? db.setting.deleteMany({ where: { scope: 'workspace', scopeId: wid, key } })
        : db.setting.upsert({
            where: { workspaceId_scope_scopeId_key: { workspaceId: wid, scope: 'workspace', scopeId: wid, key } },
            create: { workspaceId: wid, scope: 'workspace', scopeId: wid, key, value },
            update: { value },
          }),
    );
    // Legacy mirrors for consumers that still read Workspace.logoUrl / accentColor.
    const mirror: Prisma.WorkspaceUpdateInput = {};
    if (body.brandColor !== undefined) mirror.accentColor = body.brandColor?.toUpperCase() ?? null;
    if (body.logoLightFileId !== undefined) mirror.logoUrl = body.logoLightFileId ? this.storage.publicUrl(body.logoLightFileId) : null;
    if (Object.keys(mirror).length) ops.push(db.workspace.update({ where: { id: wid }, data: mirror }) as never);
    if (ops.length) await db.$transaction(ops);

    const after = await this.get(db, wid);
    const changed = (['displayName', 'brandColor', 'chartPalette', ...FILE_FIELDS] as const).filter((k) => {
      const a = before[k];
      const b = after[k];
      return JSON.stringify(a && typeof a === 'object' && 'fileId' in a ? a.fileId : a) !== JSON.stringify(b && typeof b === 'object' && 'fileId' in b ? b.fileId : b);
    });
    if (changed.length) {
      const pick = (b: WorkspaceBranding, k: (typeof changed)[number]) => {
        const v = b[k];
        return v && typeof v === 'object' && 'fileId' in v ? v.fileId : v;
      };
      await this.audit.record(auth, req, {
        action: 'workspace.branding_update',
        entityType: 'workspace',
        entityId: wid,
        diff: {
          ...Object.fromEntries(changed.map((k) => [k, { from: pick(before, k), to: pick(after, k) }])),
          ...(after.colors?.adjusted ? { brandColorAdjusted: { light: after.colors.light, dark: after.colors.dark } } : {}),
        },
      });
    }
    return { before, after, changed };
  }
}
