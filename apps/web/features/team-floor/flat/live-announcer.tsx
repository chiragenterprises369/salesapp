'use client';

import { useEffect, useRef, useState } from 'react';
import type { FloorLogEntry } from '../state/types';

const THROTTLE_MS = 10_000;

/**
 * Polite, throttled screen reader summary of floor changes: at most one announcement every 10 s,
 * three newest changes plus a count. Silent while live updates are paused.
 */
export function LiveAnnouncer({ log, paused }: { log: FloorLogEntry[]; paused: boolean }) {
  const [message, setMessage] = useState('');
  const logRef = useRef(log);
  const lastSeq = useRef<number | null>(null);

  useEffect(() => {
    logRef.current = log;
    // Start from "now": history before the page opened is not announced.
    if (lastSeq.current === null) lastSeq.current = log.at(-1)?.seq ?? 0;
  }, [log]);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      const last = lastSeq.current ?? 0;
      const fresh = logRef.current.filter((e) => e.seq > last);
      if (!fresh.length) return;
      lastSeq.current = fresh[fresh.length - 1]!.seq;
      const newest = fresh.slice(-3).map((e) => e.text);
      const more = fresh.length - newest.length;
      setMessage(`${newest.join('. ')}.${more > 0 ? ` And ${more} more ${more === 1 ? 'change' : 'changes'}.` : ''}`);
    }, THROTTLE_MS);
    return () => clearInterval(timer);
  }, [paused]);

  return (
    <p role="status" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}
