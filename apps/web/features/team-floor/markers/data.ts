'use client';

import type { OfficeMarker, OfficeMarkerKind } from '@vistar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { isMockData, noteMockUse } from '@/lib/api/data-source';

/**
 * Office markers (SPEC 29.11): BLE beacons, Wi-Fi access points, QR codes and NFC tags that tell the
 * Android app which zone of the published floor a person is in. Routes /team-floor/markers
 * (settings.manage); a QR / NFC token is returned once at creation and stored only as a hash.
 * Mock data mode (tests only): an in-memory list for the page session.
 */

export const MARKERS_KEY = ['team-floor', 'markers'] as const;

export const MARKER_KIND_LABEL: Record<OfficeMarkerKind, string> = {
  ble_beacon: 'BLE beacon',
  wifi_ap: 'Wi-Fi network',
  qr: 'QR code',
  nfc: 'NFC tag',
};

export interface MarkerInput {
  kind: OfficeMarkerKind;
  zoneId: string;
  label: string;
  beacon?: { uuid: string; major: number; minor: number };
  bssid?: string;
}

let mockList: OfficeMarker[] = [];

export function useOfficeMarkers() {
  return useQuery({
    queryKey: MARKERS_KEY,
    queryFn: async ({ signal }): Promise<OfficeMarker[]> => {
      if (isMockData()) {
        noteMockUse('team-floor.markers');
        return mockList;
      }
      return (await api.call('officeMarkerList', { signal })).items;
    },
    staleTime: 30_000,
  });
}

export function useCreateMarker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: MarkerInput): Promise<OfficeMarker> => {
      if (isMockData()) {
        const token =
          body.kind === 'qr' || body.kind === 'nfc'
            ? `vz1.mock${Math.random().toString(36).slice(2, 14)}${Date.now().toString(36)}`
            : undefined;
        const m: OfficeMarker = {
          id: `mock-${mockList.length + 1}`,
          kind: body.kind,
          zoneId: body.zoneId,
          label: body.label,
          beacon: body.beacon ?? null,
          bssid: body.bssid ?? null,
          createdAt: new Date().toISOString(),
        };
        mockList = [...mockList, m];
        return token ? { ...m, token } : m;
      }
      return api.call('officeMarkerCreate', { body });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: MARKERS_KEY }),
  });
}

export function useDeleteMarker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (isMockData()) {
        mockList = mockList.filter((m) => m.id !== id);
        return { ok: true as const };
      }
      return api.call('officeMarkerDelete', { params: { id } });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: MARKERS_KEY }),
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BSSID = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i;

/** "AABBCC112233", "aa-bb-cc-11-22-33" -> "aa:bb:cc:11:22:33" (as Android reports it). */
export function normalizeBssid(v: string): string {
  const hex = v.replace(/[^0-9a-f]/gi, '').toLowerCase();
  return hex.length === 12 ? hex.match(/.{2}/g)!.join(':') : v.trim().toLowerCase();
}

/** Field errors for the create form (the API validates again). */
export function markerProblems(input: {
  kind: OfficeMarkerKind;
  zoneId: string;
  label: string;
  uuid: string;
  major: string;
  minor: string;
  bssid: string;
}): Record<string, string> {
  const e: Record<string, string> = {};
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(input.zoneId))
    e.zoneId = 'Pick the room this marker belongs to.';
  if (!input.label.trim())
    e.label =
      input.kind === 'wifi_ap'
        ? 'Enter the network name (SSID).'
        : 'Give the marker a name people recognise, e.g. "Conference room door".';
  else if (input.label.trim().length > 60) e.label = 'Keep it under 60 characters.';
  if (input.kind === 'ble_beacon') {
    if (!UUID.test(input.uuid.trim()))
      e.uuid = 'The UUID has 32 hex digits in 5 groups, e.g. f7826da6-4fa2-4e98-8024-bc5b71e0893e.';
    for (const k of ['major', 'minor'] as const) {
      const n = Number(input[k]);
      if (!/^\d+$/.test(input[k].trim()) || n < 0 || n > 65535)
        e[k] = 'A whole number from 0 to 65535 (printed on the beacon or in its app).';
    }
  }
  if (input.kind === 'wifi_ap' && !BSSID.test(normalizeBssid(input.bssid)))
    e.bssid =
      'The access point address (BSSID) looks like 3c:84:6a:12:9f:20. Find it in the router or a Wi-Fi analyser app.';
  return e;
}

/** URL-safe zone id from a room name (when no floor is published yet). */
export function zoneIdFrom(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'office'
  );
}
