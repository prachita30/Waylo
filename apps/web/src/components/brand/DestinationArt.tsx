import { memo, useId } from 'react';
import { cn } from '@/lib/cn';

/**
 * Original, procedurally drawn travel illustrations. They stand in for licensed photography:
 * lightweight, theme-aware, offline, and never dependent on unstable external image URLs.
 */
export type Scene = 'coast' | 'city' | 'desert' | 'heritage' | 'hills' | 'airport';

export const SCENE_BY_CITY: Record<string, Scene> = {
  goa: 'coast',
  kochi: 'coast',
  chennai: 'coast',
  mumbai: 'city',
  delhi: 'city',
  bengaluru: 'city',
  hyderabad: 'city',
  kolkata: 'heritage',
  ahmedabad: 'city',
  jaipur: 'desert',
  udaipur: 'desert',
  varanasi: 'heritage',
};

const PALETTES: Record<Scene, { sky: [string, string]; sun: string; far: string; near: string; accent: string }> = {
  coast: { sky: ['#FFD9B8', '#C9C3F2'], sun: '#F2705B', far: '#5FB5B0', near: '#1E7F86', accent: '#0E1A2B' },
  city: { sky: ['#F7C9C0', '#4A5BC4'], sun: '#FFE3B3', far: '#3A3F7A', near: '#0E1A2B', accent: '#FFD27A' },
  desert: { sky: ['#FFE7C2', '#F4A98A'], sun: '#FFF4DE', far: '#E08B5D', near: '#B8583A', accent: '#7A2F23' },
  heritage: { sky: ['#FCD9A8', '#E9928B'], sun: '#FFF1D6', far: '#9C5A63', near: '#5B2E45', accent: '#2C1730' },
  hills: { sky: ['#DFF1F7', '#A9C8F0'], sun: '#FFFFFF', far: '#7EA6C9', near: '#2F5B7A', accent: '#163247' },
  airport: { sky: ['#E5F1FB', '#9DB4F5'], sun: '#FFFFFF', far: '#B9C6EE', near: '#2648E8', accent: '#0E1A2B' },
};

function rng(seedStr: string) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function Skyline({ seed, base, color, windows }: { seed: string; base: number; color: string; windows: string }) {
  const r = rng(seed);
  const blocks: { x: number; w: number; h: number }[] = [];
  let x = -10;
  while (x < 410) {
    const w = 22 + r() * 34;
    const h = 60 + r() * 170;
    blocks.push({ x, w, h });
    x += w + 2 + r() * 4;
  }
  return (
    <g>
      {blocks.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={base - b.h} width={b.w} height={b.h + 120} fill={color} rx="2" />
          {Array.from({ length: Math.floor(b.h / 22) }, (_, j) =>
            r() > 0.55 ? <rect key={j} x={b.x + 5 + (j % 2) * (b.w / 2 - 4)} y={base - b.h + 10 + j * 20} width="5" height="7" fill={windows} opacity={0.75} /> : null,
          )}
        </g>
      ))}
    </g>
  );
}

function Palm({ x, y, s, color }: { x: number; y: number; s: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill={color}>
      <path d="M0 0 C 6 -40, 2 -90, -6 -130 L -1 -131 C 9 -90, 12 -40, 6 0 Z" />
      <path d="M-4 -130 C -40 -150, -70 -130, -84 -112 C -55 -128, -30 -132, -4 -124 Z" />
      <path d="M-4 -130 C 30 -158, 66 -142, 82 -122 C 52 -136, 26 -136, -2 -124 Z" />
      <path d="M-4 -130 C -26 -172, -10 -196, 6 -204 C -6 -184, -6 -160, 0 -128 Z" />
      <path d="M-4 -130 C -46 -120, -60 -88, -62 -64 C -48 -92, -30 -110, -2 -124 Z" />
      <path d="M-2 -130 C 38 -118, 56 -90, 60 -66 C 44 -92, 26 -108, -2 -124 Z" />
    </g>
  );
}

