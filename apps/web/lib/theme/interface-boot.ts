import {
  COARSE_POINTER_QUERY,
  LOW_END_LIMIT,
  NARROW_SCREEN_QUERY,
  REDUCED_MOTION_QUERY,
  type InterfaceStyle,
  type MotionIntensity,
  type ReducedMotionPreference,
} from './interface-style';

/** Cookie mirrored by InterfaceProvider so the boot script can paint the right style before first paint. */
export const INTERFACE_COOKIE = 'vistar_ui';
export const INTERFACE_STYLE_ATTRIBUTE = 'data-interface-style';
export const MOTION_ATTRIBUTE = 'data-motion';
export const REDUCED_MOTION_ATTRIBUTE = 'data-reduced-motion';

/** Cookie value (JSON, URI-encoded). Short keys: it is sent with every request. */
export interface InterfaceCookie {
  /** ui.interfaceStyle (null = workspace default) */
  s: InterfaceStyle | null;
  /** ui.defaultInterfaceStyle of the workspace */
  d: InterfaceStyle;
  /** ui.motionIntensity */
  m: MotionIntensity;
  /** a11y.reducedMotion */
  rm: ReducedMotionPreference;
}

/**
 * Inline <head> script, placed right after getThemeBootScript(). Applies data-interface-style,
 * data-motion and data-reduced-motion before first paint, so there is no flash of the wrong style.
 * Mirrors resolveInterface() in interface-style.ts; keep the two in sync.
 */
export function getInterfaceBootScript(): string {
  return `(function(){try{var d=document.documentElement,c={s:null,d:'classic',m:'full',rm:'system'};var k=document.cookie.split('; ').find(function(x){return x.indexOf('${INTERFACE_COOKIE}=')===0});if(k){try{var v=JSON.parse(decodeURIComponent(k.slice(${INTERFACE_COOKIE.length + 1})));for(var p in v){c[p]=v[p]}}catch(e){}}var S=['classic','depth','neon'],M=['full','reduced','off'];function mq(q){return window.matchMedia(q).matches}var n=navigator,hc=n.hardwareConcurrency,dm=n.deviceMemory,low=(hc>0&&hc<=${LOW_END_LIMIT})||(dm>0&&dm<=${LOW_END_LIMIT});var s=S.indexOf(c.s)>=0?c.s:(S.indexOf(c.d)>=0?c.d:'classic');var path=location.pathname;if(s==='neon'&&(path==='/me'||path.indexOf('/me/')===0))s='depth';var on=c.rm==='on',dev=c.rm==='system'&&mq('${REDUCED_MOTION_QUERY}'),cap=mq('${NARROW_SCREEN_QUERY}')||mq('${COARSE_POINTER_QUERY}')||low;if(on||dev||cap)s='classic';var m=M.indexOf(c.m)>=0?c.m:'full';if(on)m='off';else if(m==='full'&&(dev||cap))m='reduced';d.setAttribute('${INTERFACE_STYLE_ATTRIBUTE}',s);d.setAttribute('${MOTION_ATTRIBUTE}',m);if(on||m==='off')d.setAttribute('${REDUCED_MOTION_ATTRIBUTE}','on');else if(c.rm==='off')d.setAttribute('${REDUCED_MOTION_ATTRIBUTE}','off')}catch(e){}})();`;
}
