import type { HelmetOptions } from 'helmet';
import type { Env } from '../../config/env.js';

/**
 * Security headers for the API (helmet, change #20). The API answers JSON, PDFs and files: no scripts, no frames,
 * no forms. Downloads set their own sandbox CSP and Cross-Origin-Resource-Policy (StorageService, sendPdf).
 * HSTS only in production (two years, subdomains, preload-ready); browsers ignore it on http anyway.
 */
export function apiHelmetOptions(env: Pick<Env, 'NODE_ENV'>): HelmetOptions {
  const production = env.NODE_ENV === 'production';
  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    // JSON is read through CORS; files and PDFs override this per response.
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity: production ? { maxAge: 63_072_000, includeSubDomains: true, preload: false } : false,
    xFrameOptions: { action: 'deny' },
    xContentTypeOptions: true,
    xDnsPrefetchControl: { allow: false },
    xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
    xPoweredBy: false,
  };
}
