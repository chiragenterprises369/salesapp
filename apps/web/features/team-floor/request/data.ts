'use client';

import {
  FLOOR_REQUEST_MAX_IMAGES,
  UPLOAD_LIMITS,
  type FloorImageCategory,
  type FloorRequest,
  type FloorRequestCreate,
  type StoredFile,
} from '@vistar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiRequestError } from '@/lib/api-error';
import { api } from '@/lib/api/client';
import { isMockData, noteMockUse } from '@/lib/api/data-source';
import { TEAM_FLOOR_LAYOUT_KEY } from '../state/layout/published';

/**
 * Company floor request (SPEC 29.5): reference photos (POST /files, purpose reference_image), then
 * POST /floor-requests with head count and notes. Query keys start with `team-floor`, so the realtime
 * client refetches them on `floor_request.updated` and `floor.published`. The mock data mode (tests
 * only) keeps requests in memory for the page session.
 */

export const FLOOR_REQUESTS_KEY = ['team-floor', 'requests'] as const;

export const IMAGE_CATEGORY_LABEL: Record<FloorImageCategory, string> = {
  work_area: 'Work area',
  cabin: 'Cabins',
  meeting_room: 'Meeting rooms',
  reception: 'Reception',
  pantry_lounge: 'Pantry or lounge',
  floor_plan: 'Floor plan',
  other: 'Other',
};

export const IMAGE_CATEGORY_HINT: Record<FloorImageCategory, string> = {
  work_area: 'Where the team sits: desks, rows, pods. Two or three angles help.',
  cabin: 'Manager or director cabins, one photo each.',
  meeting_room: 'Conference and discussion rooms.',
  reception: 'Entrance and waiting area.',
  pantry_lounge: 'Pantry, cafeteria or break area.',
  floor_plan: 'Optional: a drawing or a photo of the fire-exit plan with sizes.',
  other: 'Anything else: phone booths, storage, a terrace.',
};

const REF = UPLOAD_LIMITS.reference_image;
export const MAX_IMAGE_MB = Math.round(REF.maxBytes / (1024 * 1024));
export const IMAGE_ACCEPT = REF.mimes.join(',');
export { FLOOR_REQUEST_MAX_IMAGES };

/** Browser-side check before uploading (the API checks type, size and content again). */
export function imageProblem(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!REF.mimes.includes(file.type) && !REF.extensions.includes(ext)) return `${file.name} is not a photo Vistar can use. Use JPG, PNG or WebP.`;
  if (file.size > REF.maxBytes) return `${file.name} is larger than ${MAX_IMAGE_MB} MB. Export it smaller and try again.`;
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

// ---------------------------------------------------------------- mock (tests only)

const mock = { requests: [] as FloorRequest[], files: new Map<string, { file: File; url: string }>() };
const mockId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();

// ---------------------------------------------------------------- queries

export function useFloorRequests(enabled: boolean) {
  return useQuery({
    queryKey: FLOOR_REQUESTS_KEY,
    queryFn: async ({ signal }): Promise<FloorRequest[]> => {
      if (isMockData()) {
        noteMockUse('team-floor.requests');
        return mock.requests;
      }
      return (await api.call('floorRequestList', { signal })).items;
    },
    enabled,
    staleTime: 30_000,
  });
}

/** One request with signed photo URLs (15 min; refetched before they expire). */
export function useFloorRequest(id: string | null, enabled = true) {
  return useQuery({
    queryKey: [...FLOOR_REQUESTS_KEY, id],
    queryFn: async ({ signal }): Promise<FloorRequest> => {
      if (isMockData()) {
        const r = mock.requests.find((x) => x.id === id);
        if (!r) throw new ApiRequestError('NOT_FOUND', 'This request was not found.', [], { status: 404 });
        return r;
      }
      return api.call('floorRequestGet', { params: { id: id! }, signal });
    },
    enabled: enabled && !!id,
    staleTime: 10 * 60_000,
  });
}

export async function uploadReferenceImage(file: File, signal?: AbortSignal): Promise<StoredFile> {
  if (isMockData()) {
    noteMockUse('team-floor.upload');
    await new Promise((r) => setTimeout(r, 200));
    const id = mockId();
    mock.files.set(id, { file, url: URL.createObjectURL(file) });
    return { id, purpose: 'reference_image', name: file.name, mime: file.type || 'image/jpeg', size: file.size, sha256: null, visibility: 'private', publicUrl: null, createdAt: new Date().toISOString() };
  }
  const form = new FormData();
  form.append('purpose', 'reference_image');
  form.append('file', file, file.name);
  return api.upload('fileUpload', form, { signal });
}

export function useCreateFloorRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: FloorRequestCreate): Promise<FloorRequest> => {
      if (isMockData()) {
        const now = new Date().toISOString();
        const r: FloorRequest = {
          id: mockId(),
          workspaceId: 'mock',
          workspaceName: 'Mock workspace',
          status: 'submitted',
          headcount: body.headcount,
          notes: body.notes ?? null,
          statusNote: null,
          images: body.images.map((i) => {
            const f = mock.files.get(i.fileId);
            return { fileId: i.fileId, category: i.category, caption: i.caption ?? null, name: f?.file.name ?? 'photo', mime: f?.file.type ?? 'image/jpeg', size: f?.file.size ?? 0, url: null };
          }),
          createdBy: null,
          submittedAt: now,
          updatedAt: now,
          publishedFloorId: null,
        };
        mock.requests = [r, ...mock.requests];
        return r;
      }
      return api.call('floorRequestCreate', { body });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: FLOOR_REQUESTS_KEY });
      void qc.invalidateQueries({ queryKey: TEAM_FLOOR_LAYOUT_KEY });
    },
  });
}

/** Object URL of a photo uploaded in this tab (mock mode), else null. */
export function mockImageUrl(fileId: string): string | null {
  return mock.files.get(fileId)?.url ?? null;
}
