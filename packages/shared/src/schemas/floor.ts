import { z } from 'zod';
import {
  FloorAssetStatusSchema,
  FloorImageCategorySchema,
  FloorModelFormatSchema,
  FloorRequestStatusSchema,
  FloorSeatKindSchema,
  type FloorImageCategory,
} from '../enums.js';
import { CursorPaginationQuerySchema, IdSchema, IsoDateTimeSchema, queryArray } from './common.js';
import { FileRefSchema } from './storage.js';

/**
 * CUSTOM TEAM FLOORS (D-061, SPEC 29.5).
 * 1. A company admin uploads reference images (POST /files purpose reference_image) and submits a floor
 *    request with them (POST /floor-requests). Rules (floorRequestImageProblems, 422 FLOOR_REQUEST_INCOMPLETE):
 *    at least 3 images, at least one work_area, and at least one cabin or meeting_room.
 * 2. The Super Admin sees the request (/api/super/floor-requests), builds the office with an AI tool outside
 *    Vistar, uploads the GLB or a zipped glTF for that company (POST /api/super/companies/{id}/floors), places
 *    seats and zones (PUT /api/super/floors/{id}/seat-map), previews and publishes it.
 * 3. GET /team-floor/layout returns the published floor (signed model URL + seat map) or the default template
 *    id with the request status ("your office is being prepared").
 */

export const FLOOR_REQUEST_MIN_IMAGES = 3;
export const FLOOR_REQUEST_MAX_IMAGES = 40;

/** Problems with a set of reference image categories ([] = complete). User-safe sentences. */
export function floorRequestImageProblems(categories: readonly FloorImageCategory[]): string[] {
  const problems: string[] = [];
  if (categories.length < FLOOR_REQUEST_MIN_IMAGES) problems.push(`Add at least ${FLOOR_REQUEST_MIN_IMAGES} photos of your office`);
  if (!categories.includes('work_area')) problems.push('Add at least one photo of the work area');
  if (!categories.includes('cabin') && !categories.includes('meeting_room')) problems.push('Add at least one photo of a cabin or a meeting room');
  return problems;
}

export const FloorRequestImageInputSchema = z.object({
  fileId: IdSchema.describe('A reference_image file of this workspace'),
  category: FloorImageCategorySchema,
  caption: z.string().trim().max(200).optional(),
});

export const FloorRequestCreateSchema = z.object({
  headcount: z.number().int().min(1).max(2000).describe('People who should get a seat'),
  notes: z.string().trim().max(4000).optional(),
  images: z.array(FloorRequestImageInputSchema).min(1).max(FLOOR_REQUEST_MAX_IMAGES),
});
export type FloorRequestCreate = z.infer<typeof FloorRequestCreateSchema>;

export const FloorRequestImageSchema = z.object({
  fileId: IdSchema,
  category: FloorImageCategorySchema,
  caption: z.string().nullable(),
  name: z.string(),
  mime: z.string(),
  size: z.number().int(),
  /** Signed URL (15 min) in detail responses; null in lists. */
  url: z.string().url().nullable(),
});
export type FloorRequestImage = z.infer<typeof FloorRequestImageSchema>;

export const FloorRequestSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  workspaceName: z.string(),
  status: FloorRequestStatusSchema,
  headcount: z.number().int(),
  notes: z.string().nullable(),
  /** Message from the Super Admin (why rejected, what is being prepared). */
  statusNote: z.string().nullable(),
  images: z.array(FloorRequestImageSchema),
  createdBy: z.object({ id: IdSchema, name: z.string() }).nullable(),
  submittedAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  publishedFloorId: IdSchema.nullable(),
});
export type FloorRequest = z.infer<typeof FloorRequestSchema>;

