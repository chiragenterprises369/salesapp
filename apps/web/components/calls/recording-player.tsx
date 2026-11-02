'use client';

import { useQuery } from '@tanstack/react-query';
import { formatDuration } from '@vistar/shared';
import { Pause, Play, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { TOUCH } from '@/components/reports/page-kit';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { api } from '@/lib/api/client';
import { isMockData } from '@/lib/api/data-source';
import { cn } from '@/lib/cn';
import { waveform } from './logic';

/** Resample server peaks to the number of bars the player draws. */
function resample(peaks: readonly number[], bars: number): number[] {
  if (!peaks.length) return Array.from({ length: bars }, () => 0.08);
  return Array.from({ length: bars }, (_, i) => {
    const from = Math.floor((i * peaks.length) / bars);
    const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / bars));
    let max = 0;
    for (let j = from; j < to; j++) max = Math.max(max, peaks[j] ?? 0);
    return Math.max(0.08, max);
  });
}

/**
 * Call recording player with a waveform, play/pause and a keyboard-operable seek slider.
 * API mode: GET /calls/{id}/recording gives a short-lived signed URL and the downsampled peaks;
 * the audio plays from that URL. Test-only mock mode: a generated waveform and a moving playhead
 * without audio, marked "Recording (mock)".
 */
export function RecordingPlayer({ callId, durationSec, title, onClose, compact }: { callId: string; durationSec: number; title: string; onClose?: () => void; compact?: boolean }) {
  const mock = isMockData();
  const bars = compact ? 40 : 72;
  const rec = useQuery({
    queryKey: ['calls', 'recording', callId],
    queryFn: () => api.call('callRecording', { params: { id: callId } }),
    enabled: !mock,
    // Signed URLs expire; fetch a new one rather than reuse a stale URL.
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
  });
  const peaks = useMemo(() => (mock ? waveform(callId, bars) : resample(rec.data?.waveform ?? [], bars)), [mock, callId, bars, rec.data]);
  const audio = useRef<HTMLAudioElement>(null);
  const [audioTotal, setAudioTotal] = useState(0);
  const total = Math.max(1, Math.round(audioTotal || durationSec));
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Mock mode: move the playhead once a second (no audio).
  useEffect(() => {
    if (!mock || !playing) return;
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
  }, [mock, playing, total]);

  const seek = (s: number) => {
    const next = Math.max(0, Math.min(total, s));
    setPos(next);
    if (audio.current) audio.current.currentTime = next;
  };
  const toggle = () => {
    if (pos >= total) seek(0);
    if (mock) return setPlaying((p) => !p);
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  };
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
  const unavailable = !mock && rec.isError;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2" role="group" aria-label={`Recording of ${title}`}>
      {!mock && rec.data && (
        <audio
          ref={audio}
          src={rec.data.url}
          preload="metadata"
          onLoadedMetadata={(e) => setAudioTotal(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
          onTimeUpdate={(e) => setPos(Math.round(e.currentTarget.currentTime))}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          className="hidden"
        />
      )}
      <Button
        variant="primary"
        size="icon"
        className={cn('rounded-full', TOUCH)}
        aria-label={playing ? 'Pause recording' : 'Play recording'}
        aria-pressed={playing}
        disabled={!mock && !rec.data}
        onClick={toggle}
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
      {mock && <Chip tone="grey">Recording (mock)</Chip>}
      {unavailable && <span className="text-xs text-muted">The recording could not be loaded. Try again later.</span>}
      {onClose && (
        <Button variant="ghost" size="icon-sm" className={TOUCH} aria-label="Close player" onClick={onClose}>
          <X aria-hidden />
        </Button>
      )}
    </div>
  );
}
