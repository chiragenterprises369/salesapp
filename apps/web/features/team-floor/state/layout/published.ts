'use client';

import { FloorPlanSchema, seatMapFromPlan, type FloorModelFormat, type FloorPlan, type SeatMap, type TeamFloorLayout } from '@vistar/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { isMockData } from '@/lib/api/data-source';
import { qaEnabled } from '../env';
import { loadTemplate, resolveTemplateId, type FloorTemplate, type TemplateId } from '../template';
import { templateFromModel, templateFromPlan, type PublishedMeta } from './plan-template';

/**
 * Loading the company's floor (SPEC 29.5, D-061). GET /team-floor/layout says whether a custom floor
 * is published; its model URL is signed for 15 minutes, so the file is downloaded once per version and
 * seat map and the template is cached in memory (the URL is never stored). No three.js here: the
 * GLB / glTF bytes are only fetched; the lazily loaded scene parses them (scene/model-office.ts).
 */

export const TEAM_FLOOR_LAYOUT_KEY = ['team-floor', 'layout'] as const;

/** Mock data mode (automated tests only): no custom floor, no request. */
const MOCK_LAYOUT: TeamFloorLayout = { source: 'template', templateId: 'medium', floorAssetId: null, version: null, floor: null, request: null };

export function fetchTeamFloorLayout(signal?: AbortSignal): Promise<TeamFloorLayout> {
  if (isMockData()) return Promise.resolve(MOCK_LAYOUT);
  return api.call('teamFloorLayout', { signal });
}

/** GET /team-floor/layout (published floor, default template, latest request status). */
export function useTeamFloorLayout(enabled = true) {
  return useQuery({
    queryKey: TEAM_FLOOR_LAYOUT_KEY,
    queryFn: ({ signal }) => fetchTeamFloorLayout(signal),
    enabled,
    staleTime: 60_000,
  });
}

/** A floor version to draw: the published one (layout) or any version in the Super Admin preview. */
export interface PublishedFloorInput {
  id: string;
  version: number;
  format: FloorModelFormat;
  /** Signed URL (15 min). */
  modelUrl: string;
  seatMap: SeatMap;
}

const templates = new Map<string, Promise<FloorTemplate>>();
const bytes = new Map<string, ArrayBuffer>();
const plans = new Map<string, Promise<FloorPlan>>();
const CACHE_MAX = 6;

function remember<V>(map: Map<string, V>, key: string, value: V) {
  if (map.size >= CACHE_MAX) {
    const first = map.keys().next().value;
    if (first !== undefined) map.delete(first);
  }
  map.set(key, value);
}

/** Short stable hash (FNV-1a) of a string, base 36. */
export function hashString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function floorKey(floorId: string, version: number, seatMap: SeatMap): string {
  return `${floorId}:${version}:${hashString(JSON.stringify(seatMap))}`;
}

async function download(url: string): Promise<Response> {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`The floor file did not download (${res.status})`);
  return res;
}

/** The floor plan of a layout_json version (validated again in the browser), cached per floor id + version. */
export function fetchFloorPlan(floorId: string, version: number, url: string): Promise<FloorPlan> {
  const key = `${floorId}:${version}`;
  let p = plans.get(key);
  if (!p) {
    p = download(url)
      .then((r) => r.json())
      .then((json: unknown) => FloorPlanSchema.parse(json));
    p.catch(() => plans.delete(key));
    remember(plans, key, p);
  }
  return p;
}

/** GLB / zipped glTF bytes of a template (set while loading it; read by the 3D scene). */
export function customModelBytes(key: string): ArrayBuffer | null {
  return bytes.get(key) ?? null;
}

export function setCustomModelBytes(key: string, data: ArrayBuffer) {
  remember(bytes, key, data);
}

/** Downloads a GLB / zip once per floor version (the Super Admin seat tool previews unsaved seat maps). */
const modelDownloads = new Map<string, Promise<ArrayBuffer>>();
export function fetchModelBytes(floorId: string, version: number, url: string): Promise<ArrayBuffer> {
  const key = `${floorId}:${version}`;
  let p = modelDownloads.get(key);
  if (!p) {
    p = download(url).then((r) => r.arrayBuffer());
    p.catch(() => modelDownloads.delete(key));
    remember(modelDownloads, key, p);
  }
  return p;
}

/** Template for a floor version and seat map (plan -> module kit; GLB / glTF -> model + seat map). */
export async function templateForFloor(floor: PublishedFloorInput, seatMap: SeatMap = floor.seatMap): Promise<FloorTemplate> {
  const meta: PublishedMeta = { key: floorKey(floor.id, floor.version, seatMap), floorId: floor.id, version: floor.version };
  if (floor.format === 'layout_json') {
    const plan = await fetchFloorPlan(floor.id, floor.version, floor.modelUrl);
    return templateFromPlan(plan, seatMap, meta);
  }
  const data = await fetchModelBytes(floor.id, floor.version, floor.modelUrl);
  setCustomModelBytes(meta.key, data);
  return templateFromModel(seatMap, { ...meta, format: floor.format });
}

/** Cached template of a published floor (one download per version and seat map). */
export function loadPublishedTemplate(floor: PublishedFloorInput): Promise<FloorTemplate> {
  const key = floorKey(floor.id, floor.version, floor.seatMap);
  let p = templates.get(key);
  if (!p) {
    p = templateForFloor(floor);
    p.catch(() => templates.delete(key));
    remember(templates, key, p);
  }
  return p;
}

/** QA only (dev, or `vistar.floor.qa`): `?floorPlan=/team-floor/samples/<file>.json` previews a plan without the API. */
function qaPlanPath(): string | null {
  if (!qaEnabled()) return null;
  const v = new URLSearchParams(window.location.search).get('floorPlan');
  return v && /^\/team-floor\/[\w./-]+\.json$/.test(v) && !v.includes('..') ? v : null;
}

async function loadQaPlan(path: string): Promise<FloorTemplate> {
  const plan = FloorPlanSchema.parse(await (await download(path)).json());
  const seatMap = seatMapFromPlan(plan);
  return templateFromPlan(plan, seatMap, { key: `qa:${path}:${hashString(JSON.stringify(seatMap))}`, floorId: null, version: null });
}

/**
 * The floor template of this workspace for the live Team Floor: the published custom floor in API
 * mode, else the default template for the head count (<= 8 small, <= 20 medium, else large).
 * `override` (dev and screenshots) and mock data mode always use a default template. A custom floor
 * that fails to load falls back to the default template (logged), so the floor never stays blank.
 */
export async function loadWorkspaceFloor(people: number, override: TemplateId | null = null): Promise<FloorTemplate> {
  const qa = qaPlanPath();
  if (qa) {
    try {
      return await loadQaPlan(qa);
    } catch (e) {
      console.warn('[team-floor] QA floor plan failed', e);
    }
  }
  if (override || isMockData()) return loadTemplate(resolveTemplateId(people, override));
  try {
    const layout = await fetchTeamFloorLayout();
    if (layout.floor) return await loadPublishedTemplate(layout.floor);
  } catch (e) {
    console.warn('[team-floor] the published floor did not load; showing the default template', e);
  }
  return loadTemplate(resolveTemplateId(people, null));
}
