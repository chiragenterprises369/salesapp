'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { useSession, useSessionStatus } from '@/lib/session/session';
import {
  BRAND_ATTRIBUTE,
  BRAND_CACHE_KEY,
  BRAND_STYLE_ID,
  COMPONENT_STYLE_ATTRIBUTE,
  isCustomHost,
  readDesignCookie,
  writeDesignCookie,
} from './boot';
import { brandCss, resolveBrandTokens } from './brand-css';
import { usePlatformComponentStyle } from './platform-style';
import { usePublicBranding, type PublicBranding } from './public-branding';
import type { BrandingDraft, ComponentStyle } from './types';
import { readBranding, readComponentStyle } from './workspace-branding';

function paintStyle(style: ComponentStyle) {
  const root = document.documentElement;
  if (root.getAttribute(COMPONENT_STYLE_ATTRIBUTE) !== style) root.setAttribute(COMPONENT_STYLE_ATTRIBUTE, style);
}

function paintBrand(css: string, cache: boolean) {
  const root = document.documentElement;
  let el = document.getElementById(BRAND_STYLE_ID) as HTMLStyleElement | null;
  if (!css) {
    el?.remove();
    root.removeAttribute(BRAND_ATTRIBUTE);
  } else {
    if (!el) {
      el = document.createElement('style');
      el.id = BRAND_STYLE_ID;
      document.head.appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
    root.setAttribute(BRAND_ATTRIBUTE, '');
  }
  if (!cache) return;
  try {
    if (css) window.localStorage.setItem(BRAND_CACHE_KEY, JSON.stringify({ host: window.location.hostname.toLowerCase(), css }));
    else window.localStorage.removeItem(BRAND_CACHE_KEY);
  } catch {
    /* storage blocked: the colours still apply after hydration */
  }
}

function paintFavicon(href: string | null) {
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
  let link = links.find((l) => l.dataset.brand === '1');
  if (!href) {
    link?.remove();
    links.filter((l) => l.dataset.brand !== '1').forEach((l) => (l.media = ''));
    return;
  }
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.dataset.brand = '1';
    document.head.appendChild(link);
  }
  if (link.href !== href) link.href = href;
  // The brand icon wins over the app's default icons.
  links.filter((l) => l.dataset.brand !== '1').forEach((l) => (l.media = 'not all'));
}

/** Replace the product name at the end of the tab title ("Leads · Vistar") with the company name. */
function useBrandedTitle(name: string | null) {
  useEffect(() => {
    if (!name) return;
    const titleEl = document.querySelector('title');
    const apply = () => {
      const t = document.title;
      if (t === 'Vistar') document.title = name;
      else if (t.endsWith(' · Vistar')) document.title = `${t.slice(0, -' · Vistar'.length)} · ${name}`;
    };
    apply();
    const target = titleEl ?? document.head;
    const obs = new MutationObserver(apply);
    obs.observe(target, { childList: true, characterData: true, subtree: true });
    return () => obs.disconnect();
  }, [name]);
}

type BrandSource = Pick<BrandingDraft, 'brandColor' | 'chartPalette' | 'favicon' | 'displayName'>;

/**
 * Applies the company design app-wide (D-059, D-060). Mounted once in app/layout.tsx; renders nothing.
 * - `<html data-ui="standard|premium">`: the workspace setting in the company and employee panels,
 *   the console choice in the Super Admin panel, the last used value on signed-out pages.
 * - Brand colours as CSS variables (`<style id="vs-brand">` + `<html data-brand>`), the favicon and
 *   the tab title. Signed-out pages get the public branding only on a company's custom domain.
 */
export function BrandingProvider() {
  const status = useSessionStatus();
  const session = useSession();
  const pathname = usePathname();
  const platformStyle = usePlatformComponentStyle();
  const superAdmin = pathname === '/super-admin' || pathname.startsWith('/super-admin/');
  const workspace = session?.audience === 'workspace' ? session.me.workspace : null;
  const customHost = typeof window !== 'undefined' && isCustomHost(window.location.hostname);
  const publicBranding = usePublicBranding(status === 'unauthenticated');

  const componentStyle: ComponentStyle | null = useMemo(() => {
    if (status === 'loading') return null;
    if (superAdmin) return platformStyle;
    if (workspace) return readComponentStyle(workspace);
    // Signed out: the company's choice on its custom domain, else keep what the boot script painted.
    return publicBranding.data?.componentStyle ?? null;
  }, [status, superAdmin, platformStyle, workspace, publicBranding.data]);

  useEffect(() => {
    if (!componentStyle) return;
    paintStyle(componentStyle);
    if (!superAdmin && !workspace) return;
    const c = readDesignCookie();
    const next = superAdmin ? { ...c, p: componentStyle } : { ...c, w: componentStyle };
    if (next.w !== c.w || next.p !== c.p) writeDesignCookie(next);
  }, [componentStyle, superAdmin, workspace]);

  const source: BrandSource | null = useMemo(() => {
    if (status === 'loading' || superAdmin) return null;
    if (workspace) return readBranding(workspace);
    const pb: PublicBranding | null | undefined = publicBranding.data;
    return pb ?? null;
  }, [status, superAdmin, workspace, publicBranding.data]);

  const css = useMemo(() => (source ? brandCss(resolveBrandTokens(source)) : ''), [source]);

  useEffect(() => {
    if (status === 'loading') return;
    if (superAdmin) {
      paintBrand('', false);
      return;
    }
    // Signed out on Vistar's own host: default look, but keep the cache for the next panel visit.
    if (!workspace && !customHost) {
      paintBrand('', false);
      return;
    }
    if (!workspace && publicBranding.isPending) return;
    paintBrand(css, true);
  }, [status, superAdmin, workspace, customHost, css, publicBranding.isPending]);

  useEffect(() => {
    if (status === 'loading') return;
    paintFavicon(source?.favicon?.url ?? null);
  }, [status, source?.favicon?.url]);

  useBrandedTitle(source?.displayName ?? null);
  return null;
}