export const FloorRequestStatusChangeSchema = z
  .object({
    status: z.enum(['in_progress', 'rejected']),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.status !== 'rejected' || !!v.note, { error: 'Explain to the company why the request is rejected', path: ['note'] });

export const SuperFloorRequestListQuerySchema = CursorPaginationQuerySchema.extend({
  status: queryArray(FloorRequestStatusSchema),
  workspaceId: IdSchema.optional(),
});

// ---------------------------------------------------------------- seat map

export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const SlugIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

export const FloorSeatSchema = z.object({
  id: SlugIdSchema,
  kind: FloorSeatKindSchema,
  /** Seat position in model space (metres after `scale`), y up. */
  position: Vec3Schema,
  /** Yaw in degrees around +Y (direction the seated person faces). */
  rotation: z.number().min(-360).max(360),
  label: z.string().max(60).nullable().optional(),
  zoneId: SlugIdSchema.nullable().optional(),
  /** Fixed seat for one person (set later by the company); null = assigned in desk order. */
  assignedUserId: IdSchema.nullable().optional(),
});
export type FloorSeat = z.infer<typeof FloorSeatSchema>;

export const FLOOR_ZONE_KINDS = ['work_area', 'cabin', 'meeting_room', 'reception', 'pantry_lounge', 'other'] as const;

export const FloorZoneSchema = z.object({
  id: SlugIdSchema,
  name: z.string().min(1).max(60),
  kind: z.enum(FLOOR_ZONE_KINDS),
  /** Outline on the floor plane as [x, z] points (model metres), at least 3. */
  polygon: z.array(z.tuple([z.number(), z.number()])).min(3).max(64),
});
export type FloorZone = z.infer<typeof FloorZoneSchema>;

export const SeatMapSchema = z
  .object({
    schemaVersion: z.literal(1),
    units: z.literal('m'),
    /** Multiply model units by this to get metres. */
    scale: z.number().positive().max(1000),
    /** Model-space point placed at the scene origin. */
    origin: Vec3Schema,
    seats: z.array(FloorSeatSchema).min(1).max(500),
    zones: z.array(FloorZoneSchema).max(100),
    camera: z.object({ position: Vec3Schema, target: Vec3Schema }).nullable().optional(),
  })
  .superRefine((map, ctx) => {
    const seen = new Set<string>();
    map.seats.forEach((s, i) => {
      if (seen.has(s.id)) ctx.addIssue({ code: 'custom', message: `Seat id "${s.id}" is used twice`, path: ['seats', i, 'id'] });
      seen.add(s.id);
    });
    const zones = new Set<string>();
    map.zones.forEach((z, i) => {
      if (zones.has(z.id)) ctx.addIssue({ code: 'custom', message: `Zone id "${z.id}" is used twice`, path: ['zones', i, 'id'] });
      zones.add(z.id);
    });
    map.seats.forEach((s, i) => {
      if (s.zoneId && !zones.has(s.zoneId)) ctx.addIssue({ code: 'custom', message: `Unknown zone "${s.zoneId}"`, path: ['seats', i, 'zoneId'] });
    });
  });
export type SeatMap = z.infer<typeof SeatMapSchema>;

// ---------------------------------------------------------------- floor plan (format layout_json)

/** Furniture and fixtures the web module kit can draw (D-054 modules plus props). */
export const FLOOR_PLAN_ITEM_KINDS = [
  'desk',
  'desk_pod_4',
  'desk_pod_6',
  'manager_desk',
  'meeting_table',
  'phone_booth',
  'sofa',
  'armchair',
  'coffee_table',
  'reception_desk',
  'pantry_counter',
  'plant',
  'whiteboard',
  'printer',
  'tv_screen',
  'water_cooler',
  'shelf',
  'lead_hub',
] as const;
export const FloorPlanItemKindSchema = z.enum(FLOOR_PLAN_ITEM_KINDS);

const Pt = z.tuple([z.number(), z.number()]).describe('[x, z] in metres from the top-left corner (x right, z down)');
const Deg = z.number().min(-360).max(360);

/**
 * Vistar floor plan (format `layout_json`): a 2D plan the web turns into the 3D office. Designed to be
 * written by an AI chat from the reference photos (prompt: FLOOR_PLAN_PROMPT), then uploaded by the Super
 * Admin like a GLB. Its seats become the seat map automatically (seatMapFromPlan), so it can be published
 * right away; the seat tool can still adjust them.
 */
export const FloorPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('vistar.floor-plan'),
    name: z.string().min(1).max(80),
    units: z.literal('m'),
    size: z.object({ width: z.number().min(4).max(200), depth: z.number().min(4).max(200) }),
    wallHeight: z.number().min(2).max(6).default(3),
    floorMaterial: z.enum(['wood', 'carpet', 'tile', 'concrete']).default('wood'),
    rooms: z
      .array(
        z.object({
          id: SlugIdSchema,
          name: z.string().min(1).max(60),
          kind: z.enum(FLOOR_ZONE_KINDS),
          polygon: z.array(Pt).min(3).max(64),
          walls: z.enum(['solid', 'glass', 'none']).default('solid'),
          floorMaterial: z.enum(['wood', 'carpet', 'tile', 'concrete']).optional(),
        }),
      )
      .max(60),
    doors: z.array(z.object({ position: Pt, rotation: Deg, width: z.number().min(0.6).max(4).default(1) })).max(120).default([]),
    items: z.array(z.object({ kind: FloorPlanItemKindSchema, position: Pt, rotation: Deg.default(0), roomId: SlugIdSchema.optional() })).max(1500).default([]),
    seats: z.array(z.object({ id: SlugIdSchema, kind: FloorSeatKindSchema, position: Pt, rotation: Deg, roomId: SlugIdSchema.optional(), label: z.string().max(60).optional() })).min(1).max(500),
  })
  .superRefine((plan, ctx) => {
    const inside = ([x, z]: [number, number]) => x >= 0 && z >= 0 && x <= plan.size.width && z <= plan.size.depth;
    const rooms = new Set<string>();
    plan.rooms.forEach((r, i) => {
      if (rooms.has(r.id)) ctx.addIssue({ code: 'custom', message: `Room id "${r.id}" is used twice`, path: ['rooms', i, 'id'] });
      rooms.add(r.id);
      r.polygon.forEach((p, j) => {
        if (!inside(p)) ctx.addIssue({ code: 'custom', message: 'Point is outside the floor size', path: ['rooms', i, 'polygon', j] });
      });
    });
    const seats = new Set<string>();
    plan.seats.forEach((s, i) => {
      if (seats.has(s.id)) ctx.addIssue({ code: 'custom', message: `Seat id "${s.id}" is used twice`, path: ['seats', i, 'id'] });
      seats.add(s.id);
      if (!inside(s.position)) ctx.addIssue({ code: 'custom', message: 'Seat is outside the floor size', path: ['seats', i, 'position'] });
      if (s.roomId && !rooms.has(s.roomId)) ctx.addIssue({ code: 'custom', message: `Unknown room "${s.roomId}"`, path: ['seats', i, 'roomId'] });
    });
    plan.items.forEach((it, i) => {
      if (!inside(it.position)) ctx.addIssue({ code: 'custom', message: 'Item is outside the floor size', path: ['items', i, 'position'] });
      if (it.roomId && !rooms.has(it.roomId)) ctx.addIssue({ code: 'custom', message: `Unknown room "${it.roomId}"`, path: ['items', i, 'roomId'] });
    });
  });
