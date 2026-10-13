export interface Point {
  lat: number;
  lng: number;
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Local planar projection (metres) around a reference latitude; accurate for city-scale distances. */
function project(p: Point, refLat: number) {
  return { x: rad(p.lng) * R * Math.cos(rad(refLat)), y: rad(p.lat) * R };
}

/** Shortest distance in metres from `p` to the segment a–b. */
export function distanceToSegmentMeters(p: Point, a: Point, b: Point): number {
  const ref = (a.lat + b.lat + p.lat) / 3;
  const P = project(p, ref);
  const A = project(a, ref);
  const B = project(b, ref);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2));
  return Math.hypot(P.x - (A.x + t * dx), P.y - (A.y + t * dy));
}

/** Shortest distance in metres from `p` to a polyline. */
export function distanceToPathMeters(p: Point, path: Point[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return distanceToSegmentMeters(p, path[0]!, path[0]!);
  let best = Infinity;
  for (let i = 1; i < path.length; i++) best = Math.min(best, distanceToSegmentMeters(p, path[i - 1]!, path[i]!));
  return best;
}

/**
 * Route deviation check for live driver tracking. The planned path from the sandbox maps provider
 * is a straight line between stops, so the default tolerance is generous (2.5 km).
 */
export function isOffRoute(p: Point, path: Point[], toleranceMeters = 2_500): boolean {
  return distanceToPathMeters(p, path) > toleranceMeters;
}
