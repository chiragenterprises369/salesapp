import type { ComponentStyle } from './types';

/**
 * Component design and brand colours before first paint (D-059, D-060).
 *
 * Cookie `vistar_ds` = JSON { w: workspace component style, p: Super Admin console style }.
 * localStorage `vistar.brand.cache` = { host, css } written by BrandingProvider; the boot script
 * injects the cached CSS on the same host for the workspace panels (and on every page of a custom
 * domain), so the brand colour shows from the first frame.
 */
export const DESIGN_COOKIE = 'vistar_ds';
export const COMPONENT_STYLE_ATTRIBUTE = 'data-ui';
export const BRAND_ATTRIBUTE = 'data-brand';
export const BRAND_STYLE_ID = 'vs-brand';
export const BRAND_CACHE_KEY = 'vistar.brand.cache';

export interface DesignCookie {
  w: ComponentStyle;
  p: ComponentStyle;
}

const ONE_YEAR_SEC = 60 * 60 * 24 * 365;

export function readDesignCookie(): DesignCookie {
  const fallback: DesignCookie = { w: 'standard', p: 'standard' };
  if (typeof document === 'undefined') return fallback;
  const raw = document.cookie.split('; ').find((c) => c.startsWith(`${DESIGN_COOKIE}=`));
  if (!raw) return fallback;
  try {
    const v = JSON.parse(decodeURIComponent(raw.slice(DESIGN_COOKIE.length + 1))) as Partial<DesignCookie>;
    return { w: v.w === 'premium' ? 'premium' : 'standard', p: v.p === 'premium' ? 'premium' : 'standard' };
  } catch {
    return fallback;
  }
}

export function writeDesignCookie(value: DesignCookie): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${DESIGN_COOKIE}=${encodeURIComponent(JSON.stringify(value))}; Path=/; Max-Age=${ONE_YEAR_SEC}; SameSite=Lax${secure}`;
}

/** Hosts that serve Vistar itself; anything else (including `*.localhost`) is a company's custom domain. */
export const DEFAULT_APP_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'];

export function isCustomHost(hostname: string): boolean {
  const own = process.env.NEXT_PUBLIC_APP_HOST?.split(',').map((h) => h.trim().toLowerCase()) ?? [];
  const h = hostname.toLowerCase();
  return !DEFAULT_APP_HOSTS.includes(h) && !own.includes(h);
}

/** Inline <head> script, placed after getInterfaceBootScript(). Keep in sync with BrandingProvider. */
export function getBrandingBootScript(): string {
  const own = JSON.stringify([...DEFAULT_APP_HOSTS, ...(process.env.NEXT_PUBLIC_APP_HOST?.split(',').map((h) => h.trim().toLowerCase()) ?? [])]);
  return `(function(){try{var d=document.documentElement,p=location.pathname,c={w:'standard',p:'standard'};var k=document.cookie.split('; ').find(function(x){return x.indexOf('${DESIGN_COOKIE}=')===0});if(k){try{var v=JSON.parse(decodeURIComponent(k.slice(${DESIGN_COOKIE.length + 1})));if(v.w==='premium')c.w='premium';if(v.p==='premium')c.p='premium'}catch(e){}}var sa=p==='/super-admin'||p.indexOf('/super-admin/')===0;d.setAttribute('${COMPONENT_STYLE_ATTRIBUTE}',sa?c.p:c.w);if(sa)return;var h=location.hostname.toLowerCase(),custom=${own}.indexOf(h)<0,ws=p==='/app'||p.indexOf('/app/')===0||p==='/me'||p.indexOf('/me/')===0;if(!ws&&!custom)return;var raw=localStorage.getItem('${BRAND_CACHE_KEY}');if(!raw)return;var b=JSON.parse(raw);if(!b||b.host!==h||!b.css)return;var s=document.createElement('style');s.id='${BRAND_STYLE_ID}';s.textContent=b.css;document.head.appendChild(s);d.setAttribute('${BRAND_ATTRIBUTE}','')}catch(e){}})();`;
}
