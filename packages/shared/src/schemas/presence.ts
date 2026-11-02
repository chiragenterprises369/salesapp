import { z } from 'zod';
import {
  AppScreenSchema,
  ClientKindSchema,
  EmployeeStatusSchema,
  ManualPresenceStatusSchema,
  OfficeMarkerKindSchema,
  PresenceSourceSchema,
  PresenceStatusSchema,
  ZoneSignalSourceSchema,
} from '../enums.js';
import { IdSchema, IsoDateSchema, IsoDateTimeSchema } from './common.js';

/**
 * LIVE STATUS CONTRACT (D-062, SPEC 29.2). Owner of the engine: realtime stream.
 *
 * The server decides the status from observed facts only: sessions (login/logout), heartbeats (web or app
 * open), phone state (POST /me/calls/active from the Android app), call results (device call log,
 * telephony), the employee's own status (PUT /me/status), attendance check-in and working hours.
 * Precedence (highest first): on_call (live call) > manual status (in_meeting, on_break, lunch, field_visit,
 * away, offline) > available (heartbeat within PRESENCE_TIMEOUT_MS) > offline (no heartbeat for 45 s).
 * A call ending restores the previous manual status, otherwise available.
 * Known limits shown in the UI: physical presence at a desk is not observable; outgoing SIM calls are
 * "on call" from dialing (Android does not report the answer), talk time comes from the call log afterwards.
 *
 * Current state: Presence (one row per user). History: PresenceEvent. User.status keeps the coarse
 * EmployeeStatus (presenceToEmployeeStatus) for existing consumers.
 *
 * WHERE in the office (room / zone level, not x-y): the Android app reports zone signals (POST
 * /me/presence/zone, or `zone` on a heartbeat): BLE beacons (best: about 1-3 m, one cheap beacon per room),
 * Wi-Fi access points (room to floor level; Android throttles scans to 4 per 2 min), a QR or NFC marker
 * scanned at a room door (exact, manual), or a manual pick. The server maps signals to the seat-map zones
 * through OfficeMarker rows (company admin, /team-floor/markers) and keeps the zone with a confidence.
 * WHAT they are doing: status + call + the screen the web or app has open (`screen` on heartbeats).
 * The web employee panel and the app both send heartbeats; the newest signal wins per field.
 */

export const PresenceActivitySchema = z.object({
  callId: IdSchema.nullable(),
  callStartedAt: IsoDateTimeSchema.nullable(),
  leadId: IdSchema.nullable(),
  leadName: z.string().nullable(),
  /** Last client that sent a heartbeat and what it reported. */
  client: ClientKindSchema.nullable(),
  clientActivity: z.enum(['active', 'idle', 'hidden']).nullable(),
  /** Optional note the employee added to a manual status, e.g. "Client visit, Andheri". */
  note: z.string().nullable(),
  /** Screen the client has open (last heartbeat). */
  screen: AppScreenSchema.nullable().optional(),
});
export type PresenceActivity = z.infer<typeof PresenceActivitySchema>;

export const PresenceSchema = z.object({
  userId: IdSchema,
  status: PresenceStatusSchema,
  /** Per-user change counter (+1 per status change). Clients ignore events whose version is not above the one they hold. */
  version: z.number().int().min(0),
  /** Coarse status on User / UserSummary (presenceToEmployeeStatus). */
  employeeStatus: EmployeeStatusSchema,
  source: PresenceSourceSchema,
  since: IsoDateTimeSchema,
  manualStatus: ManualPresenceStatusSchema.nullable(),
  lastHeartbeatAt: IsoDateTimeSchema.nullable(),
  /** Last observed activity of any kind (heartbeat, call, check-in); shown as "last seen". */
  lastSeenAt: IsoDateTimeSchema.nullable(),
  activity: PresenceActivitySchema,
  /** Room / zone in the office (seat-map zone id); null when unknown or outside. */
  location: z
    .object({
      zoneId: z.string().nullable(),
      zoneName: z.string().nullable(),
      source: ZoneSignalSourceSchema,
      /** 0..1 (BLE strong signal ~0.9, Wi-Fi ~0.6, QR/NFC 1, manual 0.8); decays when the signal is old. */
      confidence: z.number().min(0).max(1),
      since: IsoDateTimeSchema,
      at: IsoDateTimeSchema.describe('Last signal'),
    })
    .nullable()
    .optional(),
});
export type Presence = z.infer<typeof PresenceSchema>;

