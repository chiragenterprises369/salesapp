import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { SeatMapSchema, type OfficeMarker, type OfficeMarkerKind, type ZoneSignal } from '@vistar/shared';
import type { Request } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import type { z } from 'zod';
import type { OfficeMarkerCreateSchema } from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import type { OfficeMarker as MarkerRow } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { normBssid, resolveSignal, type MarkerRef, type ZoneObservation } from './engine/zone-engine.js';

const CATALOG_TTL_MS = 30_000;
const MAX_MARKERS = 500;
/** Token prefix: recognisable in a QR payload or on an NFC tag ("Vistar zone v1"). */
const TOKEN_PREFIX = 'vz1.';

export const hashMarkerToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

interface Catalog {
  at: number;
  markers: MarkerRef[];
  /** zoneId -> display name (seat-map zone name, else the first marker label). */
  names: Map<string, string>;
  /** Zone ids of the published seat map; null when no custom floor with zones is published. */
  seatZones: Set<string> | null;
}

export function toOfficeMarker(row: MarkerRow, token?: string): OfficeMarker {
  return {
    id: row.id,
    kind: row.kind as OfficeMarkerKind,
    zoneId: row.zoneId,
    label: row.label,
    beacon: row.beaconUuid !== null && row.beaconMajor !== null && row.beaconMinor !== null ? { uuid: row.beaconUuid, major: row.beaconMajor, minor: row.beaconMinor } : null,
    bssid: row.bssid,
    ...(token ? { token } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Office zone markers (SPEC 29.11): BLE beacons, Wi-Fi access points, QR codes and NFC tags that the company
 * admin assigns to zones of the published floor (Team Floor settings). QR / NFC tokens are random, returned
 * once at creation and stored only as SHA-256. Also turns a raw ZoneSignal into zone observations for the
 * zone engine, with a per-workspace catalog cached for 30 s (dropped on marker changes and floor.published).
 */
@Injectable()
export class OfficeMarkersService implements OnModuleInit, OnModuleDestroy {
  private readonly catalogs = new Map<string, Catalog>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.subscribe((e) => {
      if (e.type === 'floor.published') this.catalogs.delete(e.workspaceId);
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  // ---------------------------------------------------------------- CRUD (settings.manage)

  async list(auth: AuthContext): Promise<{ items: OfficeMarker[] }> {
    const rows = await this.prisma.forTenant(auth.workspaceId).officeMarker.findMany({ orderBy: [{ zoneId: 'asc' }, { createdAt: 'asc' }], take: MAX_MARKERS });
    return { items: rows.map((r) => toOfficeMarker(r)) };
  }

  async create(auth: AuthContext, req: Request | null, body: z.output<typeof OfficeMarkerCreateSchema>): Promise<OfficeMarker> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const catalog = await this.catalog(auth.workspaceId);
    if (catalog.seatZones && !catalog.seatZones.has(body.zoneId)) {
      throw new AppException('VALIDATION_FAILED', 'Pick a zone of the published floor', { details: [{ path: 'zoneId', message: `Unknown zone "${body.zoneId}"` }] });
    }
    if ((await db.officeMarker.count()) >= MAX_MARKERS) throw new AppException('CONFLICT', `A company can have up to ${MAX_MARKERS} markers`);
    const token = body.kind === 'qr' || body.kind === 'nfc' ? `${TOKEN_PREFIX}${randomBytes(24).toString('base64url')}` : undefined;
    const beacon = body.kind === 'ble_beacon' && body.beacon ? { beaconUuid: body.beacon.uuid.toLowerCase(), beaconMajor: body.beacon.major, beaconMinor: body.beacon.minor } : {};
    const bssid = body.kind === 'wifi_ap' && body.bssid ? normBssid(body.bssid) : null;
    if (beacon.beaconUuid && (await db.officeMarker.count({ where: { beaconUuid: beacon.beaconUuid, beaconMajor: beacon.beaconMajor, beaconMinor: beacon.beaconMinor } }))) {
      throw new AppException('CONFLICT', 'This beacon is already registered');
    }
    if (bssid && (await db.officeMarker.count({ where: { bssid } }))) throw new AppException('CONFLICT', 'This access point is already registered');
    let row: MarkerRow;
    try {
      row = await db.officeMarker.create({
        data: { workspaceId: auth.workspaceId, kind: body.kind, zoneId: body.zoneId, label: body.label, ...beacon, bssid, tokenHash: token ? hashMarkerToken(token) : null, createdById: auth.userId },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new AppException('CONFLICT', 'This marker is already registered');
      throw err;
    }
    this.catalogs.delete(auth.workspaceId);
    await this.audit.record(auth, req, { action: 'office_marker.create', entityType: 'office_marker', entityId: row.id, diff: { kind: row.kind, zoneId: row.zoneId, label: row.label } });
    return toOfficeMarker(row, token);
  }

  async remove(auth: AuthContext, req: Request | null, id: string): Promise<{ ok: true }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const row = await db.officeMarker.findFirst({ where: { id } });
    if (!row) throw notFound('Marker');
    await db.officeMarker.deleteMany({ where: { id } });
    this.catalogs.delete(auth.workspaceId);
    await this.audit.record(auth, req, { action: 'office_marker.delete', entityType: 'office_marker', entityId: id, diff: { kind: row.kind, zoneId: row.zoneId, label: row.label } });
    return { ok: true };
  }

  // ---------------------------------------------------------------- signals

  /** Zone catalog of a workspace (markers, zone names, seat-map zones), cached 30 s. */
  async catalog(workspaceId: string): Promise<Catalog> {
    const hit = this.catalogs.get(workspaceId);
    const now = Date.now();
    if (hit && now - hit.at < CATALOG_TTL_MS) return hit;
    const db = this.prisma.forTenant(workspaceId);
    const [rows, floor] = await Promise.all([
      db.officeMarker.findMany({ take: MAX_MARKERS, orderBy: { createdAt: 'asc' } }),
      db.floorAsset.findFirst({ where: { status: 'published' }, orderBy: { version: 'desc' }, select: { seatMap: true } }),
    ]);
    const seat = floor?.seatMap ? SeatMapSchema.safeParse(floor.seatMap) : null;
    const zones = seat?.success ? seat.data.zones : [];
    const names = new Map<string, string>(zones.map((z) => [z.id, z.name]));
    for (const r of rows) if (!names.has(r.zoneId)) names.set(r.zoneId, r.label);
    const catalog: Catalog = {
      at: now,
      markers: rows.map((r) => ({
        kind: r.kind as MarkerRef['kind'],
        zoneId: r.zoneId,
        beacon: r.beaconUuid !== null && r.beaconMajor !== null && r.beaconMinor !== null ? { uuid: r.beaconUuid, major: r.beaconMajor, minor: r.beaconMinor } : null,
        bssid: r.bssid,
      })),
      names,
      seatZones: zones.length ? new Set(zones.map((z) => z.id)) : null,
    };
    if (this.catalogs.size > 2_000) this.catalogs.clear();
    this.catalogs.set(workspaceId, catalog);
    return catalog;
  }

  async zoneNames(workspaceId: string): Promise<(zoneId: string) => string | null> {
    const c = await this.catalog(workspaceId);
    return (id) => c.names.get(id) ?? null;
  }

  /**
   * Observations of one signal. Throws for an unknown QR / NFC token (404, same answer for another
   * company's token) and for a manual zone that is neither on the published floor nor marked.
   */
  async observe(workspaceId: string, signal: ZoneSignal, now = Date.now()): Promise<ZoneObservation[]> {
    const at = Math.min(Date.parse(signal.at), now);
    const catalog = await this.catalog(workspaceId);
    if (signal.source === 'qr' || signal.source === 'nfc') {
      if (!signal.markerToken) throw new AppException('VALIDATION_FAILED', 'Send the scanned code', { details: [{ path: 'markerToken', message: 'Required for qr and nfc' }] });
      const row = await this.prisma.forTenant(workspaceId).officeMarker.findFirst({ where: { tokenHash: hashMarkerToken(signal.markerToken.trim()) }, select: { zoneId: true, kind: true } });
      if (!row || (row.kind !== 'qr' && row.kind !== 'nfc')) throw notFound('Marker');
      return resolveSignal({ source: signal.source, at, zoneId: row.zoneId }, catalog.markers);
    }
    if (signal.source === 'manual') {
      const zoneId = signal.zoneId ?? null;
      if (zoneId !== null && !catalog.names.has(zoneId)) {
        throw new AppException('VALIDATION_FAILED', 'Pick a zone of your office', { details: [{ path: 'zoneId', message: `Unknown zone "${zoneId}"` }] });
      }
      return resolveSignal({ source: 'manual', at, zoneId }, catalog.markers);
    }
    return resolveSignal({ source: signal.source, at, beacons: signal.beacons, wifi: signal.wifi }, catalog.markers);
  }

  /** Test helper. */
  invalidate(workspaceId: string): void {
    this.catalogs.delete(workspaceId);
  }
}
