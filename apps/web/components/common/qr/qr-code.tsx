'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import { encodeQr, qrPath } from './qr-encode';

/**
 * QR code as SVG. Always dark modules on white (scanners expect it), in both themes.
 * Pass a visible or screen-reader label; the image itself is labelled with `label`.
 */
export function QrCode({ value, label, size = 144, className }: { value: string; label: string; size?: number; className?: string }) {
  const { path, dim } = useMemo(() => {
    const m = encodeQr(value);
    return { path: qrPath(m, 4), dim: m.size + 8 };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${dim} ${dim}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={cn('shrink-0 rounded-md bg-white', className)}
    >
      <rect width={dim} height={dim} fill="#FFFFFF" />
      <path d={path} fill="#0F172A" />
    </svg>
  );
}