/** One observation of where the phone is (raw; the server maps it to a zone). */
export const ZoneSignalSchema = z.object({
  source: ZoneSignalSourceSchema,
  at: IsoDateTimeSchema,
  beacons: z
    .array(z.object({ uuid: z.uuid(), major: z.number().int().min(0).max(65_535), minor: z.number().int().min(0).max(65_535), rssi: z.number().int().min(-127).max(0) }))
    .max(30)
    .optional(),
  wifi: z.array(z.object({ bssid: z.string().regex(/^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/), rssi: z.number().int().min(-127).max(0) })).max(40).optional(),
  /** Token read from a QR code or NFC tag (OfficeMarker.token). */
  markerToken: z.string().min(16).max(300).optional(),
  /** source manual: the zone the employee picked. */
  zoneId: z.string().max(40).optional(),
});
export type ZoneSignal = z.infer<typeof ZoneSignalSchema>;

/** A beacon, access point, QR code or NFC tag that marks a zone of the published floor. */
export const OfficeMarkerSchema = z.object({
  id: IdSchema,
  kind: OfficeMarkerKindSchema,
  zoneId: z.string(),
  label: z.string(),
  beacon: z.object({ uuid: z.uuid(), major: z.number().int(), minor: z.number().int() }).nullable(),
  bssid: z.string().nullable(),
  /** qr / nfc only, returned once at creation: print it as a QR code or write it to the tag. */
  token: z.string().optional(),
  createdAt: IsoDateTimeSchema,
});
export type OfficeMarker = z.infer<typeof OfficeMarkerSchema>;

export const OfficeMarkerCreateSchema = z
  .object({
    kind: OfficeMarkerKindSchema,
    zoneId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).describe('Zone id of the published seat map'),
    label: z.string().trim().min(1).max(60),
    beacon: z.object({ uuid: z.uuid(), major: z.number().int().min(0).max(65_535), minor: z.number().int().min(0).max(65_535) }).optional(),
    bssid: z.string().regex(/^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/).optional(),
  })
  .refine((m) => (m.kind === 'ble_beacon' ? !!m.beacon : m.kind === 'wifi_ap' ? !!m.bssid : true), { error: 'Beacons need uuid/major/minor, access points a BSSID' });

export const MyPresenceSchema = PresenceSchema.extend({
  heartbeatIntervalSec: z.number().int(),
  timeoutSec: z.number().int(),
  insideWorkingHours: z.boolean(),
});
export type MyPresence = z.infer<typeof MyPresenceSchema>;

/** POST /me/presence/heartbeat (also accepted over the socket as `presence.heartbeat`). */
export const PresenceHeartbeatSchema = z.object({
  client: ClientKindSchema,
  activity: z.enum(['active', 'idle', 'hidden']),
  currentLeadId: IdSchema.nullable().optional(),
  /** Android: whether the app is in the foreground. */
  appState: z.enum(['foreground', 'background']).optional(),
  /** Device id (POST /me/devices id or installation id); the web may omit it. */
  deviceId: z.string().max(64).optional(),
  /** Screen the user has open. */
  screen: AppScreenSchema.optional(),
  /** Latest zone observation (Android app). */
  zone: ZoneSignalSchema.optional(),
});
export type PresenceHeartbeat = z.infer<typeof PresenceHeartbeatSchema>;

export const PresenceEventSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  version: z.number().int().min(0),
  status: PresenceStatusSchema,
  previousStatus: PresenceStatusSchema.nullable(),
  source: PresenceSourceSchema,
  callId: IdSchema.nullable(),
  at: IsoDateTimeSchema,
});
export type PresenceEvent = z.infer<typeof PresenceEventSchema>;

export const PresenceHistoryQuerySchema = z.object({
  date: IsoDateSchema.optional().describe('Workspace-timezone day; default today'),
});

/** Per-person live details on the Team Floor snapshot (TeamFloorEmployee.presence). */
export const TeamFloorPresenceSchema = PresenceSchema.omit({ userId: true }).extend({
  /** Seat id on the published custom floor (FloorSeat.id); null on the default template (use deskIndex). */
  seatId: z.string().nullable(),
  isFieldStaff: z.boolean(),
  checkedIn: z.boolean(),
});
export type TeamFloorPresence = z.infer<typeof TeamFloorPresenceSchema>;
