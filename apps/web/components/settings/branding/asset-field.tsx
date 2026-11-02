'use client';

import { palettes } from '@vistar/shared';
import { ImageUp, Trash2, Upload } from 'lucide-react';
import { useId, useRef, useState, type DragEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ASSET_RULES, prepareBrandAsset, UploadError, type BrandAsset } from '@/lib/branding';
import { cn } from '@/lib/cn';

/**
 * One brand image: preview on the background it is used on, upload (button or drop), replace and
 * remove. Validation errors are shown under the tile, not only as toasts.
 */
export function AssetField({
  asset,
  value,
  onChange,
  disabled,
  previewTheme = 'light',
  className,
}: {
  asset: BrandAsset;
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
  previewTheme?: 'light' | 'dark';
  className?: string;
}) {
  const rule = ASSET_RULES[asset];
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const p = palettes[previewTheme];
  const wide = asset === 'loginImage';

  async function take(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await prepareBrandAsset(asset, file));
    } catch (e) {
      setError(e instanceof UploadError ? e.message : 'This image could not be used. Try another file.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!disabled) void take(e.dataTransfer.files[0]);
  };

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span id={`${id}-label`} className="text-xs font-medium text-fg-secondary">
        {rule.label}
      </span>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          'relative flex items-center justify-center overflow-hidden rounded-md border',
          wide ? 'aspect-[16/7]' : 'h-24',
          value ? 'border-border' : 'border-dashed border-border-strong',
          over && 'border-accent ring-2 ring-accent/30',
        )}
        style={{ background: value || asset === 'loginImage' ? (asset === 'loginImage' ? p['surface-2'] : p.surface) : undefined }}
      >
        {value ? (
          asset === 'loginImage' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="absolute inset-0 size-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className={cn('object-contain', asset === 'favicon' ? 'size-8' : 'max-h-12 max-w-[80%]')} />
          )
        ) : (
          <span className="flex flex-col items-center gap-1 px-3 text-center">
            <ImageUp aria-hidden className="size-5 text-fg-secondary" />
            <span className="text-xs text-muted">Drop an image or choose a file</span>
          </span>
        )}
        {asset !== 'loginImage' && (
          <span className="absolute top-1.5 left-1.5 rounded-xs px-1 text-2xs font-medium" style={{ background: p['surface-3'], color: p['muted-strong'] }}>
            {previewTheme === 'dark' ? 'Dark' : 'Light'}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          ref={input}
          id={`${id}-file`}
          type="file"
          accept={rule.accept}
          className="sr-only"
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-hint`}
          disabled={disabled || busy}
          onChange={(e) => void take(e.target.files?.[0])}
        />
        <Button size="sm" onClick={() => input.current?.click()} disabled={disabled} loading={busy} aria-describedby={`${id}-hint`}>
          <Upload aria-hidden />
          {value ? 'Replace' : 'Upload'}
          <span className="sr-only"> {rule.label.toLowerCase()}</span>
        </Button>
        {value && (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)} disabled={disabled}>
            <Trash2 aria-hidden />
            Remove<span className="sr-only"> {rule.label.toLowerCase()}</span>
          </Button>
        )}
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted">
        {rule.hint}
      </p>
      {error && (
        <p role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}
