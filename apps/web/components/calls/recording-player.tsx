'use client';

import { formatDuration } from '@vistar/shared';
import { Pause, Play, X } from 'lucide-react';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { TOUCH } from '@/components/reports/page-kit';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/cn';
import { waveform } from './logic';

/**
 * Mock recording player: a static waveform for the call, play/pause that moves the playhead (no
 * audio in Wave 1), and a keyboard-operable seek slider. Wave 3: GET /calls/{id}/recording returns a
 * short-lived URL and the real downsampled peaks.
 */
export function RecordingPlayer({ callId, durationSec, title, onClose, compact }: { callId: string; durationSec: number; title: string; onClose?: () => void; compact?: boolean }) {
  const peaks = useMemo(() => waveform(callId, compact ? 40 : 72), [callId, compact]);
  const total = Math.max(1, durationSec);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setPos((p) => {
        if (p + 1 >= total) {
          setPlaying(false);
          return total;
        }
        return p + 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [playing, total]);

  const seek = (s: number) => setPos(Math.max(0, Math.min(total, s)));
  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 30, PageDown: -30 }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      seek(pos + step);
    } else if (e.key === 'Home') {
      e.preventDefault();
      seek(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      seek(total);
    }
  };
  const played = pos / total;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2" role="group" aria-label={`Recording of ${title}`}>
      <Button
        variant="primary"
        size="icon"
        className={cn('rounded-full', TOUCH)}
        aria-label={playing ? 'Pause recording' : 'Play recording'}
        aria-pressed={playing}
        onClick={() => {
          if (pos >= total) setPos(0);
          setPlaying((p) => !p);
        }}
      >
        {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
      </Button>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={pos}
        aria-valuetext={`${formatDuration(pos)} of ${formatDuration(total)}`}
        onKeyDown={onKey}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          seek(Math.round(((e.clientX - r.left) / r.width) * total));
        }}
        className="focus-ring flex h-10 min-w-40 flex-1 cursor-pointer items-center gap-px rounded-sm"
      >
        {peaks.map((p, i) => (
          <span
            key={i}
            aria-hidden
            className={cn('min-w-px flex-1 rounded-full transition-colors duration-150', i / peaks.length < played ? 'bg-accent' : 'bg-border-strong')}
            style={{ height: `${Math.round(p * 100)}%` }}
          />
        ))}
      </div>
      <span className="tabular text-xs text-fg-secondary">
        {formatDuration(pos)} / {formatDuration(total)}
      </span>
      <Chip tone="grey">Recording (mock)</Chip>
      {onClose && (
        <Button variant="ghost" size="icon-sm" className={TOUCH} aria-label="Close player" onClick={onClose}>
          <X aria-hidden />
        </Button>
      )}
    </div>
  );
}