export const DestinationArt = memo(function DestinationArt({
  scene,
  seed = scene,
  className,
  label,
  showRoute = true,
}: {
  scene: Scene;
  seed?: string;
  className?: string;
  label?: string;
  showRoute?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const p = PALETTES[scene];
  const r = rng(seed);
  const sunX = 90 + r() * 220;
  const sunY = 120 + r() * 70;

  return (
    <svg
      viewBox="0 0 400 500"
      preserveAspectRatio="xMidYMid slice"
      className={cn('block h-full w-full', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.sky[1]} />
          <stop offset="0.75" stopColor={p.sky[0]} />
        </linearGradient>
        <radialGradient id={`glow-${id}`}>
          <stop offset="0" stopColor={p.sun} stopOpacity="0.9" />
          <stop offset="1" stopColor={p.sun} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`fade-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.55" stopColor="#0E1A2B" stopOpacity="0" />
          <stop offset="1" stopColor="#0E1A2B" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <rect width="400" height="500" fill={`url(#sky-${id})`} />
      <circle cx={sunX} cy={sunY} r="120" fill={`url(#glow-${id})`} />
      <circle cx={sunX} cy={sunY} r="34" fill={p.sun} />

      {scene === 'coast' && (
        <>
          <path d="M0 330 Q 100 300 200 320 T 400 310 V 500 H 0 Z" fill={p.far} />
          <path d="M0 365 Q 80 345 170 362 T 400 352 V 500 H 0 Z" fill={p.near} />
          {[380, 405, 430].map((y, i) => (
            <path key={y} d={`M${-20 + i * 30} ${y} q 25 -8 50 0 t 50 0 t 50 0`} stroke="#FFFFFF" strokeOpacity="0.35" strokeWidth="2" fill="none" />
          ))}
          <path d="M0 440 Q 140 420 260 445 T 400 450 V 500 H 0 Z" fill="#F3D9B1" />
          <Palm x={330} y={455} s={1.1} color={p.accent} />
          <Palm x={60} y={470} s={0.75} color={p.accent} />
        </>
      )}

      {scene === 'city' && (
        <>
          <path d="M0 330 L 400 300 V 500 H 0 Z" fill={p.far} opacity="0.5" />
          <Skyline seed={`${seed}-far`} base={340} color={p.far} windows={p.accent} />
          <g transform="translate(0 70)">
            <Skyline seed={`${seed}-near`} base={330} color={p.near} windows={p.accent} />
          </g>
          <path d="M0 470 C 120 455 280 485 400 465 V 500 H 0 Z" fill={p.near} />
        </>
      )}

      {scene === 'desert' && (
        <>
          <path d="M0 340 Q 120 290 230 330 T 400 320 V 500 H 0 Z" fill={p.far} />
          {/* Fort silhouette */}
          <g fill={p.accent} transform="translate(210 250)">
            <rect x="0" y="40" width="150" height="60" />
            <rect x="-10" y="20" width="26" height="80" />
            <rect x="130" y="15" width="28" height="85" />
            <path d="M-12 20 q 15 -26 30 0 Z M128 15 q 16 -28 32 0 Z" />
            <rect x="55" y="10" width="40" height="40" />
            <path d="M52 10 q 23 -34 46 0 Z" />
            {[10, 30, 100, 118].map((x) => (
              <rect key={x} x={x} y="60" width="8" height="14" rx="4" fill={p.sky[0]} opacity="0.7" />
            ))}
          </g>
          <path d="M0 400 Q 150 360 260 395 T 400 385 V 500 H 0 Z" fill={p.near} />
          <path d="M0 450 Q 110 425 220 450 T 400 440 V 500 H 0 Z" fill={p.accent} opacity="0.85" />
        </>
      )}

      {scene === 'heritage' && (
        <>
          <g fill={p.far}>
            {[20, 95, 170, 250, 320].map((x, i) => (
              <g key={x} transform={`translate(${x} ${250 + (i % 2) * 15})`}>
                <rect x="0" y="40" width="60" height="120" />
                <path d={`M30 ${-10 - (i % 3) * 12} L 52 40 H 8 Z`} />
              </g>
            ))}
          </g>
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x="0" y={370 + i * 12} width="400" height="12" fill={p.near} opacity={1 - i * 0.08} />
          ))}
          <rect x="0" y="430" width="400" height="70" fill={p.accent} />
          {[440, 458, 476].map((y) => (
            <path key={y} d={`M0 ${y} q 40 -6 80 0 t 80 0 t 80 0 t 80 0 t 80 0`} stroke={p.sun} strokeOpacity="0.35" strokeWidth="2" fill="none" />
          ))}
        </>
      )}

      {scene === 'hills' && (
        <>
          <path d="M0 330 L 90 220 L 170 300 L 260 190 L 400 320 V 500 H 0 Z" fill={p.far} />
          <path d="M0 400 L 120 300 L 220 390 L 320 310 L 400 360 V 500 H 0 Z" fill={p.near} />
          <path d="M0 460 Q 200 410 400 450 V 500 H 0 Z" fill={p.accent} />
        </>
      )}

      {scene === 'airport' && (
        <>
          <rect x="0" y="360" width="400" height="140" fill={p.far} />
          <rect x="40" y="300" width="250" height="70" rx="8" fill={p.accent} />
          {Array.from({ length: 10 }, (_, i) => (
            <rect key={i} x={52 + i * 23} y="315" width="14" height="40" rx="3" fill={p.sky[0]} opacity="0.55" />
          ))}
          <rect x="310" y="210" width="16" height="160" fill={p.accent} />
          <rect x="296" y="196" width="44" height="22" rx="6" fill={p.accent} />
          <rect x="0" y="430" width="400" height="6" fill="#FFFFFF" opacity="0.5" />
          {Array.from({ length: 8 }, (_, i) => (
            <rect key={i} x={i * 56} y="452" width="30" height="4" fill="#FFFFFF" opacity="0.6" />
          ))}
        </>
      )}

      {showRoute && (
        <g>
          <path
            d={`M ${20 + r() * 40} ${90 + r() * 40} Q 200 ${10 + r() * 30} ${340 + r() * 40} ${70 + r() * 50}`}
            stroke="#FFFFFF"
            strokeOpacity="0.8"
            strokeWidth="2"
            strokeDasharray="2 7"
            strokeLinecap="round"
            fill="none"
          />
          <g transform={`translate(${300 + r() * 30} ${45 + r() * 20}) rotate(18)`} fill="#FFFFFF">
            <path d="M0 -2 L 18 -2 L 24 0 L 18 2 L 0 2 Z M8 -2 L 4 -11 L 8 -11 L 14 -2 Z M8 2 L 4 11 L 8 11 L 14 2 Z M1 -2 L -2 -7 L 1 -7 L 4 -2 Z M1 2 L -2 7 L 1 7 L 4 2 Z" />
          </g>
        </g>
      )}
      <rect width="400" height="500" fill={`url(#fade-${id})`} />
    </svg>
  );
});
