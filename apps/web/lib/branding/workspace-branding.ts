'use client';

import type { Workspace, WorkspaceUpdate } from '@vistar/shared';
import { useCallback, useMemo } from 'react';
import { useMe, useSessionActions } from '@/lib/session/session';
import { normalizeHex } from './color';
import {
  BRAND_ASSET_FIELD,
  DEFAULT_COMPONENT_STYLE,
  EMPTY_BRANDING,
  isComponentStyle,
  type BrandAsset,
  type ComponentStyle,
  type CustomDomain,
  type WorkspaceBranding,
} from './types';

/**
 * ADAPTER (see types.ts). Fields read from the workspace the session carries:
 *   me.workspace.branding         WorkspaceBranding   (falls back to logoUrl / accentColor)
 *   me.workspace.componentStyle   'standard' | 'premium'   (setting key ui.componentStyle)
 *   me.workspace.customDomain     CustomDomain | null
 *   me.workspace.features.custom_domain   Super Admin switch
 * TODO(contracts-19): read the shared WorkspaceSchema fields and upload through the platform routes.
 */
type WorkspaceExtras = Workspace & {
  branding?: Partial<WorkspaceBranding> | null;
  componentStyle?: unknown;
  customDomain?: CustomDomain | null;
};

export function readBranding(ws: Workspace | null | undefined): WorkspaceBranding {
  if (!ws) return EMPTY_BRANDING;
  const x = ws as WorkspaceExtras;
  const b = x.branding ?? {};
  return {
    ...EMPTY_BRANDING,
    ...b,
    logoLightUrl: b.logoLightUrl ?? ws.logoUrl ?? null,
    brandColor: (b.brandColor && normalizeHex(b.brandColor)) || (ws.accentColor && normalizeHex(ws.accentColor)) || null,
    displayName: b.displayName?.trim() || null,
  };
}

export function readComponentStyle(ws: Workspace | null | undefined): ComponentStyle {
  const v = (ws as WorkspaceExtras | null | undefined)?.componentStyle;
  return isComponentStyle(v) ? v : DEFAULT_COMPONENT_STYLE;
}

export function readCustomDomain(ws: Workspace | null | undefined): CustomDomain | null {
  return (ws as WorkspaceExtras | null | undefined)?.customDomain ?? null;
}

/** Name shown for the company: branding display name, else the workspace name. */
export function brandName(ws: Workspace | null | undefined): string {
  return readBranding(ws).displayName ?? ws?.name ?? 'Vistar';
}

export function useBranding(): WorkspaceBranding {
  const me = useMe();
  return useMemo(() => readBranding(me?.workspace), [me?.workspace]);
}

export function useComponentStyleSetting() {
  const me = useMe();
  const { updateWorkspace } = useSessionActions();
  const value = readComponentStyle(me?.workspace);
  // Company admins only (D-059). Managers with settings.manage still cannot change the company look.
  const canChange = !!me && me.role.kind === 'company_admin' && me.permissions.includes('settings.manage');
  const setValue = useCallback(
    (componentStyle: ComponentStyle) => updateWorkspace({ componentStyle } as unknown as WorkspaceUpdate),
    [updateWorkspace],
  );
  return { value, setValue, canChange };
}

/** PATCH the branding (merged with what is saved). */
export function useSaveBranding() {
  const me = useMe();
  const { updateWorkspace } = useSessionActions();
  return useCallback(
    async (patch: Partial<WorkspaceBranding>) => {
      const next = { ...readBranding(me?.workspace), ...patch };
      // Keep the existing contract columns in step so older readers see the logo and accent.
      return updateWorkspace({ branding: next, logoUrl: next.logoLightUrl, accentColor: next.brandColor } as unknown as WorkspaceUpdate);
    },
    [me?.workspace, updateWorkspace],
  );
}

// ---------------------------------------------------------------- uploads (adapter: downscaled data URLs)

export const ASSET_RULES: Record<BrandAsset, { label: string; maxBytes: number; maxSide: number; accept: string; hint: string }> = {
  logoLight: { label: 'Logo for the light theme', maxBytes: 1_000_000, maxSide: 512, accept: 'image/png,image/svg+xml,image/webp,image/jpeg', hint: 'PNG, SVG or WebP up to 1 MB. Wide or square; shown 28 px high.' },
  logoDark: { label: 'Logo for the dark theme', maxBytes: 1_000_000, maxSide: 512, accept: 'image/png,image/svg+xml,image/webp,image/jpeg', hint: 'A light version of your logo for dark backgrounds.' },
  favicon: { label: 'Favicon', maxBytes: 300_000, maxSide: 64, accept: 'image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon', hint: 'Square PNG, SVG or ICO, at least 32 x 32 px.' },
  loginImage: { label: 'Sign-in page image', maxBytes: 5_000_000, maxSide: 1600, accept: 'image/jpeg,image/png,image/webp', hint: 'JPEG, PNG or WebP up to 5 MB, landscape, at least 1200 px wide.' },
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

/**
 * Validate and prepare an image for saving. Adapter: raster images are downscaled in the browser to
 * the size they are shown at and kept as data URLs; SVG and ICO are kept as they are.
 * TODO(contracts-19): POST the original file to the platform upload route and save the returned URL.
 */
export async function prepareBrandAsset(asset: BrandAsset, file: File): Promise<string> {
  const rule = ASSET_RULES[asset];
  if (!rule.accept.split(',').includes(file.type)) throw new UploadError(`${file.name} is not a supported image type. ${rule.hint}`);
  if (file.size > rule.maxBytes) throw new UploadError(`${file.name} is larger than ${Math.round(rule.maxBytes / 1000) / 1000} MB. ${rule.hint}`);
  if (file.type === 'image/svg+xml' || file.type.includes('icon')) {
    if (file.size > 200_000) throw new UploadError('SVG and ICO files must be under 200 KB.');
    return readAsDataUrl(file);
  }
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new UploadError(`${file.name} could not be opened as an image.`);
  });
  if (asset === 'favicon' && Math.min(bitmap.width, bitmap.height) < 32) throw new UploadError('The favicon must be at least 32 x 32 px.');
  const scale = Math.min(1, rule.maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new UploadError('This browser cannot prepare images. Try another browser.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return asset === 'loginImage' ? canvas.toDataURL('image/jpeg', 0.82) : canvas.toDataURL('image/png');
}

export function assetField(asset: BrandAsset): keyof WorkspaceBranding {
  return BRAND_ASSET_FIELD[asset];
}
