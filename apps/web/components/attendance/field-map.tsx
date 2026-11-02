'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';

/**
 * Leaflet map for the attendance pages (client only: load it with next/dynamic, ssr false).
 *
 * Tiles: OpenStreetMap's public tile server by default. Its usage policy (operations.osmfoundation.org/
 * policies/tiles) allows light use with the attribution shown and no bulk downloading; for production
 * traffic set NEXT_PUBLIC_MAP_TILE_URL (and NEXT_PUBLIC_MAP_TILE_ATTRIBUTION) to a tile provider or an own
 * tile server. Dark theme: the tiles are dimmed and inverted with a CSS filter (no colours in code).
 * Pins and lines are styled with the theme tokens through class names, so branding and both themes apply.
 */

export type PinTone = 'green' | 'blue' | 'amber' | 'grey' | 'red' | 'indigo';

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  /** Text inside the pin (initials or a stop number). */
  text: string;
  /** Accessible name and hover title. */
  title: string;
  tone: PinTone;
  stale?: boolean;
  /** Accuracy circle in metres. */
  accuracy?: number | null;
  /** Small pins (stops on a route). */
  small?: boolean;
}

export interface MapLine {
  id: string;
  points: Array<[number, number]>;
}

export interface FieldMapProps {
  pins: readonly MapPin[];
  lines?: readonly MapLine[];
  /** Accessible name of the map region. */
  label: string;
  /** When it changes, the map fits all pins and lines again. */
  fitKey: string;
  /** Pan to this point (e.g. a stop picked in the list); newest nonce wins. */
  focus?: { lat: number; lng: number; nonce: number } | null;
  onSelect?: (id: string) => void;
  className?: string;
}

const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';
/** India, when there is nothing to show yet. */
const DEFAULT_VIEW: L.LatLngExpression = [21.0, 78.0];

const TONE_CLASS: Record<PinTone, string> = {
  green: 'border-status-green-border bg-status-green-bg text-status-green-fg',
  blue: 'border-status-blue-border bg-status-blue-bg text-status-blue-fg',
  amber: 'border-status-amber-border bg-status-amber-bg text-status-amber-fg',
  grey: 'border-status-grey-border bg-status-grey-bg text-status-grey-fg',
  red: 'border-status-red-border bg-status-red-bg text-status-red-fg',
  indigo: 'border-status-indigo-border bg-status-indigo-bg text-status-indigo-fg',
};

function pinIcon(p: MapPin): L.DivIcon {
  const size = p.small ? 22 : 30;
  const el = document.createElement('span');
  el.className = cn(
    'flex items-center justify-center rounded-full border-2 font-semibold shadow-raised',
    p.small ? 'text-2xs' : 'text-xs',
    TONE_CLASS[p.tone],
    p.stale && 'border-dashed opacity-70',
  );
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.textContent = p.text;
  return L.divIcon({ html: el, className: 'vistar-map-pin', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

export default function FieldMap({ pins, lines = [], label, fitKey, focus, onSelect, className }: FieldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Create the map once (StrictMode runs this twice in development: remove() cleans up).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const map = L.map(el, { center: DEFAULT_VIEW, zoom: 5, zoomControl: true, attributionControl: true, keyboard: true, worldCopyJump: true });
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19, crossOrigin: true }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // The map often mounts inside a panel that is still sizing itself.
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      fittedRef.current = null;
    };
  }, []);

  // Draw pins and lines; fit the view when the data set changes.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    for (const line of lines) {
      if (line.points.length < 2) continue;
      L.polyline(line.points, { className: 'stroke-accent', weight: 4, opacity: 0.85, lineJoin: 'round' }).addTo(layer);
      bounds.push(...line.points);
    }
    for (const p of pins) {
      if (p.accuracy && p.accuracy > 0 && p.accuracy < 2000) {
        L.circle([p.lat, p.lng], { radius: p.accuracy, className: 'fill-accent stroke-accent', weight: 1, fillOpacity: 0.08, opacity: 0.4, interactive: false }).addTo(layer);
      }
      const marker = L.marker([p.lat, p.lng], { icon: pinIcon(p), title: p.title, alt: p.title, keyboard: true, riseOnHover: true });
      marker.on('click', () => onSelectRef.current?.(p.id));
      marker.addTo(layer);
      bounds.push([p.lat, p.lng]);
    }
    if (fittedRef.current !== fitKey && bounds.length) {
      fittedRef.current = fitKey;
      if (bounds.length === 1) map.setView(bounds[0]!, 15);
      else map.fitBounds(L.latLngBounds(bounds), { padding: [32, 32], maxZoom: 16 });
    }
  }, [pins, lines, fitKey]);

  useEffect(() => {
    if (focus && mapRef.current) mapRef.current.setView([focus.lat, focus.lng], Math.max(mapRef.current.getZoom(), 16));
  }, [focus]);

  return (
    <div
      className={cn(
        'isolate overflow-hidden rounded-lg border border-border bg-surface-2',
        '[&_.leaflet-container]:h-full [&_.leaflet-container]:w-full [&_.leaflet-container]:bg-surface-2 [&_.leaflet-container]:font-sans',
        'dark:[&_.leaflet-tile-pane]:[filter:invert(1)_hue-rotate(180deg)_brightness(0.85)_contrast(0.9)]',
        className,
      )}
    >
      <div ref={containerRef} role="region" aria-label={label} className="h-full w-full" />
    </div>
  );
}
