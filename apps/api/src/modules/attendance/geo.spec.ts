import { describe, expect, it } from 'vitest';
import { distanceM, routeLengthM, simplifyRoute } from './geo.js';

// Pune, around Shivajinagar
const A = { lat: 18.5308, lng: 73.8475 };

describe('geo', () => {
  it('haversine distance: 0.01 deg of latitude is about 1.11 km', () => {
    expect(distanceM(A, { lat: A.lat + 0.01, lng: A.lng })).toBeGreaterThan(1110);
    expect(distanceM(A, { lat: A.lat + 0.01, lng: A.lng })).toBeLessThan(1113);
    expect(distanceM(A, A)).toBe(0);
  });

  it('Douglas-Peucker drops points on a straight line and keeps the corner', () => {
    const line = Array.from({ length: 21 }, (_, i) => ({ lat: A.lat + i * 0.0005, lng: A.lng, i }));
    const corner = Array.from({ length: 20 }, (_, i) => ({ lat: A.lat + 20 * 0.0005, lng: A.lng + (i + 1) * 0.0005, i: 21 + i }));
    const out = simplifyRoute([...line, ...corner], 10);
    expect(out.map((p) => p.i)).toEqual([0, 20, 40]);
  });

  it('keeps a detour bigger than the tolerance, drops GPS jitter below it', () => {
    const B = { lat: A.lat + 0.002, lng: A.lng };
    const jitter = { lat: A.lat + 0.001, lng: A.lng + 0.00003 }; // ~3 m off the line
    const detour = { lat: A.lat + 0.001, lng: A.lng + 0.002 }; // ~210 m off the line
    expect(simplifyRoute([A, jitter, B], 15)).toEqual([A, B]);
    expect(simplifyRoute([A, detour, B], 15)).toEqual([A, detour, B]);
  });

  it('short inputs and zero tolerance are returned as they are', () => {
    expect(simplifyRoute([], 10)).toEqual([]);
    expect(simplifyRoute([A], 10)).toEqual([A]);
    const two = [A, { lat: A.lat + 1, lng: A.lng }];
    expect(simplifyRoute(two, 10)).toEqual(two);
    const three = [A, { lat: A.lat + 0.0001, lng: A.lng }, { lat: A.lat + 0.0002, lng: A.lng }];
    expect(simplifyRoute(three, 0)).toEqual(three);
  });

  it('handles a long day without recursion limits (10,000 points)', () => {
    const pts = Array.from({ length: 10_000 }, (_, i) => ({ lat: A.lat + Math.sin(i / 50) * 0.01, lng: A.lng + i * 0.00001 }));
    const out = simplifyRoute(pts, 5);
    expect(out.length).toBeGreaterThan(10);
    expect(out.length).toBeLessThan(pts.length);
    expect(out[0]).toBe(pts[0]);
    expect(out.at(-1)).toBe(pts.at(-1));
  });

  it('route length sums the legs', () => {
    expect(routeLengthM([A, { lat: A.lat + 0.01, lng: A.lng }, A])).toBeGreaterThan(2220);
  });
});
