'use client';

import {
  EMPTY_BRANDING,
  resolveBrandColors as resolveSharedBrandColors,
  resolveChartPalette,
  type FileRef,
  type StoredFile,
  type Workspace,
  type WorkspaceBranding,
  type WorkspaceUpdate,
} from '@vistar/shared';
import { useCallback, useMemo } from 'react';
import { useMe, useSessionActions } from '@/lib/session/session';
import { normalizeHex } from './color';
import { api, apiMode } from './http';
import { DEFAULT_COMPONENT_STYLE, EMPTY_DRAFT, isComponentStyle, type BrandAsset, type BrandAssetValue, type BrandingDraft, type ComponentStyle } from './types';

/**
 * Branding and component design on the workspace (contracts(19)):
 *   read   me.workspace.branding (WorkspaceBranding), me.workspace.componentStyle
 *   write  PATCH /workspace/branding (file ids from POST /files), PATCH /workspace { componentStyle }
 * Mock sessions (automated tests, no access token) keep everything on the mock workspace, with
 * images downscaled in the browser and kept as data URLs.
 */

const fromRef = (r: FileRef | null | undefined): BrandAssetValue | null => (r ? { fileId: r.fileId, url: r.url, name: r.name, mime: r.mime, size: r.size } : null);
const toRef = (v: BrandAssetValue | null): FileRef | null => (v ? { fileId: v.fileId, url: v.url, name: v.name, mime: v.mime, size: v.size } : null);

export function brandingToDraft(b: WorkspaceBranding | null | undefined, legacy?: Pick<Workspace, 'accentColor'>): BrandingDraft {
  if (!b) return EMPTY_DRAFT;
  return {
    displayName: b.displayName?.trim() || null,
    logoLight: fromRef(b.logoLight),
    logoDark: fromRef(b.logoDark),
    favicon: fromRef(b.favicon),
    loginImage: fromRef(b.loginImage),
    brandColor: (b.brandColor && normalizeHex(b.brandColor)) || (legacy?.accentColor && normalizeHex(legacy.accentColor)) || null,
    chartPalette: b.chartPalette?.length === 6 ? b.chartPalette.map((c) => normalizeHex(c) ?? c) : null,
  };
}

export function readBranding(ws: Workspace | null | undefined): BrandingDraft {
  if (!ws) return EMPTY_DRAFT;
  return brandingToDraft(ws.branding ?? EMPTY_BRANDING, ws);
}

/** Shared WorkspaceBranding for a draft (mock store), with the shared contrast-guarded colours. */
export function draftToBranding(d: BrandingDraft): WorkspaceBranding {
  return {
    displayName: d.displayName,
    logoLight: toRef(d.logoLight),
    logoDark: toRef(d.logoDark),
    favicon: toRef(d.favicon),
    loginImage: toRef(d.loginImage),
    brandColor: d.brandColor,
    chartPalette: d.chartPalette,
    colors: d.brandColor ? resolveSharedBrandColors(d.brandColor) : null,
    chartColors: d.chartPalette ? resolveChartPalette(d.chartPalette) : null,
  };
}

export function readComponentStyle(ws: Workspace | null | undefined): ComponentStyle {
  const v = ws?.componentStyle;
  return isComponentStyle(v) ? v : DEFAULT_COMPONENT_STYLE;
}

/** Name shown for the company: branding display name, else the workspace name. */
export function brandName(ws: Workspace | null | undefined): string {
  return readBranding(ws).displayName ?? ws?.name ?? 'Vistar';
}

export function useBranding(): BrandingDraft {
  const me = useMe();
  return useMemo(() => readBranding(me?.workspace), [me?.workspace]);
}

export function useComponentStyleSetting() {
  const me = useMe();
  const { updateWorkspace } = useSessionActions();
  const value = readComponentStyle(me?.workspace);
  // Company admins only (D-059). A manager with settings.manage still cannot change the company look.
  const canChange = !!me && me.role.kind === 'company_admin' && me.permissions.includes('settings.manage');
  const setValue = useCallback((componentStyle: ComponentStyle) => updateWorkspace({ componentStyle } satisfies WorkspaceUpdate), [updateWorkspace]);
  return { value, setValue, canChange };
}