export type FloorPlan = z.infer<typeof FloorPlanSchema>;

/** Seat map for a floor plan: plan metres = scene metres, origin at the plan's top-left corner, y = 0. */
export function seatMapFromPlan(plan: FloorPlan): SeatMap {
  return {
    schemaVersion: 1,
    units: 'm',
    scale: 1,
    origin: [0, 0, 0],
    seats: plan.seats.map((s) => ({ id: s.id, kind: s.kind, position: [s.position[0], 0, s.position[1]], rotation: s.rotation, label: s.label ?? null, zoneId: s.roomId ?? null })),
    zones: plan.rooms.map((r) => ({ id: r.id, name: r.name, kind: r.kind, polygon: r.polygon })),
    camera: { position: [plan.size.width / 2, Math.max(plan.size.width, plan.size.depth) * 0.9, plan.size.depth * 1.4], target: [plan.size.width / 2, 0, plan.size.depth / 2] },
  };
}

/**
 * Prompt the Super Admin pastes into an AI chat (e.g. Claude) together with the company's reference photos,
 * head count and notes. The reply is a single JSON file to upload as the floor model (.json).
 */
export const FLOOR_PLAN_PROMPT = `You are designing the office floor plan for a live sales team map.
Look at the attached office photos (work area, cabins, meeting rooms, reception, pantry or lounge, floor plan if any).
Return ONLY one JSON object, no prose, that follows this format exactly:
{
  "schemaVersion": 1, "kind": "vistar.floor-plan", "name": "<company> office", "units": "m",
  "size": { "width": <metres, x>, "depth": <metres, z> }, "wallHeight": 3, "floorMaterial": "wood|carpet|tile|concrete",
  "rooms": [ { "id": "work-area", "name": "Sales floor", "kind": "work_area|cabin|meeting_room|reception|pantry_lounge|other",
               "polygon": [[x,z],[x,z],[x,z],...], "walls": "solid|glass|none" } ],
  "doors": [ { "position": [x,z], "rotation": <degrees>, "width": 1 } ],
  "items": [ { "kind": "${FLOOR_PLAN_ITEM_KINDS.join('|')}", "position": [x,z], "rotation": <degrees>, "roomId": "<room id>" } ],
  "seats": [ { "id": "d1", "kind": "desk|cabin|meeting|lounge|reception", "position": [x,z], "rotation": <degrees the person faces>, "roomId": "<room id>", "label": "Desk 1" } ]
}
Rules: coordinates are metres from the top-left corner (x to the right, z downwards) and stay inside size;
ids use letters, digits, - or _; one seat per person who sits there (head count: {{headcount}}), cabins get kind "cabin",
meeting chairs "meeting"; keep 1.2 m walkways; match the real layout in the photos as closely as you can.
Company notes: {{notes}}`;

