import { loadEnvConfig } from '@next/env';
import path from 'node:path';
import type { NextConfig } from 'next';

// Monorepo root (also correct inside .worktrees/<agent>). Only NEXT_PUBLIC_* values reach the browser.
// forceReload: Next has already loaded (and cached) env from apps/web, so a plain call is a no-op (D-041).
const monorepoRoot = path.resolve(process.cwd(), '../..');
loadEnvConfig(monorepoRoot, process.env.NODE_ENV !== 'production', undefined, true);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pin the root so Turbopack never picks a parent checkout's lockfile (agent worktrees live inside the repo).
  turbopack: { root: monorepoRoot },
  outputFileTracingRoot: monorepoRoot,
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts', '@react-three/drei'],
  },
};

export default nextConfig;
