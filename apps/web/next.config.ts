import { loadEnvConfig } from '@next/env';
import path from 'node:path';
import type { NextConfig } from 'next';

// Monorepo root (also correct inside .worktrees/<agent>). Only NEXT_PUBLIC_* values reach the browser.
// forceReload: Next has already loaded (and cached) env from apps/web, so a plain call is a no-op (D-041).
const monorepoRoot = path.resolve(process.cwd(), '../..');
loadEnvConfig(monorepoRoot, process.env.NODE_ENV !== 'production', undefined, true);

// ---- change #20: prod (security headers; values are fixed at build time like NEXT_PUBLIC_*)
const isProd = process.env.NODE_ENV === 'production';

function originOf(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

const apiOrigin = originOf(process.env.NEXT_PUBLIC_API_URL);
const wsOrigin = originOf(process.env.NEXT_PUBLIC_WS_URL) ?? apiOrigin;
const wsUrl = wsOrigin ? wsOrigin.replace(/^http/, 'ws') : null;
const tileOrigin = originOf(process.env.NEXT_PUBLIC_MAP_TILE_URL?.replace(/\{[a-z]\}/g, 'a'));
const extra = (process.env.WEB_CSP_EXTRA_CONNECT ?? '').split(/[\s,]+/).filter(Boolean);
const razorpay = ['https://checkout.razorpay.com', 'https://api.razorpay.com'];
// Google Identity Services on /login and /signup (CONFIG-WEB request 5)
const gsi = 'https://accounts.google.com/gsi/';

const csp = (frameAncestors: string): string =>
  [
    "default-src 'self'",
    // Next inlines its bootstrap and the theme boot script; WebAssembly for the Draco and Basis decoders of the floor.
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isProd ? '' : " 'unsafe-eval'"} https://checkout.razorpay.com ${gsi}client`,
    // inline styles: motion, charts and the e-mail template previews (srcdoc frames inherit this policy)
    `style-src 'self' 'unsafe-inline' ${gsi}style`,
    `img-src 'self' data: blob: https:${isProd ? '' : ' http:'}`,
    "font-src 'self' data:",
    `connect-src 'self' ${[apiOrigin, wsOrigin, wsUrl, tileOrigin, ...razorpay, 'https://lumberjack.razorpay.com', gsi, ...extra].filter(Boolean).join(' ')}${isProd ? '' : ' http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*'}`,
    `media-src 'self' blob: ${apiOrigin ?? ''}`.trim(),
    "worker-src 'self' blob:",
    `frame-src 'self' ${razorpay.join(' ')} ${gsi}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
    ...(isProd ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

const common = [
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(self "https://checkout.razorpay.com"), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
];
// ---- end change #20: prod

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // ---- change #20: prod (self-contained server for the Docker image: apps/web/.next/standalone; the
  // Dockerfile sets NEXT_OUTPUT=standalone, local `next start` keeps the normal output)
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' as const } : {}),
  // ---- end change #20: prod
  // Pin the root so Turbopack never picks a parent checkout's lockfile (agent worktrees live inside the repo).
  turbopack: { root: monorepoRoot },
  outputFileTracingRoot: monorepoRoot,
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts', '@react-three/drei'],
  },
  // ---- change #20: prod (CSP, HSTS, frame-ancestors, referrer policy; capture forms /f/* may be framed anywhere)
  async rewrites() {
    const backend =
      process.env.API_INTERNAL_URL ||
      process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/v\d+.*$/, '') ||
      'https://salesapp-api-lqk9.onrender.com';
    return [
      {
        source: '/api/:path*',
        destination: `${backend}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      { source: '/((?!f/).*)', headers: [...common, { key: 'Content-Security-Policy', value: csp("'none'") }, { key: 'X-Frame-Options', value: 'DENY' }] },
      { source: '/f/:path*', headers: [...common, { key: 'Content-Security-Policy', value: csp('*') }] },
    ];
  },
  // ---- end change #20: prod
};

export default nextConfig;
