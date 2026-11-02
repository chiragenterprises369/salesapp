/**
 * Geo helpers for attendance routes (pure). Distances use an equirectangular projection around the
 * route's mean latitude: accurate to well under 1 % over a city-sized route, and cheap.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_M = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function distanceM(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance in metres from p to the segment a-b on a local flat projection. */
function segmentDistanceM(p: GeoPoint, a: GeoPoint, b: GeoPoint, cosLat: number): number {
  const ax = rad(a.lng) * cosLat * EARTH_M;
  const ay = rad(a.lat) * EARTH_M;
  const bx = rad(b.lng) * cosLat * EARTH_M - ax;
  const by = rad(b.lat) * EARTH_M - ay;
  const px = rad(p.lng) * cosLat * EARTH_M - ax;
  const py = rad(p.lat) * EARTH_M - ay;
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  const dx = px - t * bx;
  const dy = py - t * by;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Douglas-Peucker simplification with a tolerance in metres. Keeps the first and last point and every
 * point that deviates more than `toleranceM` from the simplified line. Iterative (no recursion depth
 * limit on long days). Returns the kept points in their original order (same objects).
 */
export function simplifyRoute<T extends GeoPoint>(points: readonly T[], toleranceM: number): T[] {
  if (points.length <= 2 || toleranceM <= 0) return [...points];
  const meanLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const cosLat = Math.cos(rad(meanLat));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxD = -1;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistanceM(points[i]!, points[first]!, points[last]!, cosLat);
      if (d > maxD) {
        maxD = d;
        index = i;
      }
    }
    if (index !== -1 && maxD > toleranceM) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Total length of a route in metres. */
export function routeLengthM(points: readonly GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceM(points[i - 1]!, points[i]!);
  return Math.round(total);
}
