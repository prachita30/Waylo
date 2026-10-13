import { useId } from 'react';
import { cn } from '@/lib/cn';

export interface MapPoint {
  lat: number;
  lng: number;
  label: string;
  kind: 'pickup' | 'stop' | 'me' | 'driver';
}

const COLORS: Record<MapPoint['kind'], string> = {
  pickup: 'var(--primary)',
  stop: 'var(--ink-3)',
  me: 'var(--coral)',
  driver: 'var(--mint)',
};

/**
 * Schematic route map: projects coordinates onto an SVG canvas without third-party tiles (no
 * external requests, no provider key in the browser). Every point is also listed as text, which is
 * the accessible alternative to the drawing. A tile-based map can replace this once a live maps
 * provider is configured.
 */
export function RouteMap({ points, route, className, caption }: { points: MapPoint[]; route?: MapPoint[]; className?: string; caption?: string }) {
  const id = useId();
  const all = [...points, ...(route ?? [])];
  if (all.length === 0) return null;
  const W = 400;
  const H = 260;
  const pad = 36;
  const lats = all.map((p) => p.lat);
  const lngs = all.map((p) => p.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const spanX = Math.max(0.01, (Math.max(...lngs) - Math.min(...lngs)) * kx);
  const spanY = Math.max(0.01, Math.max(...lats) - Math.min(...lats));
  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
  const cx = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const cy = midLat;
  const xy = (p: { lat: number; lng: number }) => ({ x: W / 2 + (p.lng - cx) * kx * scale, y: H / 2 - (p.lat - cy) * scale });
  const path = (route ?? points.filter((p) => p.kind !== 'driver')).map(xy);

  return (
    <figure className={cn('overflow-hidden rounded-2xl border border-line bg-sky/60', className)} aria-labelledby={`${id}-cap`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-labelledby={`${id}-cap`}>
        <defs>
          <pattern id={`${id}-grid`} width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--line)" strokeWidth="0.6" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill={`url(#${id}-grid)`} />
        {path.length > 1 && (
          <polyline
            points={path.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="var(--ink)"
            strokeOpacity="0.55"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="route-animated"
          />
        )}
        {points.map((p, i) => {
          const { x, y } = xy(p);
          return (
            <g key={i} transform={`translate(${x} ${y})`}>
              {p.kind === 'driver' ? (
                <>
                  <circle r="11" fill={COLORS.driver} opacity="0.25" className="live-dot" />
                  <circle r="6" fill={COLORS.driver} stroke="white" strokeWidth="2" />
                </>
              ) : (
                <>
                  <path d="M0 0 C -7 -9, -9 -14, -9 -18 A 9 9 0 1 1 9 -18 C 9 -14, 7 -9, 0 0 Z" fill={COLORS[p.kind]} stroke="white" strokeWidth="1.5" />
                  <circle cy="-18" r="3.2" fill="white" />
                </>
              )}
              <text y={p.kind === 'driver' ? -14 : -31} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--ink)" stroke="var(--bg)" strokeWidth="3" paintOrder="stroke">
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption id={`${id}-cap`} className="border-t border-line bg-surface px-4 py-3 text-xs text-ink-2">
        <p className="font-semibold text-ink">{caption ?? 'Route overview (schematic)'}</p>
        <ol className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {points.map((p, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: COLORS[p.kind] }} aria-hidden />
              {p.label}
            </li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}
