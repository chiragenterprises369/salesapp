import { describe, expect, it } from 'vitest';
import { API_ROUTES, type RouteDef } from '../api/routes.js';
import { buildOpenApiDocument } from '../api/openapi.js';
import { BRAND_SURFACES, contrastRatio, ensureContrast, resolveBrandColors, resolveChartPalette } from '../branding.js';
import { MANUAL_PRESENCE_STATUSES, PRESENCE_STATUSES, presenceToEmployeeStatus } from '../enums.js';
import { ERROR_HTTP_STATUS, ErrorCode } from '../errors.js';
import { eventPayloadSchemas, PRESENCE_TIMEOUT_MS } from '../events.js';
import { FEATURE_FLAGS } from '../rbac.js';
import {
  ANDROID_PACKAGE_NAME,
  AndroidReleaseUploadFieldsSchema,
  AppConfigSchema,
  DeviceRegisterSchema,
  maskServiceAccountEmail,
  parseGoogleServicesJson,
  parseServiceAccountJson,
} from '../schemas/app-platform.js';
import { isWithinWorkingHours, LocationBatchSchema, MyAttendanceTodaySchema, workingSlotsAt } from '../schemas/attendance.js';
import { BrandingUpdateSchema, CustomDomainSetSchema, HostnameSchema } from '../schemas/branding.js';
import { ActiveCallEventSchema, CallSchema, DeviceCallLogBatchSchema } from '../schemas/call.js';
import { defaultFloorTemplateFor, FloorRequestCreateSchema, FloorRequestStatusChangeSchema, floorRequestImageProblems, SeatMapSchema } from '../schemas/floor.js';
import { MyPresenceSchema } from '../schemas/presence.js';
import { UPLOAD_LIMITS, WORKSPACE_UPLOAD_PURPOSES } from '../schemas/storage.js';
import { DEFAULT_BUSINESS_HOURS, SETTING_KEYS, StatusUpdateSchema, UserSchema, WorkspaceSchema, WorkspaceUpdateSchema } from '../schemas/workspace.js';

const UUID = '0190f5a0-0000-7000-8000-000000000001';
const NOW = '2026-11-02T10:00:00.000Z';

const googleServices = (pkg = ANDROID_PACKAGE_NAME) => ({
  project_info: { project_number: '123456789012', project_id: 'vistar-crm-prod', storage_bucket: 'vistar-crm-prod.appspot.com' },
  client: [
    {
      client_info: { mobilesdk_app_id: '1:123456789012:android:0a1b2c3d4e5f6a7b', android_client_info: { package_name: pkg } },
      api_key: [{ current_key: `AIza${'x'.repeat(35)}` }],
    },
  ],
  configuration_version: '1',
});

describe('brand colour contrast guard (D-060)', () => {
  it('keeps colours that already reach 3:1 on both surfaces', () => {
    const r = resolveBrandColors('#4F46E5');
    expect(r.light).toBe('#4F46E5');
    expect(contrastRatio(r.light, BRAND_SURFACES.light)).toBeGreaterThanOrEqual(3);
  });

  it('darkens a pale colour for light surfaces and lightens a dark one for dark surfaces', () => {
    const pale = ensureContrast('#FFE680', BRAND_SURFACES.light);
    expect(pale.adjusted).toBe(true);
    expect(pale.ratio).toBeGreaterThanOrEqual(3);
    const navy = ensureContrast('#1E1B4B', BRAND_SURFACES.dark);
    expect(navy.adjusted).toBe(true);
    expect(contrastRatio(navy.color, BRAND_SURFACES.dark)).toBeGreaterThanOrEqual(3);
  });

  it('reaches 3:1 for every colour on both surfaces, including white and black', () => {
    for (const c of ['#FFFFFF', '#000000', '#777777', '#00FF00', '#FF0000', '#171A21', '#FACC15']) {
      const r = resolveBrandColors(c);
      expect(contrastRatio(r.light, BRAND_SURFACES.light), c).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(r.dark, BRAND_SURFACES.dark), c).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(r.lightForeground, r.light)).toBeGreaterThanOrEqual(3);
    }
  });

  it('resolves a 6-colour chart palette and reports adjusted indexes', () => {
    const p = resolveChartPalette(['#4F46E5', '#FFFF00', '#10B981', '#000000', '#F59E0B', '#EC4899']);
    expect(p.light).toHaveLength(6);
    expect(p.adjusted).toContain(1);
    expect(p.adjusted).toContain(3);
  });
});