/** Multipart text fields of POST /api/super/companies/{id}/floors (field `file` = .glb or .zip with a .gltf). */
export const FloorUploadFieldsSchema = z.object({
  requestId: IdSchema.optional().describe('Floor request this file answers (sets it to in_progress)'),
  notes: z.string().trim().max(2000).optional(),
});

export const FloorAssetSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  requestId: IdSchema.nullable(),
  /** 1, 2, 3 ... per company. */
  version: z.number().int().min(1),
  status: FloorAssetStatusSchema,
  format: FloorModelFormatSchema,
  /** url = signed (15 min) in detail responses. */
  model: FileRefSchema,
  seatMap: SeatMapSchema.nullable(),
  seatCount: z.number().int(),
  notes: z.string().nullable(),
  uploadedBy: z.object({ id: IdSchema, name: z.string() }).nullable(),
  publishedAt: IsoDateTimeSchema.nullable(),
  publishedBy: z.object({ id: IdSchema, name: z.string() }).nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type FloorAsset = z.infer<typeof FloorAssetSchema>;

/** Default templates shipped with the web floor (SPEC 12.1). */
export const FLOOR_TEMPLATE_IDS = ['small', 'medium', 'large'] as const;
export const FloorTemplateIdSchema = z.enum(FLOOR_TEMPLATE_IDS);
export type FloorTemplateId = z.infer<typeof FloorTemplateIdSchema>;

/** Template for a head count: up to 8 small, up to 20 medium, else large. */
export function defaultFloorTemplateFor(headcount: number): FloorTemplateId {
  return headcount <= 8 ? 'small' : headcount <= 20 ? 'medium' : 'large';
}

/** Which floor a workspace shows (also on the Team Floor snapshot). */
export const TeamFloorRefSchema = z.object({
  source: z.enum(['custom', 'template']),
  templateId: FloorTemplateIdSchema.describe('Template to use when source = template (and as fallback)'),
  floorAssetId: IdSchema.nullable(),
  version: z.number().int().nullable(),
});
export type TeamFloorRef = z.infer<typeof TeamFloorRefSchema>;

/** GET /team-floor/layout. */
export const TeamFloorLayoutSchema = TeamFloorRefSchema.extend({
  floor: z
    .object({
      id: IdSchema,
      version: z.number().int(),
      format: FloorModelFormatSchema,
      modelUrl: z.string().url().describe('Signed, 15 min'),
      modelUrlExpiresAt: IsoDateTimeSchema,
      seatMap: SeatMapSchema,
      publishedAt: IsoDateTimeSchema,
    })
    .nullable(),
  /** Latest floor request of the company (status for the "being prepared" note); null = none yet. */
  request: z
    .object({ id: IdSchema, status: FloorRequestStatusSchema, statusNote: z.string().nullable(), submittedAt: IsoDateTimeSchema })
    .nullable(),
});
export type TeamFloorLayout = z.infer<typeof TeamFloorLayoutSchema>;