/** Save a whole draft. API: PATCH /workspace/branding, then refresh the session's workspace. */
export function useSaveBranding() {
  const { updateWorkspace } = useSessionActions();
  return useCallback(
    async (draft: BrandingDraft) => {
      if (apiMode()) {
        await api<Workspace>('/workspace/branding', {
          method: 'PATCH',
          json: {
            displayName: draft.displayName,
            logoLightFileId: draft.logoLight?.fileId ?? null,
            logoDarkFileId: draft.logoDark?.fileId ?? null,
            faviconFileId: draft.favicon?.fileId ?? null,
            loginImageFileId: draft.loginImage?.fileId ?? null,
            brandColor: draft.brandColor,
            chartPalette: draft.chartPalette,
          },
        });
        // PATCH /workspace with no changes returns the workspace with the new branding; the session keeps it.
        return updateWorkspace({});
      }
      const branding = draftToBranding(draft);
      return updateWorkspace({ branding, logoUrl: draft.logoLight?.url ?? null, accentColor: draft.brandColor } as unknown as WorkspaceUpdate);
    },
    [updateWorkspace],
  );
}

// ---------------------------------------------------------------- uploads

const PURPOSE: Record<BrandAsset, 'logo' | 'favicon' | 'login_image'> = { logoLight: 'logo', logoDark: 'logo', favicon: 'favicon', loginImage: 'login_image' };

/** Client checks mirror UPLOAD_LIMITS (the API checks again, including magic bytes). */
export const ASSET_RULES: Record<BrandAsset, { label: string; maxBytes: number; maxSide: number; accept: string; hint: string }> = {
  logoLight: { label: 'Logo for the light theme', maxBytes: 2 * 1024 * 1024, maxSide: 512, accept: 'image/png,image/svg+xml,image/webp,image/jpeg', hint: 'PNG, SVG, WebP or JPEG up to 2 MB. Shown 28 px high.' },
  logoDark: { label: 'Logo for the dark theme', maxBytes: 2 * 1024 * 1024, maxSide: 512, accept: 'image/png,image/svg+xml,image/webp,image/jpeg', hint: 'A light version of your logo for dark backgrounds. Empty = the light logo.' },
  favicon: { label: 'Favicon', maxBytes: 512 * 1024, maxSide: 64, accept: 'image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon', hint: 'Square PNG, SVG or ICO up to 512 KB, at least 32 x 32 px.' },
  loginImage: { label: 'Sign-in page image', maxBytes: 5 * 1024 * 1024, maxSide: 1600, accept: 'image/jpeg,image/png,image/webp', hint: 'JPEG, PNG or WebP up to 5 MB, landscape, at least 1200 px wide.' },
};

export class UploadError extends Error {}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new UploadError('This file could not be read. Try another file.'));
    r.readAsDataURL(file);
  });
}

async function downscale(asset: BrandAsset, file: File): Promise<string> {
  const rule = ASSET_RULES[asset];
  if (file.type === 'image/svg+xml' || file.type.includes('icon')) return readAsDataUrl(file);
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new UploadError(`${file.name} could not be opened as an image.`);
  });
  const scale = Math.min(1, rule.maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new UploadError('This browser cannot prepare images. Try another browser.');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return asset === 'loginImage' ? canvas.toDataURL('image/jpeg', 0.82) : canvas.toDataURL('image/png');
}

async function checkSize(asset: BrandAsset, file: File) {
  if (asset !== 'favicon' || file.type === 'image/svg+xml' || file.type.includes('icon')) return;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (bitmap && Math.min(bitmap.width, bitmap.height) < 32) throw new UploadError('The favicon must be at least 32 x 32 px.');
  bitmap?.close();
}

/** Validate and upload one brand image. API: POST /files (public file); mock: a downscaled data URL. */
export async function uploadBrandAsset(asset: BrandAsset, file: File): Promise<BrandAssetValue> {
  const rule = ASSET_RULES[asset];
  if (!rule.accept.split(',').includes(file.type)) throw new UploadError(`${file.name} is not a supported image type. ${rule.hint}`);
  if (file.size > rule.maxBytes) throw new UploadError(`${file.name} is too large. ${rule.hint}`);
  await checkSize(asset, file);
  if (apiMode()) {
    const form = new FormData();
    form.append('purpose', PURPOSE[asset]);
    form.append('file', file);
    const stored = await api<StoredFile>('/files', { method: 'POST', form });
    return { fileId: stored.id, url: stored.publicUrl, name: stored.name, mime: stored.mime, size: stored.size };
  }
  const url = await downscale(asset, file);
  return { fileId: crypto.randomUUID(), url, name: file.name, mime: file.type, size: file.size };
}
