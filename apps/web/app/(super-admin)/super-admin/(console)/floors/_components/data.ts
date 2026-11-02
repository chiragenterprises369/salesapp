'use client';

import {
  FLOOR_PLAN_PROMPT,
  FloorPlanSchema,
  UPLOAD_LIMITS,
  type Company,
  type FloorAsset,
  type FloorPlan,
  type FloorRequest,
  type FloorRequestStatus,
  type SeatMap,
} from '@vistar/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { superApi } from '@/lib/api/client';
import { isMockData, noteMockUse } from '@/lib/api/data-source';

/**
 * Super Admin > Floors (SPEC 29.5, 29.11; D-061) on the PLATFORM routes (/api/super, platform audience):
 * floor requests across companies, the company's floor versions, upload (GLB, zipped glTF or a Vistar
 * floor plan .json written by an AI chat), seat map, publish. Mock data mode (tests only): empty lists.
 */

export const K = {
  requests: (filters: object) => ['platform', 'floors', 'requests', filters] as const,
  request: (id: string) => ['platform', 'floors', 'request', id] as const,
  versions: (workspaceId: string) => ['platform', 'floors', 'versions', workspaceId] as const,
  version: (id: string) => ['platform', 'floors', 'version', id] as const,
  companies: ['platform', 'floors', 'companies'] as const,
};

const PAGE = 50;

export interface RequestFilters {
  status: FloorRequestStatus[];
  workspaceId: string | null;
}

export function useSuperFloorRequests(filters: RequestFilters) {
  return useInfiniteQuery({
    queryKey: K.requests(filters),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      if (isMockData()) {
        noteMockUse('super.floors');
        return { items: [] as FloorRequest[], nextCursor: null as string | null };
      }
      return superApi.call('superFloorRequestList', {
        query: {
          limit: PAGE,
          cursor: pageParam ?? undefined,
          status: filters.status.length ? filters.status : undefined,
          workspaceId: filters.workspaceId ?? undefined,
        },
        signal,
      });
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}

/** Companies for the filter and the "upload without a request" picker (first 100 by the API order). */
export function useSuperCompanies() {
  return useQuery({
    queryKey: K.companies,
    queryFn: async ({ signal }): Promise<Company[]> => {
      if (isMockData()) return [];
      return (await superApi.call('superCompanyList', { query: { limit: 100 }, signal })).items;
    },
    staleTime: 5 * 60_000,
  });
}

export function useSuperFloorRequest(id: string, enabled = true) {
  return useQuery({
    queryKey: K.request(id),
    queryFn: ({ signal }) => superApi.call('superFloorRequestGet', { params: { id }, signal }),
    // Photo URLs are signed for 15 minutes: refresh them before they expire.
    staleTime: 10 * 60_000,
    refetchInterval: 12 * 60_000,
    enabled: enabled && !!id && !isMockData(),
  });
}

export function useSetRequestStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { status: 'in_progress' | 'rejected'; note?: string }) =>
      superApi.call('superFloorRequestStatus', { params: { id }, body }),
    onSuccess: (r) => {
      qc.setQueryData(K.request(id), r);
      void qc.invalidateQueries({ queryKey: ['platform', 'floors', 'requests'] });
    },
  });
}

export function useCompanyFloors(workspaceId: string | null) {
  return useQuery({
    queryKey: K.versions(workspaceId ?? ''),
    queryFn: async ({ signal }): Promise<FloorAsset[]> =>
      (await superApi.call('superFloorList', { params: { id: workspaceId! }, signal })).items,
    enabled: !!workspaceId && !isMockData(),
    staleTime: 30_000,
  });
}

/** One version with a signed model URL (preview, seat tool). */
export function useFloorVersion(id: string) {
  return useQuery({
    queryKey: K.version(id),
    queryFn: ({ signal }) => superApi.call('superFloorGet', { params: { id }, signal }),
    staleTime: 10 * 60_000,
    refetchInterval: 12 * 60_000,
    enabled: !isMockData(),
  });
}

function invalidateFloor(qc: ReturnType<typeof useQueryClient>, asset: FloorAsset) {
  qc.setQueryData(K.version(asset.id), asset);
  void qc.invalidateQueries({ queryKey: K.versions(asset.workspaceId) });
  void qc.invalidateQueries({ queryKey: ['platform', 'floors', 'requests'] });
  if (asset.requestId) void qc.invalidateQueries({ queryKey: K.request(asset.requestId) });
}