describe('Firebase files (D-058)', () => {
  it('parses google-services.json for the employee app', () => {
    const r = parseGoogleServicesJson(JSON.stringify(googleServices()));
    expect(r).toEqual({
      ok: true,
      value: { projectId: 'vistar-crm-prod', messagingSenderId: '123456789012', appId: '1:123456789012:android:0a1b2c3d4e5f6a7b', apiKey: `AIza${'x'.repeat(35)}`, storageBucket: 'vistar-crm-prod.appspot.com', packageName: ANDROID_PACKAGE_NAME },
    });
  });

  it('rejects another package, broken JSON and a service account file', () => {
    const other = parseGoogleServicesJson(googleServices('com.example.other'));
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.errors[0]).toContain('com.example.other');
    expect(parseGoogleServicesJson('{not json').ok).toBe(false);
    expect(parseGoogleServicesJson({ type: 'service_account' }).ok).toBe(false);
  });

  it('rejects an app id from another project', () => {
    const file = googleServices();
    file.client[0]!.client_info.mobilesdk_app_id = '1:999999999999:android:0a1b2c3d4e5f6a7b';
    const r = parseGoogleServicesJson(file);
    expect(r.ok).toBe(false);
  });

  it('parses a service account key and masks the email', () => {
    const r = parseServiceAccountJson({
      type: 'service_account',
      project_id: 'vistar-crm-prod',
      private_key_id: 'abcdef0123456789',
      private_key: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n',
      client_email: 'firebase-adminsdk-x1@vistar-crm-prod.iam.gserviceaccount.com',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(maskServiceAccountEmail(r.value.clientEmail)).toBe('fir***@vistar-crm-prod.iam.gserviceaccount.com');
    expect(parseServiceAccountJson(googleServices()).ok).toBe(false);
  });

  it('APK upload fields coerce multipart strings', () => {
    expect(AndroidReleaseUploadFieldsSchema.parse({ versionName: '1.4.0', versionCode: '14', minSupported: 'true' })).toMatchObject({ versionCode: 14, minSupported: true });
    expect(AndroidReleaseUploadFieldsSchema.safeParse({ versionName: 'v1', versionCode: '0' }).success).toBe(false);
  });

  it('app config shape', () => {
    expect(
      AppConfigSchema.safeParse({ firebase: null, android: { packageName: ANDROID_PACKAGE_NAME, latest: null, minSupportedVersionCode: null }, serverTime: NOW }).success,
    ).toBe(true);
    expect(DeviceRegisterSchema.safeParse({ platform: 'android', installationId: 'install-1234', fcmToken: null, appVersion: '1.0.0' }).success).toBe(true);
  });
});

describe('workspace appearance and domains', () => {
  it('component style and branding default on the workspace response', () => {
    const ws = WorkspaceSchema.parse({
      id: UUID, name: 'A', slug: 'a', status: 'active', timezone: 'Asia/Kolkata', currency: 'INR', businessHours: DEFAULT_BUSINESS_HOURS, holidays: [], plan: 'free',
      logoUrl: null, accentColor: null, defaultTheme: 'system', defaultLeadsViewMode: null, showEmployeeRank: true,
      supportAccess: { until: null, includeContent: false }, features: Object.fromEntries(FEATURE_FLAGS.map((f) => [f, false])), createdAt: NOW,
    });
    expect(ws.componentStyle).toBe('standard');
    expect(ws.branding.brandColor).toBeNull();
    expect(SETTING_KEYS.workspace.componentStyle).toBe('ui.componentStyle');
    expect(Object.values(SETTING_KEYS.workspace).filter((k) => k.startsWith('branding.'))).toHaveLength(7);
  });

  it('PATCH bodies do not re-apply defaults', () => {
    expect(WorkspaceUpdateSchema.parse({ name: 'X' })).toEqual({ name: 'X' });
    expect(WorkspaceUpdateSchema.safeParse({ componentStyle: 'fancy' }).success).toBe(false);
    expect(BrandingUpdateSchema.parse({ brandColor: null })).toEqual({ brandColor: null });
    expect(BrandingUpdateSchema.safeParse({ chartPalette: ['#000000'] }).success).toBe(false);
  });

  it('hostnames: lower-cased, *.localhost allowed, junk rejected', () => {
    expect(CustomDomainSetSchema.parse({ hostname: ' CRM.Acme.com ' })).toEqual({ hostname: 'crm.acme.com' });
    expect(HostnameSchema.safeParse('crm.acme.localhost').success).toBe(true);
    for (const bad of ['acme', 'http://acme.com', '-x.acme.com', 'acme..com', 'a_b.acme.com']) expect(HostnameSchema.safeParse(bad).success, bad).toBe(false);
  });

  it('users carry isFieldStaff (default false)', () => {
    const u = UserSchema.parse({
      id: UUID, name: 'A', role: 'employee', status: 'idle', avatar: null, workspaceId: UUID, email: 'a@x.in', phone: null, title: null, roleId: UUID, roleName: 'Employee',
      teamId: null, isActive: true, workingHours: null, statusChangedAt: null, lastSeenAt: null, createdAt: NOW,
    });
    expect(u.isFieldStaff).toBe(false);
  });
});

describe('presence and calls (D-062, D-057)', () => {
  it('every presence maps to a coarse status; on_call is never manual', () => {
    for (const s of PRESENCE_STATUSES) expect(presenceToEmployeeStatus(s)).toBeTruthy();
    expect(MANUAL_PRESENCE_STATUSES).not.toContain('on_call');
    expect(StatusUpdateSchema.safeParse({ status: 'on_call' }).success).toBe(false);
    expect(StatusUpdateSchema.parse({ status: 'idle' }).status).toBe('idle');
    expect(StatusUpdateSchema.parse({ status: 'lunch', note: 'Back at 2' }).status).toBe('lunch');
    expect(PRESENCE_TIMEOUT_MS).toBe(45_000);
  });

  it('my presence shape', () => {
    const activity = { callId: null, callStartedAt: null, leadId: null, leadName: null, client: 'android', clientActivity: 'active', note: null };
    expect(
      MyPresenceSchema.safeParse({ userId: UUID, status: 'available', employeeStatus: 'idle', source: 'heartbeat', since: NOW, manualStatus: null, lastHeartbeatAt: NOW, lastSeenAt: NOW, activity, heartbeatIntervalSec: 15, timeoutSec: 45, insideWorkingHours: true }).success,
    ).toBe(true);
    expect(eventPayloadSchemas['employee.status_changed'].safeParse({ userId: UUID, status: 'busy', previousStatus: 'idle', currentLeadId: null, callId: null, at: NOW, presence: 'in_meeting', source: 'manual' }).success).toBe(true);
  });

  it('device call log batches and live call events', () => {
    const entry = { deviceCallId: '4711', direction: 'outbound', phone: '098765 43210', startedAt: NOW, durationSec: 63, result: 'connected' };
    expect(DeviceCallLogBatchSchema.safeParse({ entries: [entry] }).success).toBe(true);
    expect(DeviceCallLogBatchSchema.safeParse({ entries: [] }).success).toBe(false);
    expect(DeviceCallLogBatchSchema.safeParse({ entries: Array.from({ length: 201 }, () => entry) }).success).toBe(false);
    expect(ActiveCallEventSchema.safeParse({ event: 'started', clientCallId: 'c-12345678', direction: 'outbound', phone: '+919876543210', startedAt: NOW }).success).toBe(true);
    expect(ActiveCallEventSchema.safeParse({ event: 'ended', clientCallId: 'c-12345678', endedAt: NOW }).success).toBe(true);
    expect(ActiveCallEventSchema.safeParse({ event: 'answered', clientCallId: 'c-12345678' }).success).toBe(false);
  });

  it('calls expose source, result, phone and allow an unknown own number', () => {
    const call = {
      id: UUID, direction: 'outbound', status: 'completed', outcome: null, leadId: null, leadName: null, user: null, from: '', to: '+919876543210', startedAt: NOW, answeredAt: null, endedAt: NOW,
      durationSec: 63, hasRecording: false, notes: null, disposition: null, provider: 'sim', customFields: {}, source: 'sim', result: 'connected', phone: '+919876543210', deviceCallId: '4711', recordingFileId: null,
    };
    expect(CallSchema.safeParse(call).success).toBe(true);
  });
});

describe('attendance and working hours (D-063)', () => {
  const hours = DEFAULT_BUSINESS_HOURS; // Mon-Fri 09:30-18:30, Sat 10:00-14:00, Sun closed
  it('uses the workspace timezone', () => {
    // 2026-11-02 is a Monday. 04:30Z = 10:00 IST (inside), 13:30Z = 19:00 IST (outside).
    expect(isWithinWorkingHours(hours, 'Asia/Kolkata', new Date('2026-11-02T04:30:00Z'))).toBe(true);
    expect(isWithinWorkingHours(hours, 'Asia/Kolkata', new Date('2026-11-02T13:30:00Z'))).toBe(false);
    expect(isWithinWorkingHours(hours, 'Asia/Kolkata', new Date('2026-11-02T03:59:00Z'))).toBe(false);
    // Sunday closed
    expect(isWithinWorkingHours(hours, 'Asia/Kolkata', new Date('2026-11-01T06:00:00Z'))).toBe(false);
  });

  it('holidays are closed', () => {
    const at = new Date('2026-11-02T06:00:00Z');
    expect(isWithinWorkingHours(hours, 'Asia/Kolkata', at, [{ date: '2026-11-02' }])).toBe(false);
    expect(workingSlotsAt(hours, 'Asia/Kolkata', at)).toMatchObject({ date: '2026-11-02', weekday: 'mon', holiday: false });
  });

  it('location batches are bounded', () => {
    const p = { lat: 19.07, lng: 72.87, accuracy: 12, at: NOW };
    expect(LocationBatchSchema.safeParse({ points: [p] }).success).toBe(true);
    expect(LocationBatchSchema.safeParse({ points: [{ ...p, lat: 91 }] }).success).toBe(false);
    expect(LocationBatchSchema.safeParse({ points: Array.from({ length: 501 }, () => p) }).success).toBe(false);
    expect(MyAttendanceTodaySchema.shape.locationIntervalSec).toBeTruthy();
  });
});

describe('custom floors (D-061)', () => {
  it('reference image rules', () => {
    expect(floorRequestImageProblems(['work_area', 'cabin', 'reception'])).toEqual([]);
    expect(floorRequestImageProblems(['work_area', 'meeting_room', 'other'])).toEqual([]);
    expect(floorRequestImageProblems(['work_area', 'cabin'])).toHaveLength(1);
    expect(floorRequestImageProblems(['reception', 'reception', 'pantry_lounge'])).toHaveLength(2);
    expect(FloorRequestCreateSchema.safeParse({ headcount: 12, images: [{ fileId: UUID, category: 'work_area' }] }).success).toBe(true);
    expect(FloorRequestStatusChangeSchema.safeParse({ status: 'rejected' }).success).toBe(false);
    expect(FloorRequestStatusChangeSchema.safeParse({ status: 'rejected', note: 'Photos are too dark' }).success).toBe(true);
  });

  it('seat maps: unique ids and known zones', () => {
    const base = { schemaVersion: 1, units: 'm', scale: 1, origin: [0, 0, 0], zones: [{ id: 'floor', name: 'Floor', kind: 'work_area', polygon: [[0, 0], [10, 0], [10, 8]] }] };
    const seat = (id: string, zoneId?: string) => ({ id, kind: 'desk', position: [1, 0, 2], rotation: 90, zoneId });
    expect(SeatMapSchema.safeParse({ ...base, seats: [seat('d1', 'floor'), seat('d2')] }).success).toBe(true);
    expect(SeatMapSchema.safeParse({ ...base, seats: [seat('d1'), seat('d1')] }).success).toBe(false);
    expect(SeatMapSchema.safeParse({ ...base, seats: [seat('d1', 'nowhere')] }).success).toBe(false);
    expect(SeatMapSchema.safeParse({ ...base, seats: [] }).success).toBe(false);
    expect(defaultFloorTemplateFor(5)).toBe('small');
    expect(defaultFloorTemplateFor(15)).toBe('medium');
    expect(defaultFloorTemplateFor(40)).toBe('large');
  });
});

describe('route contract (change #19)', () => {
  const routes = Object.entries(API_ROUTES) as Array<[string, RouteDef]>;
  const wave = routes.filter(([, r]) => r.phase === 19);

  it('every new route has an owner, and a response or a binary content type', () => {
    expect(wave.length).toBeGreaterThanOrEqual(50);
    for (const [id, r] of wave) {
      expect(['backend-core', 'realtime-integrations'], id).toContain(r.owner);
      expect(r.response !== null || !!r.responseContentType, id).toBe(true);
      if (r.absolute && r.path.startsWith('/api/super')) expect(r.auth, id).toBe('super');
      if (r.bodyFields) expect(r.bodyContentType, id).toBe('multipart/form-data');
    }
  });

  it('method + path pairs are unique', () => {
    const keys = routes.map(([, r]) => `${r.method} ${r.absolute ? r.path : `/api/v1${r.path}`}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('upload limits: floor models 40 MB, APKs 150 MB, workspace purposes are public or reference images', () => {
    expect(UPLOAD_LIMITS.floor_model.maxBytes).toBe(40 * 1024 * 1024);
    expect(UPLOAD_LIMITS.apk.maxBytes).toBe(150 * 1024 * 1024);
    for (const p of WORKSPACE_UPLOAD_PURPOSES) expect(UPLOAD_LIMITS[p].uploadedVia).toBe('workspace');
  });

  it('new error codes have HTTP statuses; flags include the switches', () => {
    for (const code of Object.values(ErrorCode)) expect(ERROR_HTTP_STATUS[code], code).toBeGreaterThanOrEqual(200);
    expect(FEATURE_FLAGS).toContain('custom_domain');
    expect(FEATURE_FLAGS).toContain('field_tracking');
  });

  it('OpenAPI builds with multipart fields', () => {
    const doc = buildOpenApiDocument();
    const upload = doc.paths?.['/api/super/android-releases']?.post as { requestBody: { content: Record<string, { schema: { properties: Record<string, unknown> } }> } };
    expect(Object.keys(upload.requestBody.content['multipart/form-data']!.schema.properties)).toEqual(expect.arrayContaining(['file', 'versionName', 'versionCode']));
  });
});

describe('AI-written floor plan (layout_json)', () => {
  const plan = {
    schemaVersion: 1,
    kind: 'vistar.floor-plan',
    name: 'Acme office',
    units: 'm',
    size: { width: 20, depth: 12 },
    rooms: [
      { id: 'floor', name: 'Sales floor', kind: 'work_area', polygon: [[0, 0], [14, 0], [14, 12], [0, 12]] },
      { id: 'cabin-1', name: 'Manager cabin', kind: 'cabin', polygon: [[14, 0], [20, 0], [20, 6], [14, 6]], walls: 'glass' },
    ],
    items: [{ kind: 'desk_pod_4', position: [4, 4], rotation: 0, roomId: 'floor' }],
    seats: [
      { id: 'd1', kind: 'desk', position: [3, 3], rotation: 180, roomId: 'floor' },
      { id: 'c1', kind: 'cabin', position: [17, 3], rotation: 90, roomId: 'cabin-1' },
    ],
  };

  it('parses with defaults and derives a valid seat map', async () => {
    const { FloorPlanSchema, seatMapFromPlan, FLOOR_PLAN_PROMPT } = await import('../schemas/floor.js');
    const parsed = FloorPlanSchema.parse(plan);
    expect(parsed.wallHeight).toBe(3);
    expect(parsed.rooms[0]!.walls).toBe('solid');
    const map = seatMapFromPlan(parsed);
    expect(SeatMapSchema.safeParse(map).success).toBe(true);
    expect(map.seats[1]).toMatchObject({ id: 'c1', position: [17, 0, 3], zoneId: 'cabin-1' });
    expect(FLOOR_PLAN_PROMPT).toContain('vistar.floor-plan');
    expect(FLOOR_PLAN_PROMPT).toContain('desk_pod_4');
  });

  it('rejects points outside the floor, unknown rooms and duplicate seats', async () => {
    const { FloorPlanSchema } = await import('../schemas/floor.js');
    expect(FloorPlanSchema.safeParse({ ...plan, seats: [{ ...plan.seats[0], position: [25, 3] }] }).success).toBe(false);
    expect(FloorPlanSchema.safeParse({ ...plan, seats: [{ ...plan.seats[0], roomId: 'nowhere' }] }).success).toBe(false);
    expect(FloorPlanSchema.safeParse({ ...plan, seats: [plan.seats[0], plan.seats[0]] }).success).toBe(false);
    expect(FloorPlanSchema.safeParse({ ...plan, kind: 'something-else' }).success).toBe(false);
  });
});