export function useUploadFloor(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { file: File; requestId?: string | null; notes?: string }) => {
      const form = new FormData();
      if (input.requestId) form.append('requestId', input.requestId);
      if (input.notes?.trim()) form.append('notes', input.notes.trim());
      form.append('file', input.file, input.file.name);
      return superApi.upload('superFloorUpload', form, { params: { id: workspaceId } });
    },
    onSuccess: (asset) => invalidateFloor(qc, asset),
  });
}

export function useSaveSeatMap(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (seatMap: SeatMap) =>
      superApi.call('superFloorSeatMap', { params: { id }, body: seatMap }),
    onSuccess: (asset) => invalidateFloor(qc, asset),
  });
}

export function usePublishFloor(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => superApi.call('superFloorPublish', { params: { id } }),
    onSuccess: (asset) => invalidateFloor(qc, asset),
  });
}

// ---------------------------------------------------------------- prompt and file checks

/** The ready prompt for an AI chat with the request's head count and notes filled in. */
export function floorPrompt(
  request: Pick<FloorRequest, 'headcount' | 'notes' | 'workspaceName'> | null,
): string {
  const notes = request?.notes?.trim() || 'none';
  return FLOOR_PLAN_PROMPT.replace('{{headcount}}', String(request?.headcount ?? 'see the photos'))
    .replace('{{notes}}', notes)
    .replace(
      '"<company> office"',
      `"${(request?.workspaceName ?? 'Company').replace(/"/g, "'")} office"`,
    );
}

const MAX_MODEL = UPLOAD_LIMITS.floor_model.maxBytes;
const MAX_PLAN = 5 * 1024 * 1024;

export type FileCheck =
  | { ok: true; format: 'layout_json'; plan: FloorPlan; summary: string }
  | { ok: true; format: 'glb' | 'gltf_zip'; summary: string }
  | { ok: false; problems: string[] };

const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

/** Checks a floor file in the browser before upload (the API validates again and stores it). */
export async function checkFloorFile(file: File): Promise<FileCheck> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'json') {
    if (file.size > MAX_PLAN)
      return {
        ok: false,
        problems: [`A floor plan JSON must be under 5 MB (this one is ${mb(file.size)}).`],
      };
    return checkPlanText(await file.text());
  }
  if (ext !== 'glb' && ext !== 'zip')
    return {
      ok: false,
      problems: [
        'Use a Vistar floor plan (.json), a .glb model, or a .zip with one .gltf and its files.',
      ],
    };
  if (file.size > MAX_MODEL)
    return {
      ok: false,
      problems: [`Models must be under ${mb(MAX_MODEL)} (this one is ${mb(file.size)}).`],
    };
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (ext === 'glb' && String.fromCharCode(...head) !== 'glTF')
    return {
      ok: false,
      problems: [
        'This is not a GLB file (the glTF header is missing). Export glTF 2.0 binary (.glb).',
      ],
    };
  if (ext === 'zip' && !(head[0] === 0x50 && head[1] === 0x4b))
    return { ok: false, problems: ['This is not a zip file.'] };
  return {
    ok: true,
    format: ext === 'glb' ? 'glb' : 'gltf_zip',
    summary: `${ext === 'glb' ? 'GLB model' : 'Zipped glTF'}, ${mb(file.size)}. Place the seats in the seat tool after the upload.`,
  };
}

/** Validates pasted or uploaded plan text with FloorPlanSchema; problems name the place in the file. */
export function checkPlanText(text: string): FileCheck {
  let json: unknown;
  try {
    // AI chats sometimes wrap the JSON in a ```json fence: accept that.
    json = JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, ''),
    );
  } catch (e) {
    return {
      ok: false,
      problems: [`The file is not valid JSON: ${e instanceof Error ? e.message : 'parse error'}.`],
    };
  }
  const parsed = FloorPlanSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues
        .slice(0, 50)
        .map((i) => `${i.path.length ? i.path.join('.') : 'file'}: ${i.message}`),
    };
  }
  const p = parsed.data;
  return {
    ok: true,
    format: 'layout_json',
    plan: p,
    summary: `${p.name}: ${p.size.width} x ${p.size.depth} m, ${p.rooms.length} rooms, ${p.seats.length} seats, ${p.items.length} furniture items, ${p.doors.length} doors.`,
  };
}

/** Clean JSON text (no code fence) as a .json file for the upload route. */
export function planFile(text: string, name = 'floor-plan.json'): File {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return new File([clean], name, { type: 'application/json' });
}
